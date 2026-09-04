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
const imageRe = /\.(jpg|jpeg|png|gif|webp)(?:$|[?#])/i;

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

function addUnique(list, seen, url, title = '') {
  if (!url || !isMediaUrl(url) || seen.has(url)) return;
  seen.add(url);
  list.push({ url, title: title || url.split('/').pop() || 'Mídia', type: mediaType(url) });
}

function extractFromHtml(html, pageUrl) {
  const found = [];
  const seen = new Set();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const title = doc.querySelector('meta[property="og:title"]')?.content ||
                doc.querySelector('title')?.textContent?.trim() || 'Conteúdo';

  const candidates = [
    ...doc.querySelectorAll('video[src], source[src], a[href], meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player:stream"]')
  ];

  for (const node of candidates) {
    const raw = node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('content');
    const absolute = normalizeUrl(raw, pageUrl);
    addUnique(found, seen, absolute, node.getAttribute('title') || node.textContent?.trim() || '');
  }

  const absoluteMedia = html.match(/https?:\\?\/\\?\/[^"'<>\s]+?\.(?:mp4|webm|mov|m4v|mkv|jpg|jpeg|png|gif|webp)(?:\?[^\u0022'<>\s]*)?/gi) || [];
  for (const raw of absoluteMedia) {
    const cleaned = raw.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    addUnique(found, seen, cleaned);
  }

  return { title, items: found };
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

  setStatus('Tentando abrir o conteúdo…');
  openButton.disabled = true;
  viewer.hidden = true;

  try {
    let data;

    if (isMediaUrl(target)) {
      data = {
        title: target.split('/').pop() || 'Conteúdo',
        items: [{ url: target, title: target.split('/').pop() || 'Mídia', type: mediaType(target) }]
      };
    } else {
      const response = await fetch(target, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!response.ok) throw new Error(`Falha HTTP ${response.status}`);
      const html = await response.text();
      data = extractFromHtml(html, target);
    }

    if (!Array.isArray(data.items) || !data.items.length) {
      throw new Error('Nenhuma mídia utilizável foi encontrada nesse link.');
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
    const corsHint = error instanceof TypeError
      ? 'O navegador bloqueou a leitura direta dessa página. Se você tiver a URL direta do arquivo de mídia, cole-a aqui.'
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
