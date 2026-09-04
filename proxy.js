(() => {
  const nativeFetch = window.fetch.bind(window);
  const STORAGE_KEY = 'teste-tesoura-backend';

  function getConfiguredBackend() {
    if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
      return `${location.origin}/api/page`;
    }

    const fromQuery = new URL(location.href).searchParams.get('backend');
    if (fromQuery) {
      try {
        const parsed = new URL(fromQuery);
        const normalized = parsed.origin + parsed.pathname.replace(/\/$/, '');
        localStorage.setItem(STORAGE_KEY, normalized);
        return normalized;
      } catch {}
    }
    return localStorage.getItem(STORAGE_KEY) || '';
  }

  function backendUrl(targetUrl, mode = 'page') {
    const backend = getConfiguredBackend();
    if (!backend) return '';
    const endpoint = new URL(backend);
    endpoint.searchParams.set('url', targetUrl);
    if (mode !== 'page') endpoint.searchParams.set('mode', mode);
    return endpoint.href;
  }

  function wrapResponse(response, sourceUrl) {
    return new Proxy(response, {
      get(target, prop) {
        if (prop === 'url') return sourceUrl || target.headers.get('X-Source-Url') || target.url;
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  async function fetchThroughBackend(targetUrl) {
    const endpoint = backendUrl(targetUrl, 'page');
    if (!endpoint) throw new TypeError('Backend não configurado');
    const response = await nativeFetch(endpoint, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store'
    });
    if (!response.ok) return response;
    return wrapResponse(response, response.headers.get('X-Source-Url') || targetUrl);
  }

  window.fetch = async function(input, init) {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    if (!raw) return nativeFetch(input, init);

    let target;
    try { target = new URL(raw, location.href); }
    catch { return nativeFetch(input, init); }

    const external = target.origin !== location.origin;
    if (!external) return nativeFetch(input, init);

    if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
      return fetchThroughBackend(target.href);
    }

    try {
      return await nativeFetch(input, init);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return fetchThroughBackend(target.href);
    }
  };

  window.TesteTesouraBackend = {
    get: getConfiguredBackend,
    pageUrl(targetUrl) { return backendUrl(targetUrl, 'page'); },
    mediaUrl(targetUrl) { return backendUrl(targetUrl, 'media'); },
    set(value) {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:') throw new Error('O backend precisa usar HTTPS.');
      const normalized = parsed.origin + parsed.pathname.replace(/\/$/, '');
      localStorage.setItem(STORAGE_KEY, normalized);
      return normalized;
    },
    clear() { localStorage.removeItem(STORAGE_KEY); }
  };
})();
