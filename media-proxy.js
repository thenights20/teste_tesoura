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

  function isBunkrMedia(url) {
    const raw = String(url || '');
    if (/^https:\/\/dl\.bunkr\.[a-z0-9.-]+\/file\/\d+(?:[/?#]|$)/i.test(raw)) return true;
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'https:' &&
        (parsed.hostname === 'cdn.cr' || parsed.hostname.endsWith('.cdn.cr')) &&
        parsed.searchParams.has('token') &&
        parsed.searchParams.has('ex');
    } catch {
      return false;
    }
  }

  player.addEventListener('error', () => {
    const original = player.currentSrc || player.src || '';
    if (!isBunkrMedia(original)) return;
    if (player.dataset.proxyAttempted === '1') return;

    const backend = window.TesteTesouraBackend?.get?.() || '';
    const mediaUrl = window.TesteTesouraBackend?.mediaUrl?.(original) || '';
    if (!backend || !mediaUrl) {
      setStatus('A mídia foi encontrada, mas este navegador não conseguiu abrir o CDN diretamente. Ative o backend HTTPS do player para usar o proxy de reprodução.', 'error');
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
