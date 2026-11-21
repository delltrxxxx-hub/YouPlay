// YouPlay window bridge (page main world, YouTube Music + SoundCloud panel).
// Content scripts write <html data-yp-msg='{"t":..,"m":".."}'> / data-yp-caption; this forwards them to the native window.
(function () {
  const wv = window.chrome && window.chrome.webview;
  if (!wv) return;
  let lastCaption = '', lastMsg = '';
  const flush = () => {
    const d = document.documentElement && document.documentElement.dataset;
    if (!d) return;
    if (d.ypCaption && d.ypCaption !== lastCaption) { lastCaption = d.ypCaption; wv.postMessage('caption:' + d.ypCaption); }
    if (d.ypMsg && d.ypMsg !== lastMsg) { lastMsg = d.ypMsg; try { wv.postMessage(JSON.parse(d.ypMsg).m); } catch {} }
  };
  const start = () => { flush(); new MutationObserver(flush).observe(document.documentElement, { attributes: true, attributeFilter: ['data-yp-caption', 'data-yp-msg'] }); };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  // F11 toggles full screen of the YouPlay window
  addEventListener('keydown', (e) => { if (e.key === 'F11') { e.preventDefault(); wv.postMessage('fullscreen'); } }, true);
})();
