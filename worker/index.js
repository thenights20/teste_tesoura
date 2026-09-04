const ALLOWED_HOST_RE = /(^|\.)bunkr\.[a-z0-9.-]+$/i;
const DOWNLOAD_RE = /^https:\/\/dl\.bunkr\.[a-z0-9.-]+\/file\/\d+(?:[/?#]|$)/i;

function cors(headers = new Headers()) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Range');
  headers.set('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges, X-Source-Url');
  headers.set('Cache-Control', 'no-store');
  return headers;
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

    if (target.protocol !== 'https:' || !ALLOWED_HOST_RE.test(target.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: cors() });
    }

    if (mode === 'media' && !DOWNLOAD_RE.test(target.href)) {
      return new Response('Media proxy only accepts direct download endpoints', { status: 403, headers: cors() });
    }

    const headers = new Headers();
    headers.set('User-Agent', 'Mozilla/5.0');
    if (mode === 'media') {
      headers.set('Accept', 'video/*,application/octet-stream;q=0.9,*/*;q=0.1');
      const range = request.headers.get('Range');
      if (range) headers.set('Range', range);
    } else {
      headers.set('Accept', 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1');
    }

    const upstream = await fetch(target.href, {
      method: request.method,
      redirect: 'follow',
      headers
    });

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
