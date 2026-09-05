(() => {
  const previousFetch = window.fetch.bind(window);
  const BUNKR_RE = /^https:\/\/(?:[^/]+\.)?bunkr\.[a-z0-9.-]+\//i;
  const TIMEOUT_MS = 12000;

  window.fetch = async function(input, init = {}) {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
    let target = raw;
    try { target = new URL(raw, location.href).href; } catch {}

    if (!BUNKR_RE.test(target) || init.signal) {
      return previousFetch(input, init);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await previousFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
})();
