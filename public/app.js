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

function renderPlaylist() {
  playlist.innerHTML = '';
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `media-item${index === currentIndex ? ' active' : ''}`;

    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    if (item.thumbnail) {
      const img = document.createElement('img');
      img.src = item.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      thumb.textContent = item.type === 'video' ? '▶' : 'IMG';
    }

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
  try { return JSON.parse(localStorage.getItem('bunkr-viewer-history') || '[]'); }
  catch { return []; }
}

function saveHistory(url, title) {
  const history = getHistory().filter(item => item.url !== url);
  history.unshift({ url, title: title || url, at: Date.now() });
  localStorage.setItem('bunkr-viewer-history', JSON.stringify(history.slice(0, 12)));
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

  setStatus('Lendo a página pública e procurando mídias…');
  openButton.disabled = true;
  viewer.hidden = true;

  try {
    const response = await fetch(`/api/extract?url=${encodeURIComponent(target)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Falha HTTP ${response.status}`);
    if (!Array.isArray(data.items) || !data.items.length) {
      throw new Error('Nenhuma mídia pública utilizável foi encontrada nessa página.');
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
    setStatus(error.message || 'Não foi possível abrir esse link.', 'error');
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
  localStorage.removeItem('bunkr-viewer-history');
  renderHistory();
});

renderHistory();
const initialUrl = new URL(location.href).searchParams.get('url');
if (initialUrl) {
  urlInput.value = initialUrl;
  loadUrl(initialUrl);
}
