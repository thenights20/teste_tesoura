const ALLOWED_HOSTS = new Set(['bunkr.cr', 'www.bunkr.cr']);
const MEDIA_EXT = /\.(mp4|webm|mov|m4v|mkv|jpg|jpeg|png|gif|webp)(?:$|[?#])/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])/i;
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp)(?:$|[?#])/i;

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function absoluteUrl(value, base) {
  if (!value) return null;
  const clean = decodeHtml(value.trim()).replace(/^['"]|['"]$/g, '');
  if (!clean || clean.startsWith('data:') || clean.startsWith('blob:')) return null;
  try { return new URL(clean, base).toString(); }
  catch { return null; }
}

function titleFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').filter(Boolean).pop() || 'Mídia';
    return decodeURIComponent(name).replace(/[-_]+/g, ' ');
  } catch {
    return 'Mídia';
  }
}

function typeFromUrl(url) {
  if (IMAGE_EXT.test(url)) return 'image';
  return 'video';
}

function collectMatches(html, baseUrl) {
  const found = new Map();
  const add = (raw, title = '', thumbnail = '') => {
    const url = absoluteUrl(raw, baseUrl);
    if (!url || !MEDIA_EXT.test(url)) return;
    if (found.has(url)) return;
    found.set(url, {
      url,
      type: typeFromUrl(url),
      title: decodeHtml(title).trim() || titleFromUrl(url),
      thumbnail: absoluteUrl(thumbnail, baseUrl) || ''
    });
  };

  const metaPatterns = [
    /<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::url)?["'][^>]*>/gi,
    /<meta[^>]+name=["']twitter:player:stream["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<video[^>]+src=["']([^"']+)["'][^>]*>/gi,
    /<source[^>]+src=["']([^"']+)["'][^>]*>/gi
  ];

  for (const pattern of metaPatterns) {
    let match;
    while ((match = pattern.exec(html))) add(match[1]);
  }

  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let anchor;
  while ((anchor = anchorPattern.exec(html))) {
    const href = anchor[1];
    const inner = anchor[2] || '';
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const img = inner.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i);
    if (MEDIA_EXT.test(href)) add(href, text, img?.[1] || '');
  }

  const escapedUrlPattern = /https?:\\?\/\\?\/[^\s"'<>]+?\.(?:mp4|webm|mov|m4v|mkv|jpg|jpeg|png|gif|webp)(?:\?[^\s"'<>]*)?/gi;
  let escaped;
  while ((escaped = escapedUrlPattern.exec(html))) {
    add(escaped[0].replace(/\\\//g, '/'));
  }

  return [...found.values()];
}

function extractPageTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (og) return decodeHtml(og[1]).trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? decodeHtml(title[1]).replace(/\s+/g, ' ').trim() : 'Bunkr';
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const raw = requestUrl.searchParams.get('url');
  if (!raw) return Response.json({ error: 'Informe um link do Bunkr.' }, { status: 400 });

  let target;
  try { target = new URL(raw); }
  catch { return Response.json({ error: 'Link inválido.' }, { status: 400 }); }

  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    return Response.json({ error: 'Por segurança, esta versão aceita apenas links https://bunkr.cr.' }, { status: 400 });
  }

  const upstream = await fetch(target.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'User-Agent': 'BunkrViewer/1.0 (+personal viewer)'
    },
    redirect: 'follow'
  });

  if (!upstream.ok) {
    return Response.json({ error: `O Bunkr respondeu com HTTP ${upstream.status}.` }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    const direct = upstream.url;
    if (MEDIA_EXT.test(direct)) {
      return Response.json({
        title: titleFromUrl(direct),
        source: target.toString(),
        items: [{ url: direct, type: typeFromUrl(direct), title: titleFromUrl(direct), thumbnail: '' }]
      });
    }
    return Response.json({ error: 'O link não retornou uma página HTML nem uma mídia reconhecida.' }, { status: 422 });
  }

  const html = await upstream.text();
  const items = collectMatches(html, upstream.url);

  return Response.json({
    title: extractPageTitle(html),
    source: upstream.url,
    items,
    note: items.length ? undefined : 'A página abriu, mas nenhuma URL pública de mídia foi encontrada no HTML inicial.'
  }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
