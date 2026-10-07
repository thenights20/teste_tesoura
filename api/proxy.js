import { Readable } from 'node:stream';

const BUNKR_HOST_RE = /^(?:[a-z0-9-]+\.)?bunkr\.[a-z0-9-]{2,12}$/i;
const CDN_HOST_RE = /(^|\.)cdn\.cr$/i;
const LEGACY_DOWNLOAD_RE = /^https:\/\/dl\.bunkr\.[a-z0-9.-]+\/file\/\d+(?:[/?#]|$)/i;
const ITEM_PATH_RE = /^\/(?:f|i|v)\/[^/?#]+(?:[/?#]|$)/i;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges, X-Source-Url');
  res.setHeader('Cache-Control', 'no-store');
}

function copyHeader(upstream, res, name) {
  const value = upstream.headers.get(name);
  if (value) res.setHeader(name, value);
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
  const pageHeaders = new Headers({
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1'
  });
  const page = await fetch(target.href, { method: 'GET', redirect: 'follow', headers: pageHeaders });
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

  if (!isAllowedCdn(cdn) || !isAllowedCdn(sign)) {
    throw new Error('Untrusted CDN/signing host');
  }

  const signRequest = new URL(sign.href);
  signRequest.searchParams.set('path', cdn.pathname);
  const signResponse = await fetch(signRequest.href, {
    method: 'GET',
    redirect: 'follow',
    headers: new Headers({
      'User-Agent': USER_AGENT,
      'Accept': 'application/json,*/*;q=0.1',
      'Referer': page.url || target.href
    })
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

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).send('Method not allowed');

  const raw = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
  const mode = (Array.isArray(req.query.mode) ? req.query.mode[0] : req.query.mode) || 'page';
  if (!raw) return res.status(400).send('Missing url');

  let target;
  try { target = new URL(raw); }
  catch { return res.status(400).send('Invalid url'); }

  if (mode === 'resolve') {
    if (req.method !== 'GET') return res.status(405).send('Resolve only accepts GET');
    if (!isItemPage(target)) return res.status(403).send('Resolve only accepts Bunkr item pages');
    try {
      const result = await resolveSignedMedia(target);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).send(JSON.stringify(result));
    } catch (error) {
      return res.status(502).send(`Unable to resolve media: ${error?.message || 'unknown error'}`);
    }
  }

  if (mode === 'media') {
    if (!isAllowedMedia(target)) return res.status(403).send('Media proxy only accepts signed Bunkr CDN URLs');
  } else if (!isBunkrPage(target)) {
    return res.status(403).send('Host not allowed');
  }

  const headers = new Headers({ 'User-Agent': USER_AGENT });
  if (mode === 'media') {
    headers.set('Accept', 'video/*,application/octet-stream;q=0.9,*/*;q=0.1');
    if (req.headers.range) headers.set('Range', req.headers.range);
  } else {
    headers.set('Accept', 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1');
  }

  let upstream;
  try {
    upstream = await fetch(target.href, { method: req.method, redirect: 'follow', headers });
  } catch (error) {
    return res.status(502).send(`Upstream error: ${error?.message || 'fetch failed'}`);
  }

  const sourceUrl = upstream.url || target.href;
  res.setHeader('X-Source-Url', sourceUrl);
  const type = (upstream.headers.get('content-type') || '').toLowerCase();

  if (mode === 'page') {
    if (!(type.includes('text/html') || type.includes('application/xhtml+xml') || type.startsWith('text/'))) {
      return res.status(415).send('Unsupported upstream type');
    }
    if (type) res.setHeader('Content-Type', type);
    const text = await upstream.text();
    return res.status(upstream.status).send(text);
  }

  for (const name of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified']) {
    copyHeader(upstream, res, name);
  }
  res.setHeader('Content-Disposition', 'inline');
  res.status(upstream.status);
  if (req.method === 'HEAD' || !upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}
