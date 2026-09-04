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
  } catch {
    return 'Mídia';
  }
}

function isMediaUrl(url) {
  return mediaRe.test(url || '');
}

function mediaType(url) {
  return imageRe.test(url || '') ? 'image' : 'video';
}

function humanType(item) {
  return item.type === 'image' ? 'Imagem' : 'Vídeo';
}

function addUnique(list, seen, url, title = '', forcedType = '') {
  if (!url || seen.has(url)) return;
  const type = forcedType || (isMediaUrl(url) ? mediaType(url) : '');
  if (!type) return;
  seen.add(url);
  list.push({ url, title: cleanTitle(title) || titleFromUrl(url), type });
}

function pageTitle(doc) {
  return cleanTitle(
    doc.querySelector('meta[property="og:title"]')?.content ||
    doc.querySelector('meta[name="twitter:title"]')?.content ||
    doc.querySelector('title')?.textContent ||
    'Conteúdo'
  );
}

function extractFromHtml(html, pageUrl) {
  const found = [];
  const seen = new Set();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const node of doc.querySelectorAll('video[src], source[src]')) {
    addUnique(found, seen, normalizeUrl(node.getAttribute('src'), pageUrl), node.getAttribute('title') || '', 'video');
  }

  for (const node of doc.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]')) {
    addUnique(found, seen, normalizeUrl(node.getAttribute('content'), pageUrl), pageTitle(doc), 'video');
  }

  for (const node of doc.querySelectorAll('a[href]')) {
    const absolute = normalizeUrl(node.getAttribute('href'), pageUrl);
    if (absolute && isMediaUrl(absolute)) {
      addUnique(found, seen, absolute, node.getAttribute('title') || node.textContent || '');
    }
  }

  const absoluteMedia = html.match(/https?:\\?\/\\?\/[^"'<>\s]+?\.(?:mp4|webm|mov|m4v|mkv|jpg|jpeg|png|gif|webp)(?:\?[^\u0022'<>\s]*)?/gi) || [];
  for (const raw of absoluteMedia) {
    addUnique(found, seen, raw.replace(/\\\//g, '/').replace(/&amp;/g, '&'));
  }

  return { title: pageTitle(doc), items: found, doc };
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

  const parent = node.parentElement;
  if (parent) {
    const a = parent.querySelector('a[href]');
    if (a) return a;
  }
  return null;
}

function findVideoItemPages(doc, pageUrl) {
  const base = new URL(pageUrl);
  const found = [];
  const seen = new Set();

  function addPage(anchor, title = '', forceVideo = false) {
    if (!anchor) return;
    const absolute = normalizeUrl(anchor.getAttribute('href'), pageUrl);
    if (!absolute || seen.has(absolute) || isMediaUrl(absolute)) return;

    let parsed;
    try { parsed = new URL(absolute); } catch { return; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== base.hostname) return;
    if (!itemPathRe.test(parsed.pathname + parsed.search)) return;

    const nearby = cleanTitle([
      title,
      anchor.textContent || '',
      anchor.getAttribute('title') || '',
      anchor.getAttribute('aria-label') || '',
      anchor.parentElement?.textContent || ''
    ].join(' '));

    const looksVideo = forceVideo || /^\/v\//i.test(parsed.pathname) || videoNameRe.test(nearby);
    if (!looksVideo) return;

    seen.add(absolute);
    found.push({ url: absolute, title: nearby || titleFromUrl(absolute) });
  }

  // Estrutura usada nos álbuns: caixa de texto do vídeo + link irmão anterior.
  for (const block of doc.querySelectorAll('.grid-videos_box-txt')) {
    const anchor = findNearbyAnchor(block);
    addPage(anchor, block.textContent || '', true);
    if (found.length >= MAX_ITEM_PAGES) return found;
  }

  // IDs presentes no card/HTML. Não resolvemos o ID por API; usamos apenas o link público associado ao card.
  for (const node of doc.querySelectorAll('[data-file-id], [data-id]')) {
    const anchor = findNearbyAnchor(node);
    const text = cleanTitle(node.textContent || node.parentElement?.textContent || '');
    addPage(anchor, text, videoNameRe.test(text));
    if (found.length >= MAX_ITEM_PAGES) return found;
  }

  // Fallback: links públicos de item /f/, /i/ ou /v/ com contexto de vídeo.
  for (const anchor of doc.querySelectorAll('a[href]')) {
    addPage(anchor, anchor.parentElement?.textContent || anchor.textContent || '', false);
    if (found.length >= MAX_ITEM_PAGES) break;
  }

  return found;
}

async function fetchPublicPage(url) {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
  if (!response.ok) throw new Error(`Falha HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  return { response, contentType };
}

async function discoverAlbumVideos(html, pageUrl) {
  const top = extractFromHtml(html, pageUrl);
  const directVideos = top.items.filter(item => item.type === 'video');
  const itemPages = findVideoItemPages(top.doc, pageUrl);

  const collected = [...directVideos];
  const seen = new Set(collected.map(item => item.url));

  for (let i = 0; i < itemPages.length; i++) {
    const entry = itemPages[i];
    setStatus(`Abrindo itens de vídeo… ${i + 1} de ${itemPages.length}`);

    try {
      const { response, contentType } = await fetchPublicPage(entry.url);

      if (contentType.startsWith('video/')) {
        if (!seen.has(response.url)) {
          seen.add(response.url);
          collected.push({ url: response.url, title: entry.title, type: 'video' });
        }
        continue;
      }

      const childHtml = await response.text();
      const child = extractFromHtml(childHtml, response.url || entry.url);
      for (const item of child.items.filter(item => item.type === 'video')) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        collected.push({ ...item, title: videoNameRe.test(entry.title) ? entry.title : (item.title || entry.title) });
      }
    } catch {
      // Mantém o restante da lista mesmo quando um item individual bloqueia leitura no navegador.
    }
  }

  return {
    title: top.title,
    items: collected,
    detectedVideoPages: itemPages.length,
    fallbackItems: top.items
  };
}

function renderPlaylist() {
  playlist.innerHTML = '';
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `media-item${index === currentIndex ? ' active' : ''}`;

    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    thumb.textContent = item.type === 'video' ? '▶' : 'IMG';

    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'media-name';
    name.textContent = item.title || `Arquivo ${index + 1}`;
    const type = document.createElement('span');
    type.className = 'media-type';
    type.textContent = humanType(item);
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

  currentTitle.textContent = item.title || `Arquivo ${currentIndex + 1}`;
  position.textContent = `${currentIndex + 1} de ${items.length}`;
  prevButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === items.length - 1;

  player.pause();
  player.removeAttribute('src');
  player.load();
  imageViewer.innerHTML = '';

  if (item.type === 'image') {
    player.hidden = true;
    imageViewer.hidden = false;
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = item.title || 'Imagem';
    imageViewer.appendChild(img);
  } else {
    imageViewer.hidden = true;
    player.hidden = false;
    player.src = item.url;
    if (autoplay) player.play().catch(() => {});
  }

  renderPlaylist();
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem('teste-tesoura-history') || '[]'); }
  catch { return []; }
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
    button.addEventListener('click', () => {
      urlInput.value = entry.url;
      loadUrl(entry.url);
    });
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

    if (isMediaUrl(target)) {
      data = {
        title: titleFromUrl(target),
        items: [{ url: target, title: titleFromUrl(target), type: mediaType(target) }],
        detectedVideoPages: 0,
        fallbackItems: []
      };
    } else {
      const { response, contentType } = await fetchPublicPage(target);
      if (contentType.startsWith('video/')) {
        data = {
          title: titleFromUrl(response.url),
          items: [{ url: response.url, title: titleFromUrl(response.url), type: 'video' }],
          detectedVideoPages: 1,
          fallbackItems: []
        };
      } else {
        const html = await response.text();
        data = await discoverAlbumVideos(html, response.url || target);
      }
    }

    if (!data.items.length) {
      if (data.detectedVideoPages > 0) {
        throw new Error(`Encontrei ${data.detectedVideoPages} item(ns) de vídeo no álbum, mas as páginas individuais não expuseram uma fonte pública de vídeo que o navegador pudesse reproduzir.`);
      }
      throw new Error('Nenhum vídeo público reproduzível foi encontrado nesse link.');
    }

    items = data.items;
    currentIndex = 0;
    albumTitle.textContent = data.title || 'Conteúdo';
    count.textContent = String(items.length);
    viewer.hidden = false;
    setStatus('');
    selectItem(0, false);
    saveHistory(target, data.title);

    const nextUrl = new URL(location.href);
    nextUrl.searchParams.set('url', target);
    history.replaceState(null, '', nextUrl);
  } catch (error) {
    items = [];
    playlist.innerHTML = '';
    const message = error instanceof TypeError
      ? 'O navegador bloqueou a leitura de uma das páginas por CORS. Para automatizar essa etapa será necessário um pequeno backend que apenas leia as páginas públicas.'
      : (error.message || 'Não foi possível abrir esse link.');
    setStatus(message, 'error');
  } finally {
    openButton.disabled = false;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  loadUrl(urlInput.value);
});
prevButton.addEventListener('click', () => selectItem(currentIndex - 1, true));
nextButton.addEventListener('click', () => selectItem(currentIndex + 1, true));
player.addEventListener('ended', () => {
  if (currentIndex < items.length - 1) selectItem(currentIndex + 1, true);
});
clearHistoryButton.addEventListener('click', () => {
  localStorage.removeItem('teste-tesoura-history');
  renderHistory();
});

renderHistory();
const initialUrl = new URL(location.href).searchParams.get('url');
if (initialUrl) {
  urlInput.value = initialUrl;
  loadUrl(initialUrl);
}
