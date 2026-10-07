const BUNKR_HOST_RE = /^(?:[a-z0-9-]+\.)?bunkr\.[a-z0-9-]{2,12}$/i;
const CDN_HOST_RE = /(^|\.)cdn\.cr$/i;
const LEGACY_DOWNLOAD_RE = /^https:\/\/dl\.bunkr\.[a-z0-9.-]+\/file\/\d+(?:[/?#]|$)/i;
const ITEM_PATH_RE = /^\/(?:f|i|v)\/[^/?#]+(?:[/?#]|$)/i;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36';

function cors(headers = new Headers()) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Range');
  headers.set('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges, X-Source-Url');
  headers.set('Cache-Control', 'no-store');
  return headers;
}

function isBunkrPage(url) {
  return url.protocol === 'https:' && BUNKR_HOST_RE.test(url.hostname);
}

function isItemPage(url) {
  return isBunkrPage(url) && ITEM_PATH_RE.test(url.pathname + url.search);
}

function isAllowedCdn(url) {
  return url.protocol === 'https:' && CDN_HOST_RE.test(url.hostname);
}

function isAllowedMedia(url) {
  if (LEGACY_DOWNLOAD_RE.test(url.href)) return true;
  return isAllowedCdn(url) && url.searchParams.has('token') && url.searchParams.has('ex');
}

function unescapeInline(value = '') {
  return String(value).replace(/\\\//g, '/');
}

function extractSignedSources(html) {
  const cdn = html.match(/jsCDN\s*=\s*"([^"]+)"/i)?.[1] || '';
  const sign = html.match(/signUrl\s*=\s*"([^"]+)"/i)?.[1] || '';
  const type = html.match(/jsType\s*=\s*"([^"]+)"/i)?.[1] || '';
  const slug = html.match(/jsSlug\s*=\s*"([^"]+)"/i)?.[1] || '';
  if (!cdn || !sign) return null;
  return {
    cdnUrl: unescapeInline(cdn),
    signUrl: unescapeInline(sign),
    contentType: unescapeInline(type),
    slug: unescapeInline(slug)
  };
}

async function resolveSignedMedia(target) {
  const page = await fetch(target.href, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
    }
  });
  if (!page.ok) throw new Error(`Item page returned HTTP ${page.status}`);

  const html = await page.text();
  const source = extractSignedSources(html);
  if (!source) throw new Error('jsCDN/signUrl not found on item page');

  let cdn;
  let sign;
  try {
    cdn = new URL(source.cdnUrl);
    sign = new URL(source.signUrl);
  } catch {
    throw new Error('Invalid signed-media source URL');
  }

  if (!isAllowedCdn(cdn) || !isAllowedCdn(sign)) throw new Error('Untrusted CDN/signing host');

  const signRequest = new URL(sign.href);
  signRequest.searchParams.set('path', cdn.pathname);
  const signResponse = await fetch(signRequest.href, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json,*/*;q=0.1',
      'Referer': page.url || target.href
    }
  });
  if (!signResponse.ok) throw new Error(`Signing endpoint returned HTTP ${signResponse.status}`);

  let payload;
  try { payload = await signResponse.json(); }
  catch { throw new Error('Signing endpoint returned invalid JSON'); }

  if (payload?.token == null || payload?.ex == null) throw new Error('Signing response missing token/ex');
  cdn.searchParams.set('token', String(payload.token));
  cdn.searchParams.set('ex', String(payload.ex));

  return {
    url: cdn.href,
    contentType: source.contentType || '',
    title: source.slug || '',
    sourceUrl: page.url || target.href
  };
}

function copyMediaHeaders(upstream, sourceUrl) {
  const headers = new Headers();
  for (const name of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','Content-Disposition','ETag','Last-Modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('X-Source-Url', sourceUrl);
  return cors(headers);
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: cors() });

    const incoming = new URL(request.url);
    const raw = incoming.searchParams.get('url');
    const mode = incoming.searchParams.get('mode') || 'page';
    if (!raw) return new Response('Missing url', { status: 400, headers: cors() });

    let target;
    try { target = new URL(raw); }
    catch { return new Response('Invalid url', { status: 400, headers: cors() }); }

    if (mode === 'resolve') {
      if (request.method !== 'GET') return new Response('Resolve only accepts GET', { status: 405, headers: cors() });
      if (!isItemPage(target)) return new Response('Resolve only accepts Bunkr item pages', { status: 403, headers: cors() });
      try {
        const result = await resolveSignedMedia(target);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: cors(new Headers({ 'Content-Type': 'application/json; charset=utf-8' }))
        });
      } catch (error) {
        return new Response(`Unable to resolve media: ${error?.message || 'unknown error'}`, { status: 502, headers: cors() });
      }
    }

    if (mode === 'media') {
      if (!isAllowedMedia(target)) return new Response('Media proxy only accepts signed Bunkr CDN URLs', { status: 403, headers: cors() });
    } else if (!isBunkrPage(target)) {
      return new Response('Host not allowed', { status: 403, headers: cors() });
    }

    const headers = new Headers();
    headers.set('User-Agent', USER_AGENT);
    if (mode === 'media') {
      headers.set('Accept', 'video/*,application/octet-stream;q=0.9,*/*;q=0.1');
      const range = request.headers.get('Range');
      if (range) headers.set('Range', range);
    } else {
      headers.set('Accept', 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1');
    }

    let upstream;
    try {
      upstream = await fetch(target.href, { method: request.method, redirect: 'follow', headers });
    } catch (error) {
      return new Response(`Upstream error: ${error?.message || 'fetch failed'}`, { status: 502, headers: cors() });
    }

    const type = (upstream.headers.get('content-type') || '').toLowerCase();
    const sourceUrl = upstream.url || target.href;

    if (mode === 'media') {
      const mediaHeaders = copyMediaHeaders(upstream, sourceUrl);
      if (request.method === 'HEAD') return new Response(null, { status: upstream.status, headers: mediaHeaders });
      return new Response(upstream.body, { status: upstream.status, headers: mediaHeaders });
    }

    if (!(type.includes('text/html') || type.includes('application/xhtml+xml') || type.startsWith('text/'))) {
      return new Response('Unsupported upstream type', {
        status: 415,
        headers: cors(new Headers({ 'X-Source-Url': sourceUrl }))
      });
    }

    const text = await upstream.text();
    const responseHeaders = cors(new Headers({
      'Content-Type': type || 'text/html; charset=utf-8',
      'X-Source-Url': sourceUrl
    }));

    return new Response(text, { status: upstream.status, headers: responseHeaders });
  }
};
