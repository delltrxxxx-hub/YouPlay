// YouPlay equalizer: 10 bands through Web Audio on the page's own audio/video element (added only when turned on).
(function () {
  if (window.__ypEqReady) return; window.__ypEqReady = true;
  var FREQ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  window.__ypEqState = { on: false, g: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  window.__ypEqSetup = function (el) {
    if (!el || el.__ypEq) return;
    try {
      var C = window.__ypAC || (window.__ypAC = new (window.AudioContext || window.webkitAudioContext)());
      var src = C.createMediaElementSource(el);
      var pre = C.createGain();
      var bands = FREQ.map(function (fr, i) { var b = C.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === FREQ.length - 1 ? 'highshelf' : 'peaking'; b.frequency.value = fr; b.Q.value = 1.1; b.gain.value = 0; return b; });
      src.connect(pre); var n = pre; bands.forEach(function (b) { n.connect(b); n = b; }); n.connect(C.destination);
      el.__ypEq = { bands: bands, pre: pre };
      window.__ypEqApply();
    } catch (e) {}
  };
  window.__ypEqApply = function () {
    var s = window.__ypEqState, els = document.querySelectorAll('video, audio');
    for (var k = 0; k < els.length; k++) {
      var n = els[k].__ypEq; if (!n) continue;
      var top = 0;
      n.bands.forEach(function (b, i) { var g = s.on ? (s.g[i] || 0) : 0; b.gain.setTargetAtTime(g, b.context.currentTime, 0.04); if (g > top) top = g; });
      n.pre.gain.setTargetAtTime(Math.pow(10, -top * 0.8 / 20), n.pre.context.currentTime, 0.04);   // headroom so boosts don't clip
    }
  };
  window.__ypEq = function (on, g) {
    window.__ypEqState = { on: !!on, g: g || window.__ypEqState.g };
    if (on) { var els = document.querySelectorAll('video, audio'); for (var k = 0; k < els.length; k++) window.__ypEqSetup(els[k]); }
    window.__ypEqApply();
    if (window.__ypAC && window.__ypAC.state === 'suspended') window.__ypAC.resume();
  };
  setInterval(function () {
    if (window.__ypEqState.on) { var els = document.querySelectorAll('video, audio'); for (var k = 0; k < els.length; k++) if (!els[k].__ypEq) window.__ypEqSetup(els[k]); }
    if (window.__ypAC && window.__ypAC.state === 'suspended') window.__ypAC.resume();
  }, 1500);
})();
