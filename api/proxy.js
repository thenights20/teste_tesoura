import { Readable } from 'node:stream';

const ALLOWED_HOST_RE = /(^|\.)bunkr\.[a-z0-9.-]+$/i;
const DOWNLOAD_RE = /^https:\/\/dl\.bunkr\.[a-z0-9.-]+\/file\/\d+(?:[/?#]|$)/i;

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

  if (target.protocol !== 'https:' || !ALLOWED_HOST_RE.test(target.hostname)) return res.status(403).send('Host not allowed');
  if (mode === 'media' && !DOWNLOAD_RE.test(target.href)) return res.status(403).send('Media proxy only accepts direct download endpoints');

  const headers = new Headers({ 'User-Agent': 'Mozilla/5.0' });
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
    if (!(type.includes('text/html') || type.includes('application/xhtml+xml') || type.startsWith('text/'))) return res.status(415).send('Unsupported upstream type');
    if (type) res.setHeader('Content-Type', type);
    const text = await upstream.text();
    return res.status(upstream.status).send(text);
  }

  for (const name of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','ETag','Last-Modified']) copyHeader(upstream, res, name);
  res.setHeader('Content-Disposition', 'inline');
  res.status(upstream.status);
  if (req.method === 'HEAD' || !upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}
