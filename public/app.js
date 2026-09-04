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
const directUrlButton = document.querySelector('#direct-url');
const historyBox = document.querySelector('#history');
const clearHistoryButton = document.querySelector('#clear-history');

let items = [];
let currentIndex = 0;

const directVideoRe = /\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])/i;
const videoNameRe = /\.(mp4|webm|mov|m4v|mkv)\b/i;
const itemPathRe = /\/(f|i|v)\/[A-Za-z0-9]+(?:$|[/?#])/i;
const MAX_ITEM_PAGES = 24;

function setStatus(message = '', type = '') {
  statusBox.hidden = !message;
  statusBox.textContent = message;
  statusBox.className = `status ${type}`.trim();
}

function cleanTitle(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeUrl(value, base) {
  try { return new URL(value, base).href; } catch { return null; }
}

function titleFromUrl(url) {
  try {
    const name = new URL(url).pathname.split('/').filter(Boolean).pop() || 'Vídeo';
    return decodeURIComponent(name).replace(/[-_]+/g, ' ');
  } catch { return 'Vídeo'; }
}

function pageTitle(doc) {
  return cleanTitle(
    doc.querySelector('meta[property="og:title"]')?.content ||
    doc.querySelector('meta[name="twitter:title"]')?.content ||
    doc.querySelector('title')?.textContent ||
    'Conteúdo'
  );
}

function isClosedCandidate(url = '', title = '') {
  return /(^|[\/_-])closed([\/_-.?#]|$)/i.test(`${url} ${title}`);
}

function isHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function extractVideoCandidates(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const candidates = [];
  const seen = new Set();

  function add(raw, title = '', priority = 9) {
    const url = normalizeUrl(raw, pageUrl);
    if (!url || seen.has(url) || isClosedCandidate(url, title)) return;
    if (!/^https:/i.test(url)) return;
    seen.add(url);
    candidates.push({ url, title: cleanTitle(title) || titleFromUrl(url), playable: true, priority });
  }

  for (const node of doc.querySelectorAll('video[src]')) {
    add(node.getAttribute('src'), node.getAttribute('title') || pageTitle(doc), 1);
  }

  for (const node of doc.querySelectorAll('video source[src]')) {
    add(node.getAttribute('src'), node.getAttribute('title') || pageTitle(doc), 1);
  }

  for (const node of doc.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]')) {
    add(node.getAttribute('content'), pageTitle(doc), 2);
  }

  for (const node of doc.querySelectorAll('a[href]')) {
    const url = normalizeUrl(node.getAttribute('href'), pageUrl);
    if (url && directVideoRe.test(url)) {
      add(url, node.getAttribute('title') || node.textContent || pageTitle(doc), 3);
    }
  }

  const rawUrls = html.match(/https?:\\?\/\\?\/[^"'<>\s]+?\.(?:mp4|webm|mov|m4v|mkv)(?:\?[^\u0022'<>\s]*)?/gi) || [];
  for (const raw of rawUrls) {
    add(raw.replace(/\\\//g, '/').replace(/&amp;/g, '&'), pageTitle(doc), 4);
  }

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
    const anchor = sibling.querySelector?.('a[href]');
    if (anchor) return anchor;
  }
  return node.parentElement?.querySelector?.('a[href]') || null;
}

function findVideoItemPages(doc, pageUrl) {
  const base = new URL(pageUrl);
  const found = [];
  const seen = new Set();

  function addPage(anchor, title = '', forceVideo = false) {
    if (!anchor) return;
    const absolute = normalizeUrl(anchor.getAttribute('href'), pageUrl);
    if (!absolute || directVideoRe.test(absolute)) return;

    let parsed;
    try { parsed = new URL(absolute); } catch { return; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== base.hostname) return;
    if (!itemPathRe.test(parsed.pathname + parsed.search)) return;

    const nearby = cleanTitle(`${title} ${anchor.textContent || ''} ${anchor.parentElement?.textContent || ''}`);
    if (!(forceVideo || /^\/v\//i.test(parsed.pathname) || videoNameRe.test(nearby))) return;

    const match = parsed.pathname.match(/\/(f|i|v)\/([A-Za-z0-9]+)/i);
    const key = match ? `${match[1].toLowerCase()}/${match[2]}` : parsed.pathname;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ key, url: absolute, title: cleanTitle(title) || nearby || titleFromUrl(absolute) });
  }

  for (const block of doc.querySelectorAll('.grid-videos_box-txt')) {
    addPage(findNearbyAnchor(block), block.textContent || '', true);
    if (found.length >= MAX_ITEM_PAGES) return found;
  }

  if (!found.length) {
    for (const node of doc.querySelectorAll('[data-file-id], [data-id]')) {
      const text = cleanTitle(node.textContent || node.parentElement?.textContent || '');
      addPage(findNearbyAnchor(node), text, videoNameRe.test(text));
      if (found.length >= MAX_ITEM_PAGES) return found;
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

async function discoverVideos(html, pageUrl) {
  const page = extractVideoCandidates(html, pageUrl);
  const itemPages = findVideoItemPages(page.doc, pageUrl);

  if (!itemPages.length) {
    const candidate = page.candidates[0];
    return {
      title: page.title,
      items: [{
        title: page.title,
        sourcePage: pageUrl,
        url: candidate?.url || '',
        playable: Boolean(candidate?.url)
      }],
      detected: 1
    };
  }

  const result = [];
  for (let i = 0; i < itemPages.length; i++) {
    const entry = itemPages[i];
    setStatus(`Verificando vídeos… ${i + 1} de ${itemPages.length}`);

    const item = {
      key: entry.key,
      title: entry.title,
      sourcePage: entry.url,
      url: '',
      playable: false
    };

    try {
      const { response, contentType } = await fetchPublicPage(entry.url);
      if (contentType.startsWith('video/')) {
        item.url = response.url;
        item.playable = true;
      } else {
        const child = extractVideoCandidates(await response.text(), response.url || entry.url);
        const candidate = child.candidates.find(c => !isClosedCandidate(c.url, c.title));
        if (candidate) {
          item.url = candidate.url;
          item.playable = true;
        }
      }
    } catch {}

    result.push(item);
  }

  return { title: page.title, items: result, detected: itemPages.length };
}

function renderPlaylist() {
  playlist.innerHTML = '';
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `media-item${index === currentIndex ? ' active' : ''}`;

    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    thumb.textContent = item.playable ? '▶' : '—';

    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'media-name';
    name.textContent = item.title || `Vídeo ${index + 1}`;

    const type = document.createElement('span');
    type.className = 'media-type';
    type.textContent = item.playable ? 'Vídeo • fonte direta encontrada' : 'Vídeo • fonte não direta';

    text.append(name, type);
    button.append(thumb, text);
    button.addEventListener('click', () => selectItem(index, true));
    playlist.appendChild(button);
  });
}

function resetPlayer() {
  player.pause();
  player.removeAttribute('src');
  player.load();
  imageViewer.innerHTML = '';
}

function selectItem(index, autoplay = false) {
  if (!items.length) return;
  currentIndex = Math.max(0, Math.min(index, items.length - 1));
  const item = items[currentIndex];

  currentTitle.textContent = item.title || `Vídeo ${currentIndex + 1}`;
  position.textContent = `${currentIndex + 1} de ${items.length}`;
  prevButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === items.length - 1;

  resetPlayer();
  if (!item.playable || !item.url) {
    player.hidden = true;
    imageViewer.hidden = false;
    imageViewer.textContent = 'Vídeo identificado. Nenhuma fonte pública direta foi encontrada nesta página.';
    setStatus('O vídeo foi identificado corretamente, mas a página não expôs uma fonte direta reproduzível. Você pode usar uma URL direta autorizada pelo botão abaixo.', 'error');
    renderPlaylist();
    return;
  }

  imageViewer.hidden = true;
  player.hidden = false;
  setStatus('Carregando vídeo…');
  player.src = item.url;
  player.load();
  if (autoplay) player.play().catch(() => {});
  renderPlaylist();
}

function useAuthorizedDirectUrl() {
  if (!items.length) return;
  const value = prompt('Cole uma URL direta HTTPS autorizada para este vídeo:');
  if (!value) return;
  const url = value.trim();
  if (!isHttpsUrl(url)) {
    setStatus('A URL direta precisa usar HTTPS.', 'error');
    return;
  }

  items[currentIndex] = { ...items[currentIndex], url, playable: true, manual: true };
  selectItem(currentIndex, true);
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

    if (directVideoRe.test(target) && isHttpsUrl(target)) {
      data = {
        title: titleFromUrl(target),
        items: [{ title: titleFromUrl(target), url: target, playable: true, sourcePage: target }],
        detected: 1
      };
    } else {
      const { response, contentType } = await fetchPublicPage(target);
      if (contentType.startsWith('video/')) {
        data = {
          title: titleFromUrl(response.url),
          items: [{ title: titleFromUrl(response.url), url: response.url, playable: true, sourcePage: target }],
          detected: 1
        };
      } else {
        data = await discoverVideos(await response.text(), response.url || target);
      }
    }

    if (!data.items.length) throw new Error('Nenhum vídeo foi identificado nesse link.');

    items = data.items;
    currentIndex = 0;
    albumTitle.textContent = data.title || 'Conteúdo';
    count.textContent = String(items.length);
    viewer.hidden = false;

    const playableCount = items.filter(item => item.playable).length;
    if (!playableCount) {
      setStatus(`Reconheci ${items.length} vídeo(s), mas nenhuma fonte pública direta reproduzível foi exposta.`, 'error');
    } else if (playableCount < items.length) {
      setStatus(`Reconheci ${items.length} vídeo(s); ${playableCount} têm fonte direta encontrada.`, '');
    } else {
      setStatus('');
    }

    selectItem(0, false);
    saveHistory(target, data.title);

    const nextUrl = new URL(location.href);
    nextUrl.searchParams.set('url', target);
    history.replaceState(null, '', nextUrl);
  } catch (error) {
    items = [];
    playlist.innerHTML = '';
    setStatus(
      error instanceof TypeError
        ? 'O navegador bloqueou a leitura da página por CORS. O GitHub Pages não consegue ler essa resposta diretamente.'
        : (error.message || 'Não foi possível abrir esse link.'),
      'error'
    );
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
directUrlButton.addEventListener('click', useAuthorizedDirectUrl);

player.addEventListener('loadedmetadata', () => setStatus(''));
player.addEventListener('canplay', () => setStatus(''));
player.addEventListener('error', () => {
  const item = items[currentIndex];
  if (!item) return;
  item.playable = false;
  setStatus('A fonte encontrada não pôde ser reproduzida pelo navegador. O vídeo continua identificado e você pode informar uma URL direta autorizada.', 'error');
  renderPlaylist();
});
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
