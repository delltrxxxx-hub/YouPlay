// YouPlay for Android — page prelude: what the Windows app gets from WebView2 / the extension runtime.
(function () {
  const N = window.YouPlayNative;
  if (!N) return;
  // music keeps playing when the app is in the background or the screen is off
  try {
    Object.defineProperty(Document.prototype, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible', configurable: true });
    document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
    window.addEventListener('pagehide', (e) => e.stopImmediatePropagation(), true);
  } catch (e) {}
  // the "window" bridge used by bridge.js (caption colour, fullscreen, SoundCloud jobs, updates, media notification)
  window.chrome = window.chrome || {};
  window.chrome.webview = { postMessage: (m) => N.postHost(String(m)) };
  // HTTP through the app (lyrics, SoundCloud oEmbed, GitHub)
  const pending = {}; let seq = 0;
  window.__ypNativeResolve = (id, r) => { const p = pending[id]; delete pending[id]; if (p) p(r); };
  window.__ypNativeFetch = (url) => new Promise((resolve) => {
    const id = 'f' + (++seq);
    pending[id] = (r) => resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.body), text: async () => r.body });
    N.fetch(id, String(url));
  });
})();
