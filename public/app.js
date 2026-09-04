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
const videoRe = /\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])/i;
const videoNameRe = /\.(mp4|webm|mov|m4v|mkv)\b/i;
const imageRe = /\.(jpg|jpeg|png|gif|webp)(?:$|[?#])/i;
const MAX_ITEM_PAGES = 16;

function setStatus(message = '', type = '') {
  statusBox.hidden = !message;
  statusBox.textContent = message;
  statusBox.className = `status ${type}`.trim();
}

function humanType(item) {
  if (item.type === 'image') return 'Imagem';
  if (item.type === 'video') return 'Vídeo';
  return 'Mídia';
}

function normalizeUrl(value, base) {
  try { return new URL(value, base).href; } catch { return null; }
}

function isMediaUrl(url) {
  return mediaRe.test(url || '');
}

function mediaType(url) {
  return imageRe.test(url || '') ? 'image' : 'video';
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
    const absolute = normalizeUrl(node.getAttribute('src'), pageUrl);
    addUnique(found, seen, absolute, node.getAttribute('title') || '', 'video');
  }

  for (const node of doc.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]')) {
    const absolute = normalizeUrl(node.getAttribute('content'), pageUrl);
    addUnique(found, seen, absolute, pageTitle(doc), 'video');
  }

  for (const node of doc.querySelectorAll('a[href]')) {
    const absolute = normalizeUrl(node.getAttribute('href'), pageUrl);
    if (!absolute || !isMediaUrl(absolute)) continue;
    addUnique(found, seen, absolute, node.getAttribute('title') || node.textContent || '');
  }

  const absoluteMedia = html.match(/https?:\\?\/\\?\/[^"'<>\s]+?\.(?:mp4|webm|mov|m4v|mkv|jpg|jpeg|png|gif|webp)(?:\?[^\u0022'<>\s]*)?/gi) || [];
  for (const raw of absoluteMedia) {
    const cleaned = raw.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    addUnique(found, seen, cleaned);
  }

  return { title: pageTitle(doc), items: found, doc };
}

function findVideoItemPages(doc, pageUrl) {
  const base = new URL(pageUrl);
  const found = [];
  const seen = new Set();

  for (const a of doc.querySelectorAll('a[href]')) {
    const absolute = normalizeUrl(a.getAttribute('href'), pageUrl);
    if (!absolute || seen.has(absolute) || isMediaUrl(absolute)) continue;

    let parsed;
    try { parsed = new URL(absolute); } catch { continue; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== base.hostname) continue;

    const ownText = cleanTitle([
      a.textContent || '',
      a.getAttribute('title') || '',
      a.getAttribute('aria-label') || '',
      a.getAttribute('download') || ''
    ].join(' '));
    const parentText = cleanTitle(a.parentElement?.textContent || '');
    const nearby = `${ownText} ${parentText}`;

    if (!videoNameRe.test(nearby)) continue;

    seen.add(absolute);
    found.push({ url: absolute, title: ownText || parentText || titleFromUrl(absolute) });
    if (found.length >= MAX_ITEM_PAGES) break;
  }

  return found;
}

async function discoverAlbumVideos(html, pageUrl) {
  const top = extractFromHtml(html, pageUrl);
  const directVideos = top.items.filter(item => item.type === 'video');
  const itemPages = findVideoItemPages(top.doc, pageUrl);

  if (!itemPages.length) {
    return { title: top.title, items: directVideos.length ? directVideos : top.items };
  }

  const collected = [...directVideos];
  const seen = new Set(collected.map(item => item.url));

  for (let i = 0; i < itemPages.length; i++) {
    const entry = itemPages[i];
    setStatus(`Procurando vídeos… ${i + 1} de ${itemPages.length}`);

    try {
      const response = await fetch(entry.url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!response.ok) continue;
      const childHtml = await response.text();
      const child = extractFromHtml(childHtml, response.url || entry.url);
      const videos = child.items.filter(item => item.type === 'video');

      for (const item of videos) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        collected.push({
          ...item,
          title: videoNameRe.test(entry.title) ? entry.title : (item.title || entry.title)
        });
      }
    } catch {}
  }

  return {
    title: top.title,
    items: collected.length ? collected : top.items
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
        items: [{ url: target, title: titleFromUrl(target), type: mediaType(target) }]
      };
    } else {
      const response = await fetch(target, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!response.ok) throw new Error(`Falha HTTP ${response.status}`);
      const html = await response.text();
      data = await discoverAlbumVideos(html, response.url || target);
    }

    if (!Array.isArray(data.items) || !data.items.length) {
      throw new Error('Nenhuma mídia utilizável foi encontrada nesse link.');
    }

    const videos = data.items.filter(item => item.type === 'video');
    items = videos.length ? videos : data.items;
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
    const corsHint = error instanceof TypeError
      ? 'O navegador bloqueou a leitura de uma das páginas. Tente novamente; se persistir, será necessário usar um pequeno backend para essa etapa.'
      : (error.message || 'Não foi possível abrir esse link.');
    setStatus(corsHint, 'error');
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
