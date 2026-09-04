const form = document.querySelector('#open-form');
const urlInput = document.querySelector('#url');
const openButton = document.querySelector('#open-button');
const statusBox = document.querySelector('#status');
const viewer = document.querySelector('#viewer');
const player = document.querySelector('#player');
const imageViewer = document.querySelector('#image-viewer');
const currentTitle = document.querySelector('#current-title');
const albumTitle = document.querySelector('#album-title');
const position = document.querySelector('#position');
const count = document.querySelector('#count');
const playlist = document.querySelector('#playlist');
const prevButton = document.querySelector('#prev');
const nextButton = document.querySelector('#next');
const historyBox = document.querySelector('#history');
const clearHistoryButton = document.querySelector('#clear-history');

let items = [];
let currentIndex = 0;

const mediaRe = /\.(mp4|webm|mov|m4v|mkv|jpg|jpeg|png|gif|webp)(?:$|[?#])/i;
const videoNameRe = /\.(mp4|webm|mov|m4v|mkv)\b/i;
const imageRe = /\.(jpg|jpeg|png|gif|webp)(?:$|[?#])/i;
const itemPathRe = /\/(f|i|v)\/[A-Za-z0-9]+(?:$|[/?#])/i;
const MAX_ITEM_PAGES = 24;

function setStatus(message = '', type = '') {
  statusBox.hidden = !message;
  statusBox.textContent = message;
  statusBox.className = `status ${type}`.trim();
}

function normalizeUrl(value, base) {
  try { return new URL(value, base).href; } catch { return null; }
}

function cleanTitle(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function titleFromUrl(url) {
  try {
    const name = new URL(url).pathname.split('/').filter(Boolean).pop() || 'Mídia';
    return decodeURIComponent(name).replace(/[-_]+/g, ' ');
  } catch { return 'Mídia'; }
}

function isMediaUrl(url) { return mediaRe.test(url || ''); }
function mediaType(url) { return imageRe.test(url || '') ? 'image' : 'video'; }
function humanType(item) { return item.type === 'image' ? 'Imagem' : 'Vídeo'; }
function isClosedCandidate(url = '', title = '') { return /(^|[\/_-])closed([\/_-.?#]|$)/i.test(`${url} ${title}`); }

function pageTitle(doc) {
  return cleanTitle(
    doc.querySelector('meta[property="og:title"]')?.content ||
    doc.querySelector('meta[name="twitter:title"]')?.content ||
    doc.querySelector('title')?.textContent || 'Conteúdo'
  );
}

function extractVideoCandidates(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const candidates = [];
  const seen = new Set();

  function add(raw, title = '', priority = 9) {
    const url = normalizeUrl(raw, pageUrl);
    if (!url || seen.has(url) || isClosedCandidate(url, title)) return;
    seen.add(url);
    candidates.push({ url, title: cleanTitle(title) || titleFromUrl(url), type: 'video', priority });
  }

  for (const node of doc.querySelectorAll('video[src]')) add(node.getAttribute('src'), node.getAttribute('title') || pageTitle(doc), 1);
  for (const node of doc.querySelectorAll('source[src]')) add(node.getAttribute('src'), node.getAttribute('title') || pageTitle(doc), 1);
  for (const node of doc.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]')) add(node.getAttribute('content'), pageTitle(doc), 2);
  for (const node of doc.querySelectorAll('a[href]')) {
    const url = normalizeUrl(node.getAttribute('href'), pageUrl);
    if (url && /\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])/i.test(url)) add(url, node.getAttribute('title') || node.textContent || pageTitle(doc), 3);
  }

  const absoluteVideos = html.match(/https?:\\?\/\\?\/[^"'<>\s]+?\.(?:mp4|webm|mov|m4v|mkv)(?:\?[^\u0022'<>\s]*)?/gi) || [];
  for (const raw of absoluteVideos) add(raw.replace(/\\\//g, '/').replace(/&amp;/g, '&'), pageTitle(doc), 4);

  candidates.sort((a, b) => a.priority - b.priority);
  return { title: pageTitle(doc), candidates, doc };
}

function findNearbyAnchor(node) {
  if (!node) return null;
  if (node.matches?.('a[href]')) return node;
  const inside = node.querySelector?.('a[href]');
  if (inside) return inside;
  const closest = node.closest?.('a[href]');
  if (closest) return closest;
  let sibling = node.previousElementSibling;
  for (let i = 0; sibling && i < 3; i++, sibling = sibling.previousElementSibling) {
    if (sibling.matches?.('a[href]')) return sibling;
    const a = sibling.querySelector?.('a[href]');
    if (a) return a;
  }
  return node.parentElement?.querySelector?.('a[href]') || null;
}

function findVideoItemPages(doc, pageUrl) {
  const base = new URL(pageUrl);
  const found = [];
  const seenKey = new Set();

  function addPage(anchor, title = '', forceVideo = false) {
    if (!anchor) return;
    const absolute = normalizeUrl(anchor.getAttribute('href'), pageUrl);
    if (!absolute || isMediaUrl(absolute)) return;
    let parsed;
    try { parsed = new URL(absolute); } catch { return; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== base.hostname || !itemPathRe.test(parsed.pathname + parsed.search)) return;

    const nearby = cleanTitle(`${title} ${anchor.textContent || ''} ${anchor.parentElement?.textContent || ''}`);
    if (!(forceVideo || /^\/v\//i.test(parsed.pathname) || videoNameRe.test(nearby))) return;

    const match = parsed.pathname.match(/\/(f|i|v)\/([A-Za-z0-9]+)/i);
    const key = match ? `${match[1].toLowerCase()}/${match[2]}` : parsed.pathname;
    if (seenKey.has(key)) return;
    seenKey.add(key);
    found.push({ key, url: absolute, title: cleanTitle(title) || nearby || titleFromUrl(absolute) });
  }

  const videoBlocks = [...doc.querySelectorAll('.grid-videos_box-txt')];
  for (const block of videoBlocks) {
    addPage(findNearbyAnchor(block), block.textContent || '', true);
    if (found.length >= MAX_ITEM_PAGES) break;
  }

  if (!found.length) {
    for (const node of doc.querySelectorAll('[data-file-id], [data-id]')) {
      const text = cleanTitle(node.textContent || node.parentElement?.textContent || '');
      addPage(findNearbyAnchor(node), text, videoNameRe.test(text));
      if (found.length >= MAX_ITEM_PAGES) break;
    }
  }

  if (!found.length) {
    for (const anchor of doc.querySelectorAll('a[href]')) {
      addPage(anchor, anchor.parentElement?.textContent || anchor.textContent || '', false);
      if (found.length >= MAX_ITEM_PAGES) break;
    }
  }

  return found;
}

async function fetchPublicPage(url) {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
  if (!response.ok) throw new Error(`Falha HTTP ${response.status}`);
  return { response, contentType: (response.headers.get('content-type') || '').toLowerCase() };
}

async function discoverAlbumVideos(html, pageUrl) {
  const album = extractVideoCandidates(html, pageUrl);
  const itemPages = findVideoItemPages(album.doc, pageUrl);
  const resolved = [];
  let unresolved = 0;

  // Um card real do álbum gera no máximo um item na lista final.
  for (let i = 0; i < itemPages.length; i++) {
    const entry = itemPages[i];
    setStatus(`Verificando vídeos do álbum… ${i + 1} de ${itemPages.length}`);
    let selected = null;

    try {
      const { response, contentType } = await fetchPublicPage(entry.url);
      if (contentType.startsWith('video/')) {
        selected = { url: response.url, title: entry.title, type: 'video', sourcePage: entry.url };
      } else {
        const childHtml = await response.text();
        const child = extractVideoCandidates(childHtml, response.url || entry.url);
        const candidate = child.candidates.find(c => !isClosedCandidate(c.url, c.title));
        if (candidate) selected = { ...candidate, title: entry.title || candidate.title, sourcePage: entry.url };
      }
    } catch {}

    if (selected) resolved.push(selected);
    else unresolved++;
  }

  // Para link individual, quando não existe estrutura de álbum, aceita a melhor fonte exposta na própria página.
  if (!itemPages.length && album.candidates.length) resolved.push(album.candidates[0]);

  return { title: album.title, items: resolved, detectedVideoPages: itemPages.length, unresolved };
}

function renderPlaylist() {
  playlist.innerHTML = '';
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `media-item${index === currentIndex ? ' active' : ''}`;
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    thumb.textContent = '▶';
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'media-name';
    name.textContent = item.title || `Vídeo ${index + 1}`;
    const type = document.createElement('span');
    type.className = 'media-type';
    type.textContent = 'Vídeo';
    text.append(name, type);
    button.append(thumb, text);
    button.addEventListener('click', () => selectItem(index, true));
    playlist.appendChild(button);
  });
}

function selectItem(index, autoplay = false) {
  if (!items.length) return;
  currentIndex = Math.max(0, Math.min(index, items.length - 1));
  const item = items[currentIndex];
  currentTitle.textContent = item.title || `Vídeo ${currentIndex + 1}`;
  position.textContent = `${currentIndex + 1} de ${items.length}`;
  prevButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === items.length - 1;
  imageViewer.hidden = true;
  player.hidden = false;
  player.pause();
  player.removeAttribute('src');
  player.load();
  setStatus('Carregando vídeo…');
  player.src = item.url;
  player.load();
  if (autoplay) player.play().catch(() => {});
  renderPlaylist();
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem('teste-tesoura-history') || '[]'); } catch { return []; }
}

function saveHistory(url, title) {
  const history = getHistory().filter(item => item.url !== url);
  history.unshift({ url, title: title || url, at: Date.now() });
  localStorage.setItem('teste-tesoura-history', JSON.stringify(history.slice(0, 12)));
  renderHistory();
}

function renderHistory() {
  const history = getHistory();
  historyBox.innerHTML = '';
  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nenhum link aberto ainda.';
    historyBox.appendChild(empty);
    return;
  }
  history.forEach(entry => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = entry.url;
    button.textContent = entry.title || entry.url;
    button.addEventListener('click', () => { urlInput.value = entry.url; loadUrl(entry.url); });
    historyBox.appendChild(button);
  });
}

async function loadUrl(rawUrl) {
  const target = rawUrl.trim();
  if (!target) return;
  setStatus('Lendo o conteúdo público…');
  openButton.disabled = true;
  viewer.hidden = true;

  try {
    let data;
    if (isMediaUrl(target) && mediaType(target) === 'video') {
      data = { title: titleFromUrl(target), items: [{ url: target, title: titleFromUrl(target), type: 'video' }], detectedVideoPages: 1, unresolved: 0 };
    } else {
      const { response, contentType } = await fetchPublicPage(target);
      if (contentType.startsWith('video/')) {
        data = { title: titleFromUrl(response.url), items: [{ url: response.url, title: titleFromUrl(response.url), type: 'video' }], detectedVideoPages: 1, unresolved: 0 };
      } else {
        data = await discoverAlbumVideos(await response.text(), response.url || target);
      }
    }

    if (!data.items.length) {
      if (data.detectedVideoPages > 0) throw new Error(`Reconheci ${data.detectedVideoPages} vídeo(s) no álbum, mas nenhum deles expôs uma fonte pública reproduzível diretamente pelo navegador.`);
      throw new Error('Nenhum vídeo público reproduzível foi encontrado nesse link.');
    }

    items = data.items;
    currentIndex = 0;
    albumTitle.textContent = data.title || 'Conteúdo';
    count.textContent = String(items.length);
    viewer.hidden = false;
    const info = data.unresolved ? `Reconheci ${data.detectedVideoPages} item(ns) do álbum; ${data.unresolved} ainda não forneceram uma fonte reproduzível.` : '';
    setStatus(info, info ? 'error' : '');
    selectItem(0, false);
    saveHistory(target, data.title);
    const nextUrl = new URL(location.href);
    nextUrl.searchParams.set('url', target);
    history.replaceState(null, '', nextUrl);
  } catch (error) {
    items = [];
    playlist.innerHTML = '';
    setStatus(error instanceof TypeError ? 'O navegador bloqueou a leitura por CORS. Para essa etapa, o GitHub Pages sozinho pode não ser suficiente.' : (error.message || 'Não foi possível abrir esse link.'), 'error');
  } finally { openButton.disabled = false; }
}

form.addEventListener('submit', event => { event.preventDefault(); loadUrl(urlInput.value); });
prevButton.addEventListener('click', () => selectItem(currentIndex - 1, true));
nextButton.addEventListener('click', () => selectItem(currentIndex + 1, true));
player.addEventListener('loadedmetadata', () => setStatus(''));
player.addEventListener('canplay', () => setStatus(''));
player.addEventListener('error', () => {
  const item = items[currentIndex];
  setStatus(`O item foi reconhecido como vídeo, mas esta fonte não pôde ser reproduzida pelo navegador.${item?.sourcePage ? ' A página pública do item foi encontrada corretamente.' : ''}`, 'error');
});
player.addEventListener('ended', () => { if (currentIndex < items.length - 1) selectItem(currentIndex + 1, true); });
clearHistoryButton.addEventListener('click', () => { localStorage.removeItem('teste-tesoura-history'); renderHistory(); });

renderHistory();
const initialUrl = new URL(location.href).searchParams.get('url');
if (initialUrl) { urlInput.value = initialUrl; loadUrl(initialUrl); }
