// YouPlay — runs in the page's main world at document_start: strips ads from player responses.
(function () {
  if (localStorage.getItem('yp-adblock') === '0') return;
  function mainWorldAdShield() {
    if (window.__ypShield) return; window.__ypShield = true;
    const KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
    const prune = (o) => {
      if (!o || typeof o !== 'object') return o;
      for (const k of KEYS) if (k in o) delete o[k];
      if (o.playerResponse && typeof o.playerResponse === 'object') prune(o.playerResponse);
      if (Array.isArray(o)) for (const x of o) if (x && x.playerResponse) prune(x.playerResponse);
      return o;
    };
    const jp = JSON.parse;
    JSON.parse = function () { const r = jp.apply(this, arguments); return (r && typeof r === 'object' && (r.adPlacements || r.playerAds || r.adSlots || r.playerResponse)) ? prune(r) : r; };
    const rj = Response.prototype.json;
    Response.prototype.json = function () { return rj.call(this).then(prune); };
    let ipr;
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', { configurable: true, get: () => ipr, set: (v) => { ipr = prune(v); } });
    } catch {}
  }
  mainWorldAdShield();
})();
