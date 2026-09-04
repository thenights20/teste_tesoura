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
let lastSubmittedUrl = '';

const directVideoRe = /\.(mp4|webm|mov|m4v|mkv)(?:$|[?#])/i;
const videoNameRe = /\.(mp4|webm|mov|m4v|mkv)\b/i;
const itemPathRe = /\/(f|i|v)\/[A-Za-z0-9]+(?:$|[/?#])/i;
const MAX_ITEM_PAGES = 30;

function setStatus(message = '', type = '') {
  statusBox.hidden = !message;
  statusBox.textContent = message;
  statusBox.className = `status ${type}`.trim();
}

function cleanTitle(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeUrl(value, base) {
  try { return new URL(value, base).href; } catch { return null; }
}

function isHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
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

function classifyCandidate(url, hint = '') {
  const text = `${url} ${hint}`;
  if (directVideoRe.test(url)) return 'direct';
  if (/player|embed/i.test(text)) return 'embed';
  return 'unknown';
}

function extractCandidates(html, pageUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const candidates = [];
  const seen = new Set();

  function add(raw, title = '', priority = 9, forcedKind = '') {
    const url = normalizeUrl(raw, pageUrl);
    if (!url || !/^https:/i.test(url) || seen.has(url) || isClosedCandidate(url, title)) return;
    const kind = forcedKind || classifyCandidate(url, title);
    if (kind === 'unknown') return;
    seen.add(url);
    candidates.push({ url, title: cleanTitle(title) || titleFromUrl(url), kind, priority });
  }

  for (const node of doc.querySelectorAll('video[src]')) {
    add(node.getAttribute('src'), node.getAttribute('title') || pageTitle(doc), 1, 'direct');
  }
  for (const node of doc.querySelectorAll('video source[src]')) {
    add(node.getAttribute('src'), node.getAttribute('title') || pageTitle(doc), 1, 'direct');
  }

  for (const node of doc.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player"], meta[name="twitter:player:stream"]')) {
    const raw = node.getAttribute('content');
    const forcedKind = /twitter:player$/.test(node.getAttribute('name') || '') ? 'embed' : '';
    add(raw, pageTitle(doc), 2, forcedKind);
  }

  for (const node of doc.querySelectorAll('iframe[src]')) {
    add(node.getAttribute('src'), node.getAttribute('title') || pageTitle(doc), 2, 'embed');
  }

  for (const node of doc.querySelectorAll('a[href]')) {
    const url = normalizeUrl(node.getAttribute('href'), pageUrl);
    if (url && directVideoRe.test(url)) {
      add(url, node.getAttribute('title') || node.textContent || pageTitle(doc), 3, 'direct');
    }
  }

  const rawUrls = html.match(/https?:\\?\/\\?\/[^"'<>\s]+?\.(?:mp4|webm|mov|m4v|mkv)(?:\?[^\u0022'<>\s]*)?/gi) || [];
  for (const raw of rawUrls) {
    add(raw.replace(/\\\//g, '/').replace(/&amp;/g, '&'), pageTitle(doc), 4, 'direct');
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
  for (let i = 0; sibling && i < 4; i++, sibling = sibling.previousElementSibling) {
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

  function addPage(anchor, title = '', forceVideo = false, node = null) {
    if (!anchor) return;
    const absolute = normalizeUrl(anchor.getAttribute('href'), pageUrl);
    if (!absolute || directVideoRe.test(absolute)) return;

    let parsed;
    try { parsed = new URL(absolute); } catch { return; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== base.hostname || !itemPathRe.test(parsed.pathname + parsed.search)) return;

    const nearby = cleanTitle(`${title} ${anchor.textContent || ''} ${anchor.parentElement?.textContent || ''}`);
    if (!(forceVideo || /^\/v\//i.test(parsed.pathname) || videoNameRe.test(nearby))) return;

    const id = node?.getAttribute?.('data-file-id') || node?.getAttribute?.('data-id') || '';
    const match = parsed.pathname.match(/\/(f|i|v)\/([A-Za-z0-9]+)/i);
    const key = id ? `id:${id}` : (match ? `${match[1].toLowerCase()}/${match[2]}` : parsed.pathname);
    if (seen.has(key)) return;
    seen.add(key);

    found.push({ key, url: absolute, title: cleanTitle(title) || nearby || `Vídeo ${found.length + 1}` });
  }

  const cards = [...doc.querySelectorAll('.grid-videos_box-txt')];
  for (const block of cards) {
    const text = cleanTitle(block.textContent || '');
    if (!videoNameRe.test(text) && !block.closest('[data-file-id],[data-id]')) continue;
    addPage(findNearbyAnchor(block), text, videoNameRe.test(text), block.closest('[data-file-id],[data-id]'));
    if (found.length >= MAX_ITEM_PAGES) return found;
  }

  for (const node of doc.querySelectorAll('[data-file-id], [data-id]')) {
    const text = cleanTitle(node.textContent || node.parentElement?.textContent || '');
    if (!videoNameRe.test(text)) continue;
    addPage(findNearbyAnchor(node), text, true, node);
    if (found.length >= MAX_ITEM_PAGES) return found;
  }

  if (!found.length) {
    for (const anchor of doc.querySelectorAll('a[href]')) {
      const text = cleanTitle(anchor.parentElement?.textContent || anchor.textContent || '');
      addPage(anchor, text, videoNameRe.test(text));
      if (found.length >= MAX_ITEM_PAGES) break;
    }
  }

  return found;
}

async function fetchPublicPage(url) {
  const response = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw new Error(`Falha HTTP ${response.status}`);
  return { response, contentType: (response.headers.get('content-type') || '').toLowerCase() };
}

async function resolvePublicItem(entry) {
  const item = { key: entry.key, title: entry.title, sourcePage: entry.url, url: '', kind: '', playable: false };
  try {
    const { response, contentType } = await fetchPublicPage(entry.url);
    if (contentType.startsWith('video/')) {
      item.url = response.url;
      item.kind = 'direct';
      item.playable = true;
      return item;
    }

    const child = extractCandidates(await response.text(), response.url || entry.url);
    const direct = child.candidates.find(c => c.kind === 'direct');
    const embed = child.candidates.find(c => c.kind === 'embed');
    const candidate = direct || embed;
    if (candidate) {
      item.url = candidate.url;
      item.kind = candidate.kind;
      item.playable = true;
    }
  } catch (error) {
    item.error = error?.message || 'Falha ao consultar a página do item.';
  }
  return item;
}

async function discoverVideos(html, pageUrl) {
  const page = extractCandidates(html, pageUrl);
  const itemPages = findVideoItemPages(page.doc, pageUrl);

  if (!itemPages.length) {
    const candidate = page.candidates.find(c => c.kind === 'direct') || page.candidates.find(c => c.kind === 'embed');
    return {
      title: page.title,
      items: [{
        title: page.title,
        sourcePage: pageUrl,
        url: candidate?.url || '',
        kind: candidate?.kind || '',
        playable: Boolean(candidate?.url)
      }]
    };
  }

  const result = [];
  for (let i = 0; i < itemPages.length; i++) {
    setStatus(`Verificando vídeos… ${i + 1} de ${itemPages.length}`);
    result.push(await resolvePublicItem(itemPages[i]));
  }

  return { title: page.title, items: result };
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
    type.textContent = item.playable
      ? (item.kind === 'embed' ? 'Vídeo • player público encontrado' : 'Vídeo • fonte direta encontrada')
      : 'Vídeo • identificado, fonte não exposta';

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
  imageViewer.hidden = true;
}

function showEmbed(url) {
  player.hidden = true;
  imageViewer.hidden = false;
  imageViewer.innerHTML = '';
  const frame = document.createElement('iframe');
  frame.src = url;
  frame.allow = 'autoplay; fullscreen; picture-in-picture';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.style.width = '100%';
  frame.style.minHeight = '420px';
  frame.style.border = '0';
  imageViewer.appendChild(frame);
  setStatus('Player público carregado.');
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
    imageViewer.textContent = 'Vídeo identificado. A página consultada não expôs uma fonte direta ou player público utilizável pelo navegador.';
    setStatus('O vídeo foi identificado, mas a fonte reproduzível não foi exposta diretamente nesta página.', 'error');
    renderPlaylist();
    return;
  }

  if (item.kind === 'embed') {
    showEmbed(item.url);
    renderPlaylist();
    return;
  }

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
  items[currentIndex] = { ...items[currentIndex], url, kind: 'direct', playable: true, manual: true };
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
  const target = String(rawUrl || '').trim();
  if (!target) {
    setStatus('Cole um link válido.', 'error');
    return;
  }

  lastSubmittedUrl = target;
  urlInput.value = target;
  setStatus('Lendo o conteúdo público…');
  openButton.disabled = true;
  viewer.hidden = true;

  try {
    let data;

    if (directVideoRe.test(target) && isHttpsUrl(target)) {
      data = {
        title: titleFromUrl(target),
        items: [{ title: titleFromUrl(target), url: target, kind: 'direct', playable: true, sourcePage: target }]
      };
    } else {
      const { response, contentType } = await fetchPublicPage(target);
      if (contentType.startsWith('video/')) {
        data = {
          title: titleFromUrl(response.url),
          items: [{ title: titleFromUrl(response.url), url: response.url, kind: 'direct', playable: true, sourcePage: target }]
        };
      } else {
        data = await discoverVideos(await response.text(), response.url || target);
      }
    }

    if (!data.items?.length) throw new Error('Nenhum vídeo foi identificado nesse link.');

    items = data.items;
    currentIndex = 0;
    albumTitle.textContent = data.title || 'Conteúdo';
    count.textContent = String(items.length);
    viewer.hidden = false;

    const playableCount = items.filter(item => item.playable).length;
    const embedCount = items.filter(item => item.kind === 'embed').length;
    if (!playableCount) {
      setStatus(`Reconheci ${items.length} vídeo(s), mas nenhum expôs fonte direta ou player público utilizável.`, 'error');
    } else if (playableCount < items.length) {
      setStatus(`Reconheci ${items.length} vídeo(s); ${playableCount} têm uma forma pública de reprodução${embedCount ? ` (${embedCount} via player público)` : ''}.`);
    } else {
      setStatus(`Reconheci ${items.length} vídeo(s) com forma pública de reprodução.`);
    }

    selectItem(0, false);
    saveHistory(target, data.title);

    const nextUrl = new URL(location.href);
    nextUrl.searchParams.set('url', target);
    history.replaceState(null, '', nextUrl);
  } catch (error) {
    items = [];
    playlist.innerHTML = '';
    viewer.hidden = true;
    urlInput.value = lastSubmittedUrl;
    const message = error instanceof TypeError
      ? 'O navegador bloqueou a leitura da página por CORS. O link foi preservado; o GitHub Pages não consegue ler essa resposta diretamente.'
      : (error?.message || 'Não foi possível abrir esse link.');
    setStatus(message, 'error');
  } finally {
    openButton.disabled = false;
    urlInput.value = lastSubmittedUrl;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  event.stopPropagation();
  loadUrl(urlInput.value);
});

prevButton.addEventListener('click', () => selectItem(currentIndex - 1, true));
nextButton.addEventListener('click', () => selectItem(currentIndex + 1, true));
directUrlButton.addEventListener('click', useAuthorizedDirectUrl);

player.addEventListener('loadedmetadata', () => setStatus(''));
player.addEventListener('canplay', () => setStatus(''));
player.addEventListener('error', () => {
  const item = items[currentIndex];
  const code = player.error?.code ? ` Código ${player.error.code}.` : '';
  setStatus(`A fonte foi encontrada, mas o navegador não conseguiu reproduzi-la.${code}`, 'error');
  if (item) item.playbackError = true;
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
  lastSubmittedUrl = initialUrl;
  urlInput.value = initialUrl;
  loadUrl(initialUrl);
}
