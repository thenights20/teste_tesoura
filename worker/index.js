const ALLOWED_HOST_RE = /(^|\.)bunkr\.[a-z0-9.-]+$/i;

function cors(headers = new Headers()) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Cache-Control', 'no-store');
  return headers;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }

    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: cors() });
    }

    const incoming = new URL(request.url);
    const raw = incoming.searchParams.get('url');
    if (!raw) {
      return new Response('Missing url', { status: 400, headers: cors() });
    }

    let target;
    try {
      target = new URL(raw);
    } catch {
      return new Response('Invalid url', { status: 400, headers: cors() });
    }

    if (target.protocol !== 'https:' || !ALLOWED_HOST_RE.test(target.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: cors() });
    }

    const upstream = await fetch(target.href, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const type = (upstream.headers.get('content-type') || '').toLowerCase();
    const sourceUrl = upstream.url || target.href;

    if (!(type.includes('text/html') || type.includes('application/xhtml+xml') || type.startsWith('text/'))) {
      return new Response('Unsupported upstream type', {
        status: 415,
        headers: cors(new Headers({ 'X-Source-Url': sourceUrl }))
      });
    }

    const text = await upstream.text();
    const headers = cors(new Headers({
      'Content-Type': type || 'text/html; charset=utf-8',
      'X-Source-Url': sourceUrl
    }));

    return new Response(text, { status: upstream.status, headers });
  }
};
