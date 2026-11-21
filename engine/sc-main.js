// YouPlay — soundcloud.com main world: passes the JSON the SoundCloud site itself loads
// (search results, your likes, your profile) to the YouPlay content script. Nothing is requested on its own.
(function () {
  if (window.__ypScCap) return; window.__ypScCap = true;
  const WANT = /api-v2\.soundcloud\.com\/(search|me(\?|$|\/)|users\/\d+\/(track_)?likes|me\/(track_)?likes|me\/library)/;
  const hand = (url, text) => {
    if (!WANT.test(url)) return;
    try { window.postMessage({ ypScCap: { url, json: JSON.parse(text) } }, location.origin); } catch {}
  };
  const of = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const p = of.apply(this, arguments);
    if (WANT.test(url)) p.then((r) => r.clone().text().then((t) => hand(url, t))).catch(() => {});
    return p;
  };
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) { this.__ypUrl = String(url || ''); return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    if (WANT.test(this.__ypUrl || '')) this.addEventListener('load', () => { try { hand(this.__ypUrl, this.responseText); } catch {} });
    return os.apply(this, arguments);
  };
})();
