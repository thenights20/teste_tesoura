(() => {
  const previousFetch = window.fetch.bind(window);
  const filePageRe = /^https:\/\/bunkr\.[a-z0-9.-]+\/f\/[A-Za-z0-9]+(?:[/?#]|$)/i;
  const dlRe = /^https:\/\/dl\.bunkr\.[a-z0-9.-]+\/file\/\d+(?:[/?#]|$)/i;

  function augmentPublicFilePage(html, pageUrl) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const existing = [...doc.querySelectorAll('a[href]')]
        .map(a => {
          try { return new URL(a.getAttribute('href'), pageUrl).href; } catch { return ''; }
        })
        .find(href => dlRe.test(href));
      if (existing) return html;

      const ids = new Set();
      doc.querySelectorAll('[data-file-id],[data-id]').forEach(node => {
        const value = node.getAttribute('data-file-id') || node.getAttribute('data-id') || '';
        if (/^\d+$/.test(value)) ids.add(value);
      });

      const downloadish = [...doc.querySelectorAll('a[href],button,[data-url],[data-href]')];
      for (const node of downloadish) {
        const label = `${node.textContent || ''} ${node.getAttribute?.('title') || ''} ${node.getAttribute?.('aria-label') || ''}`.toLowerCase();
        if (!/download|baixar/.test(label)) continue;
        for (const attr of ['href','data-url','data-href']) {
          const raw = node.getAttribute?.(attr) || '';
          const match = raw.match(/\/file\/(\d+)/i);
          if (match) ids.add(match[1]);
        }
      }

      if (!ids.size) return html;
      const host = document.createElement('div');
      host.setAttribute('data-teste-tesoura-public-links', '1');
      host.style.display = 'none';
      for (const id of ids) {
        const a = document.createElement('a');
        a.href = `https://dl.bunkr.cr/file/${id}`;
        a.textContent = 'Download';
        host.appendChild(a);
      }
      doc.body?.appendChild(host);
      return '<!doctype html>\n' + doc.documentElement.outerHTML;
    } catch {
      return html;
    }
  }

  window.fetch = async function(input, init) {
    const response = await previousFetch(input, init);
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
    let target = raw;
    try { target = new URL(raw, location.href).href; } catch {}
    if (!filePageRe.test(target)) return response;

    const type = (response.headers.get('content-type') || '').toLowerCase();
    if (!(type.includes('text/html') || type.includes('application/xhtml+xml') || type.startsWith('text/'))) return response;

    return new Proxy(response, {
      get(targetResponse, prop) {
        if (prop === 'text') {
          return async () => augmentPublicFilePage(await targetResponse.text(), targetResponse.url || target);
        }
        const value = Reflect.get(targetResponse, prop, targetResponse);
        return typeof value === 'function' ? value.bind(targetResponse) : value;
      }
    });
  };
})();
