(() => {
  const player = document.querySelector('#player');
  const statusBox = document.querySelector('#status');
  if (!player) return;

  function setStatus(message, type = '') {
    if (!statusBox) return;
    statusBox.hidden = !message;
    statusBox.textContent = message;
    statusBox.className = `status ${type}`.trim();
  }

  function isBunkrDownload(url) {
    return /^https:\/\/dl\.bunkr\.[a-z0-9.-]+\/file\/\d+(?:[/?#]|$)/i.test(String(url || ''));
  }

  player.addEventListener('error', () => {
    const original = player.currentSrc || player.src || '';
    if (!isBunkrDownload(original)) return;
    if (player.dataset.proxyAttempted === '1') return;

    const backend = window.TesteTesouraBackend?.get?.() || '';
    const mediaUrl = window.TesteTesouraBackend?.mediaUrl?.(original) || '';
    if (!backend || !mediaUrl) {
      setStatus('O link de arquivo foi encontrado. Para reproduzir online no iPad/PC, é necessário ativar o backend HTTPS do player.', 'error');
      return;
    }

    player.dataset.proxyAttempted = '1';
    setStatus('Tentando reprodução pelo backend online…');
    player.src = mediaUrl;
    player.load();
    player.play().catch(() => {});
  }, true);

  player.addEventListener('loadedmetadata', () => {
    if (player.dataset.proxyAttempted === '1') setStatus('');
  });
})();
