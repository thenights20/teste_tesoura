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
        'Accept': 'text/html,application/xhtml+xml,video/*;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const type = upstream.headers.get('content-type') || '';
    const headers = cors(new Headers({
      'Content-Type': type,
      'X-Source-Url': upstream.url
    }));

    if (type.toLowerCase().startsWith('video/')) {
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    const text = await upstream.text();
    return new Response(text, { status: upstream.status, headers });
  }
};
