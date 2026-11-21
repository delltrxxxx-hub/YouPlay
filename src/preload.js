'use strict';
/* YouPlay preload — runs in an isolated world on music.youtube.com.
   Everything here touches the DOM via safe APIs only (no innerHTML: YT Music enforces Trusted Types). */
const { ipcRenderer, contextBridge, webFrame } = require('electron');

// ═════════════════════════ 1. Ad removal in the page's main world ═════════════════════════
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
try {
  if (contextBridge.executeInMainWorld) contextBridge.executeInMainWorld({ func: mainWorldAdShield });
  else webFrame.executeJavaScript('(' + mainWorldAdShield.toString() + ')()');
} catch { try { webFrame.executeJavaScript('(' + mainWorldAdShield.toString() + ')()'); } catch {} }

// ═════════════════════════ 2. Helpers ═════════════════════════
const $ = (s, r = document) => r.querySelector(s);
const SVGNS = 'http://www.w3.org/2000/svg';
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
function icon(d, size = 22) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  for (const p of [].concat(d)) { const path = document.createElementNS(SVGNS, 'path'); path.setAttribute('d', p); path.setAttribute('fill', 'currentColor'); s.append(path); }
  return s;
}
const I = {
  lyrics: 'M12 3a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4zm7 9a7 7 0 0 1-6 6.92V21h-2v-2.08A7 7 0 0 1 5 12h2a5 5 0 0 0 10 0h2z',
  spark: 'M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11l.95 2.55L22.5 16.5l-2.55.95L19 20l-.95-2.55L15.5 16.5l2.55-.95L19 13zM5 14l.7 1.8L7.5 16.5l-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7L5 14z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  expand: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  shrink: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  sub: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z',
  update: 'M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1a6.88 6.88 0 0 0 0 9.8 7.02 7.02 0 0 0 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58a8.987 8.987 0 0 1 12.65 0L21 3v7.12z',
};
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const send = (ch, ...a) => ipcRenderer.send(ch, ...a);

// ═════════════════════════ 3. State ═════════════════════════
let S = { theme: 'glass', accent: '#ff3d77', visualizer: 'bars', subtitles: true, nowPlayingToast: true, adblock: true, version: '' };
const ready = ipcRenderer.invoke('yp:get-settings').then((s) => { S = { ...S, ...s }; applyTheme(); return S; });
const THEMES = [
  { id: 'glass', name: 'Liquid Glass', desc: 'Стекло, блики и живой фон', sw: ['#ff3d77', '#8b3dff', '#22d3ee'] },
  { id: 'material', name: 'Material You', desc: 'Мягкие формы и тональные цвета', sw: ['#d0bcff', '#381e72', '#1c1b1f'] },
  { id: 'holo', name: 'Android Holo', desc: 'Android 4.0 — чёрный и неон', sw: ['#33b5e5', '#000000', '#0099cc'] },
  { id: 'aero', name: 'Windows 7 Aero', desc: 'Глянцевое стекло 2009 года', sw: ['#4fa3e0', '#1b4f8a', '#dbeefd'] },
  { id: 'classic', name: 'YouTube Music', desc: 'Оригинальный вид', sw: ['#ff0000', '#030303', '#212121'] },
];
const ACCENTS = ['#ff3d77', '#ff6b3d', '#ffc23d', '#3dff8b', '#22d3ee', '#3d8bff', '#8b3dff', '#e03dff'];

function applyTheme() {
  const root = document.documentElement;
  if (!root) return;
  root.dataset.ypTheme = S.theme;
  root.dataset.ypViz = S.visualizer;
  root.style.setProperty('--yp-accent', S.accent);
  vizColors = null; // re-read on next frame
}
function save(patch) { Object.assign(S, patch); applyTheme(); return ipcRenderer.invoke('yp:set-settings', patch); }

// ═════════════════════════ 4. UI skeleton ═════════════════════════
let ui = {};
function buildUI() {
  if (ui.root) return;
  applyTheme();
  const backdrop = h('div', { id: 'yp-backdrop', 'aria-hidden': 'true' },
    ui.artA = h('div', { class: 'yp-art' }), ui.artB = h('div', { class: 'yp-art' }),
    ui.blob1 = h('div', { class: 'yp-blob b1' }), ui.blob2 = h('div', { class: 'yp-blob b2' }), ui.blob3 = h('div', { class: 'yp-blob b3' }),
    h('div', { class: 'yp-grain' }));
  ui.canvas = h('canvas', { id: 'yp-viz', 'aria-hidden': 'true' });

  ui.fab = h('div', { id: 'yp-fab' },
    ui.btnLyrics = h('button', { class: 'yp-ic', title: 'Текст песни (Ctrl+L)', onclick: () => toggleLyrics() }, icon(I.lyrics)),
    ui.btnSubs = h('button', { class: 'yp-ic', title: 'Субтитры (Ctrl+J)', onclick: () => toggleSubs() }, icon(I.sub)),
    ui.btnSettings = h('button', { class: 'yp-ic yp-brand', title: 'YouPlay — оформление и настройки', onclick: () => openSettings() }, icon(I.spark)));
  ui.btnSubs.classList.toggle('on', !!S.subtitles);

  ui.subs = h('div', { id: 'yp-subs', 'aria-live': 'polite' }, ui.subCur = h('div', { class: 'yp-sub-cur' }), ui.subNext = h('div', { class: 'yp-sub-next' }));

  ui.lyrics = h('aside', { id: 'yp-lyrics' },
    h('div', { class: 'yp-ly-bg' }, ui.lyBgArt = h('div', { class: 'yp-ly-bgart' })),
    h('header', { class: 'yp-ly-head' },
      ui.lyArt = h('img', { class: 'yp-ly-art', alt: '' }),
      h('div', { class: 'yp-ly-meta' }, ui.lyTitle = h('div', { class: 'yp-ly-title' }), ui.lyArtist = h('div', { class: 'yp-ly-artist' })),
      ui.lyFull = h('button', { class: 'yp-ic', title: 'Во весь экран', onclick: () => ui.lyrics.classList.toggle('full') || 0 }, icon(I.expand)),
      h('button', { class: 'yp-ic', title: 'Закрыть', onclick: () => toggleLyrics(false) }, icon(I.close))),
    ui.lyScroll = h('div', { class: 'yp-ly-scroll' }, ui.lyList = h('div', { class: 'yp-ly-list' })),
    ui.lySource = h('div', { class: 'yp-ly-src', text: 'Тексты: LRCLIB' }));
  ui.lyScroll.addEventListener('wheel', () => {
    userScrolledAt = performance.now();
    if (!ui.lyrics.classList.contains('free') && lines.length) {
      const m = /translate3d\([^,]+,\s*(-?[\d.]+)px/.exec(ui.lyList.style.transform); const y = m ? +m[1] : 0;
      ui.lyrics.classList.add('free'); ui.lyScroll.scrollTop = Math.max(0, -y);
    }
  }, { passive: true });

  ui.toasts = h('div', { id: 'yp-toasts' });
  ui.np = h('div', { id: 'yp-np' });

  ui.root = h('div', { id: 'yp-root' }, ui.canvas, ui.subs, ui.lyrics, ui.fab, ui.np, ui.toasts);
  document.body.prepend(backdrop);
  document.body.append(ui.root);
  ui.backdrop = backdrop;
  window.addEventListener('resize', sizeCanvas, { passive: true });
  sizeCanvas();
}

// ═════════════════════════ 5. Settings modal ═════════════════════════
function seg(options, value, onPick) {
  const wrap = h('div', { class: 'yp-seg' });
  for (const [v, label] of options) {
    const b = h('button', { class: v === value ? 'on' : '', text: label, onclick: () => { for (const x of wrap.children) x.classList.remove('on'); b.classList.add('on'); onPick(v); } });
    wrap.append(b);
  }
  return wrap;
}
function toggle(value, onChange) {
  const t = h('button', { class: 'yp-toggle' + (value ? ' on' : ''), role: 'switch', 'aria-checked': String(!!value) }, h('i'));
  t.addEventListener('click', () => { const on = !t.classList.contains('on'); t.classList.toggle('on', on); t.setAttribute('aria-checked', String(on)); onChange(on); });
  return t;
}
function animatedText(text, cls = '') {
  const w = h('span', { class: 'yp-atext ' + cls, 'aria-label': text });
  [...text].forEach((ch, i) => w.append(h('span', { style: { '--i': i }, 'aria-hidden': 'true', text: ch === ' ' ? ' ' : ch })));
  return w;
}
let modal = null;
function openSettings() {
  if (modal) return closeSettings();
  const cards = h('div', { class: 'yp-themes' });
  for (const t of THEMES) {
    const card = h('button', { class: 'yp-tcard' + (S.theme === t.id ? ' on' : ''), 'data-t': t.id, onclick: () => {
      for (const c of cards.children) c.classList.remove('on'); card.classList.add('on'); save({ theme: t.id });
    } },
      h('div', { class: 'yp-tprev' }, ...t.sw.map((c, i) => h('i', { style: { background: c, '--i': i } }))),
      h('b', { text: t.name }), h('small', { text: t.desc }));
    cards.append(card);
  }
  const accents = h('div', { class: 'yp-accents' });
  const mark = (c) => { for (const a of accents.children) a.classList.toggle('on', a.dataset.c === c); };
  for (const c of ACCENTS) accents.append(h('button', { 'data-c': c, style: { background: c }, title: c, onclick: () => { save({ accent: c }); mark(c); } }));
  const custom = h('input', { type: 'color', value: S.accent, title: 'Свой цвет' });
  custom.addEventListener('input', () => { S.accent = custom.value; applyTheme(); });
  custom.addEventListener('change', () => { save({ accent: custom.value }); mark(custom.value); });
  accents.append(h('label', { class: 'yp-custom' }, custom));
  mark(S.accent);

  const updStatus = h('span', { class: 'yp-upd-status', text: updateText(lastUpdate) || ('Версия ' + S.version) });
  ui.updStatus = updStatus;

  const panel = h('div', { class: 'yp-modal', role: 'dialog', 'aria-label': 'Настройки YouPlay' },
    h('header', {}, animatedText('YouPlay', 'yp-logo'), h('span', { class: 'yp-ver', text: 'v' + S.version }),
      h('button', { class: 'yp-ic', title: 'Закрыть', onclick: closeSettings }, icon(I.close))),
    h('section', {}, h('h3', { text: 'Стиль' }), cards),
    h('section', {}, h('h3', { text: 'Акцентный цвет' }), accents),
    h('section', {}, h('h3', { text: 'Визуализатор под бас' }),
      seg([['bars', 'Полосы'], ['wave', 'Волна'], ['glow', 'Свечение'], ['off', 'Выкл']], S.visualizer, (v) => { save({ visualizer: v }); ensureAudio(); kick(); })),
    h('section', { class: 'yp-rows' },
      h('label', {}, h('span', {}, h('b', { text: 'Субтитры' }), h('small', { text: 'Синхронный текст поверх плеера' })), toggle(S.subtitles, (v) => { save({ subtitles: v }); ui.btnSubs.classList.toggle('on', v); renderSubs(true); })),
      h('label', {}, h('span', {}, h('b', { text: 'Карточка «Сейчас играет»' }), h('small', { text: 'Анимированное уведомление о смене трека' })), toggle(S.nowPlayingToast, (v) => save({ nowPlayingToast: v }))),
      h('label', {}, h('span', {}, h('b', { text: 'Блокировка рекламы' }), h('small', { text: 'Сетевой фильтр + вырезание рекламы из плеера (перезапуск)' })), toggle(S.adblock, (v) => save({ adblock: v })))),
    h('footer', {},
      updStatus,
      h('button', { class: 'yp-btn', onclick: () => { updStatus.textContent = 'Проверяю…'; send('yp:check-update'); } }, icon(I.update, 18), h('span', { text: 'Проверить обновления' }))));

  modal = h('div', { id: 'yp-modal-wrap', onclick: (e) => { if (e.target === modal) closeSettings(); } }, panel);
  ui.root.append(modal);
  requestAnimationFrame(() => modal.classList.add('open'));
}
function closeSettings() {
  if (!modal) return;
  const m = modal; modal = null; ui.updStatus = null;
  m.classList.remove('open'); m.classList.add('closing');
  setTimeout(() => m.remove(), 320);
}

// ═════════════════════════ 6. Toasts ═════════════════════════
function toast(content, { timeout = 4000, id } = {}) {
  if (id) { const old = ui.toasts.querySelector(`[data-id="${id}"]`); if (old) old.remove(); }
  const t = h('div', { class: 'yp-toast', 'data-id': id || '' }, content);
  ui.toasts.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  if (timeout) setTimeout(() => dismiss(t), timeout);
  return t;
}
function dismiss(t) { t.classList.remove('in'); t.classList.add('out'); setTimeout(() => t.remove(), 400); }

let npTimer = 0;
function showNowPlaying(tr) {
  if (!S.nowPlayingToast || !ui.np) return;
  clearTimeout(npTimer);
  ui.np.replaceChildren(
    h('img', { src: tr.art || '', alt: '' }),
    h('div', {}, h('small', { text: 'Сейчас играет' }), animatedText(tr.title, 'yp-np-title'), h('span', { class: 'yp-np-artist', text: tr.artist })));
  ui.np.classList.remove('in'); void ui.np.offsetWidth; ui.np.classList.add('in');
  npTimer = setTimeout(() => ui.np.classList.remove('in'), 3800);
}

// ═════════════════════════ 7. Updates ═════════════════════════
let lastUpdate = null;
function updateText(u) {
  if (!u) return '';
  switch (u.state) {
    case 'checking': return 'Проверяю обновления…';
    case 'none': return u.dev ? 'Режим разработки — обновления выключены' : 'У вас последняя версия ✓';
    case 'available': return `Найдена версия ${u.version}, загружаю…`;
    case 'progress': return `Загрузка обновления… ${u.percent}%`;
    case 'ready': return `Версия ${u.version} готова к установке`;
    case 'error': return 'Не удалось проверить обновления';
  }
  return '';
}
ipcRenderer.on('yp:update', (_e, u) => {
  lastUpdate = u;
  if (ui.updStatus) ui.updStatus.textContent = updateText(u);
  if (!ui.toasts) return;
  if (u.state === 'available') toast(h('div', { class: 'yp-tt' }, icon(I.update, 20), h('span', { text: `Найдено обновление ${u.version} — скачиваю в фоне` })), { id: 'upd' });
  if (u.state === 'ready') toast(h('div', { class: 'yp-tt' }, icon(I.update, 20), h('span', { text: `YouPlay ${u.version} готов` }),
    h('button', { class: 'yp-btn', text: 'Обновить сейчас', onclick: () => send('yp:install-update') })), { id: 'upd', timeout: 0 });
});

// ═════════════════════════ 8. Player / track tracking ═════════════════════════
let video = null, track = { key: '' }, playing = false;
const getPlayerBar = () => $('ytmusic-player-bar');
function readTrack() {
  const bar = getPlayerBar(); if (!bar) return null;
  let title = '', artist = '', album = '', art = '';
  try {
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    if (md && md.title) { title = md.title; artist = md.artist; album = md.album; const a = md.artwork && md.artwork[md.artwork.length - 1]; if (a) art = a.src; }
  } catch {}
  if (!title) {
    title = ($('.title', bar) || {}).textContent || '';
    const by = ($('.byline', bar) || {}).textContent || '';
    const parts = by.split('•').map((x) => x.trim());
    artist = parts[0] || ''; album = parts.length > 2 ? parts[1] : '';
  }
  if (!art) { const img = $('img.image', bar); if (img) art = img.src; }
  if (art) art = art.replace(/=w\d+-h\d+[^&]*/, '=w600-h600-l90-rj').replace(/\/(sd|hq|mq)default\.jpg/, '/maxresdefault.jpg');
  title = title.trim();
  return title ? { title, artist: (artist || '').trim(), album: (album || '').trim(), art, key: title + '|' + artist } : null;
}

function onTrackChange(tr) {
  track = tr;
  setBackdrop(tr.art);
  ui.lyArt.src = tr.art || '';
  ui.lyBgArt.style.backgroundImage = tr.art ? `url("${tr.art}")` : '';
  ui.lyTitle.textContent = tr.title; ui.lyArtist.textContent = tr.artist;
  const info = $('ytmusic-player-bar .content-info-wrapper');
  if (info) { info.classList.remove('yp-swap'); void info.offsetWidth; info.classList.add('yp-swap'); }
  showNowPlaying(tr);
  loadLyrics(tr);
}

let artFlip = false, artUrl = '';
function setBackdrop(url) {
  if (!ui.artA || url === artUrl) return; artUrl = url;
  const next = artFlip ? ui.artA : ui.artB, prev = artFlip ? ui.artB : ui.artA; artFlip = !artFlip;
  // downscale for a cheap natural blur
  const small = url ? url.replace(/=w\d+-h\d+[^&]*/, '=w120-h120-l90-rj') : '';
  next.style.backgroundImage = small ? `url("${small}")` : '';
  next.classList.add('on'); prev.classList.remove('on');
  extractColors(small);
}
function extractColors(url) {
  if (!url) return;
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 12;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 12, 12);
      const d = x.getImageData(0, 0, 12, 12).data; const px = [];
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        px.push({ r, g, b, s: (mx - mn) / (mx || 1), l: mx });
      }
      px.sort((a, b) => (b.s * 0.7 + b.l / 255 * 0.3) - (a.s * 0.7 + a.l / 255 * 0.3));
      const pick = (p) => `rgb(${p.r},${p.g},${p.b})`;
      const st = ui.backdrop.style;
      st.setProperty('--yp-c1', pick(px[0])); st.setProperty('--yp-c2', pick(px[Math.floor(px.length * 0.15)])); st.setProperty('--yp-c3', pick(px[Math.floor(px.length * 0.35)]));
    } catch {}
  };
  img.src = url;
}

function attachVideo(v) {
  if (video === v) return; video = v;
  v.addEventListener('play', () => { playing = true; send('yp:playing', true); ensureAudio(); kick(); });
  v.addEventListener('pause', () => { playing = false; send('yp:playing', false); });
  v.addEventListener('seeked', () => { lastLine = -2; kick(); });
  v.addEventListener('timeupdate', adCheck);
  playing = !v.paused;
  if (playing) { ensureAudio(); kick(); }
}

// ═════════════════════════ 9. Ad fallback (skip anything that slips through) ═════════════════════════
let mutedByUs = false;
function adCheck() {
  const mp = $('#movie_player');
  const ad = mp && mp.classList.contains('ad-showing');
  if (ad && video) {
    if (!video.muted) { video.muted = true; mutedByUs = true; }
    if (isFinite(video.duration) && video.duration > 0) video.currentTime = Math.max(video.currentTime, video.duration - 0.05);
    const skip = $('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[class*="skip"]', mp);
    if (skip) skip.click();
  } else if (mutedByUs && video) { video.muted = false; mutedByUs = false; }
}

// ═════════════════════════ 10. Audio analysis & visualizer ═════════════════════════
let actx = null, analyser = null, freq = null, wave = null, hooked = null;
function ensureAudio() {
  if (!video || S.visualizer === 'off') return;
  try {
    if (hooked !== video) {
      actx = actx || new AudioContext();
      const src = actx.createMediaElementSource(video);
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.72;
      analyser.minDecibels = -88; analyser.maxDecibels = -18;
      src.connect(analyser); analyser.connect(actx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount); wave = new Uint8Array(analyser.fftSize);
      hooked = video;
    }
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { console.warn('[YouPlay] audio hook', e); }
}

let ctx2d = null, cw = 0, ch = 0, dpr = 1, vizColors = null, grad = null;
const BARS = 64; const barVals = new Float32Array(BARS);
function sizeCanvas() {
  if (!ui.canvas) return;
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  cw = window.innerWidth; ch = 150;
  ui.canvas.width = Math.round(cw * dpr); ui.canvas.height = Math.round(ch * dpr);
  ctx2d = ui.canvas.getContext('2d', { alpha: true, desynchronized: true });
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  grad = null;
}
function getVizColors() {
  if (vizColors) return vizColors;
  const cs = getComputedStyle(document.documentElement);
  vizColors = [cs.getPropertyValue('--yp-viz-1').trim() || S.accent, cs.getPropertyValue('--yp-viz-2').trim() || '#8b3dff', cs.getPropertyValue('--yp-viz-3').trim() || '#22d3ee'];
  grad = null; return vizColors;
}
let bassAvg = 0.3, bass = 0, raf = 0;
function kick() { if (!raf) raf = requestAnimationFrame(frame); }
function frame() {
  raf = 0;
  const needViz = analyser && S.visualizer !== 'off';
  const needLyrics = lines.length && (S.subtitles || lyricsOpen);
  if (!video || video.paused || document.hidden || (!needViz && !needLyrics)) { relax(); return; }
  if (needViz) {
    analyser.getByteFrequencyData(freq);
    let s = 0; for (let i = 1; i <= 5; i++) s += freq[i]; // ~20–120 Hz
    const raw = s / (5 * 255);
    bassAvg += (raw - bassAvg) * 0.02;
    const target = clamp(Math.pow(Math.max(0, raw - bassAvg * 0.75) / Math.max(0.25, 1 - bassAvg * 0.75), 1.4) * 1.6);
    bass += (target - bass) * (target > bass ? 0.55 : 0.1);
    applyBass(bass);
    drawViz();
  }
  if (needLyrics) tickLyrics();
  raf = requestAnimationFrame(frame);
}
let artImg = null, playBtn = null;
function applyBass(b) {
  const sc = 1 + b * 0.22;
  ui.blob1.style.transform = `translate3d(0,0,0) scale(${sc})`;
  ui.blob2.style.transform = `translate3d(0,0,0) scale(${1 + b * 0.32})`;
  ui.blob3.style.opacity = String(0.35 + b * 0.55);
  ui.backdrop.style.setProperty('--yp-bass', b.toFixed(3));
  if (!artImg || !artImg.isConnected) artImg = $('ytmusic-player-bar .thumbnail-image-wrapper');
  if (artImg) artImg.style.transform = `scale(${1 + b * 0.08})`;
  if (!playBtn || !playBtn.isConnected) playBtn = $('ytmusic-player-bar #play-pause-button');
  if (playBtn) playBtn.style.setProperty('--yp-bass', b.toFixed(3));
}
function relax() {
  bass = 0; if (ui.blob1) applyBass(0);
  if (ctx2d) ctx2d.clearRect(0, 0, cw, ch);
}
function drawViz() {
  const c = ctx2d; if (!c) return;
  c.clearRect(0, 0, cw, ch);
  if (S.visualizer === 'glow') return;
  const [c1, c2, c3] = getVizColors();
  if (!grad) { grad = c.createLinearGradient(0, 0, cw, 0); grad.addColorStop(0, c3); grad.addColorStop(0.3, c2); grad.addColorStop(0.5, c1); grad.addColorStop(0.7, c2); grad.addColorStop(1, c3); }
  if (S.visualizer === 'wave') {
    analyser.getByteTimeDomainData(wave);
    const step = Math.max(1, Math.floor(wave.length / 256)); const mid = ch * 0.62; const amp = ch * (0.35 + bass * 0.4);
    c.lineWidth = 2.5; c.strokeStyle = grad; c.globalAlpha = 0.9;
    c.beginPath();
    for (let i = 0, x = 0; i < wave.length; i += step, x += cw / (wave.length / step)) {
      const y = mid + ((wave[i] - 128) / 128) * amp;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    c.lineTo(cw, ch); c.lineTo(0, ch); c.closePath(); c.globalAlpha = 0.16; c.fillStyle = grad; c.fill();
    c.globalAlpha = 1; return;
  }
  // mirrored bars: lows in the centre, highs at the edges
  const maxBin = freq.length * 0.55, half = BARS / 2, gap = 4;
  const bw = cw / BARS - gap;
  c.fillStyle = grad;
  for (let i = 0; i < half; i++) {
    const a = Math.floor(2 * Math.pow(maxBin / 2, i / half)), b = Math.max(a + 1, Math.floor(2 * Math.pow(maxBin / 2, (i + 1) / half)));
    let m = 0; for (let k = a; k < b; k++) if (freq[k] > m) m = freq[k];
    const v = Math.pow(m / 255, 1.8) * (1 + i / half * 0.6);
    barVals[i] = v > barVals[i] ? v : barVals[i] * 0.86;
    const bh = Math.max(3, barVals[i] * ch * 0.92);
    const r = Math.min(bw / 2, 6);
    for (const x of [cw / 2 + i * (bw + gap) + gap / 2, cw / 2 - (i + 1) * (bw + gap) + gap / 2]) {
      c.globalAlpha = 0.35 + barVals[i] * 0.55;
      c.beginPath(); c.roundRect(x, ch - bh, bw, bh + r, r); c.fill();
    }
  }
  c.globalAlpha = 1;
}

// ═════════════════════════ 11. Lyrics ═════════════════════════
let lines = [], plain = null, lastLine = -2, lyricsOpen = false, userScrolledAt = 0, lyricsReq = 0;
function parseLRC(txt) {
  const out = [];
  for (const raw of txt.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: +m[1] * 60 + +m[2], text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
async function loadLyrics(tr) {
  const my = ++lyricsReq;
  lines = []; plain = null; lastLine = -2;
  ui.lyList.replaceChildren(h('div', { class: 'yp-ly-msg' }, h('div', { class: 'yp-dots' }, h('i'), h('i'), h('i')), h('span', { text: 'Ищу текст…' })));
  renderSubs(true);
  let r = null;
  try { r = await ipcRenderer.invoke('yp:lyrics', { title: tr.title, artist: tr.artist, album: tr.album, duration: video && isFinite(video.duration) ? video.duration : 0 }); } catch {}
  if (my !== lyricsReq) return;
  if (r && r.synced) lines = parseLRC(r.synced);
  else if (r && r.plain) plain = r.plain;
  renderLyricsList(r);
  kick();
}
function wordSpans(text) {
  const words = text.split(/(\s+)/).filter(Boolean);
  const total = text.length || 1; let pos = 0; const spans = [];
  for (const w of words) {
    if (/^\s+$/.test(w)) { spans.push(document.createTextNode(w)); pos += w.length; continue; }
    const s = h('span', { class: 'w', text: w });
    s._a = pos / total; s._b = (pos + w.length) / total; s._wp = -1;
    spans.push(s); pos += w.length;
  }
  return spans;
}
function renderLyricsList(r) {
  ui.lyrics.classList.remove('free');
  if (lines.length) {
    ui.lyList.replaceChildren(...lines.map((l, i) => {
      const el = h('p', { class: 'yp-line' + (l.text ? '' : ' gap'), onclick: () => { if (video) { video.currentTime = l.t + 0.01; ui.lyrics.classList.remove('free'); } } }, ...(l.text ? wordSpans(l.text) : [h('span', { class: 'yp-note', text: '♪ ♪ ♪' })]));
      el.style.setProperty('--d', '0'); l.el = el; l.idx = i; return el;
    }));
  } else if (plain) {
    ui.lyList.replaceChildren(...plain.split(/\r?\n/).map((t) => h('p', { class: 'yp-line plain', text: t || ' ' })));
  } else {
    ui.lyList.replaceChildren(h('div', { class: 'yp-ly-msg' }, h('span', { class: 'yp-big', text: r && r.instrumental ? '♪' : '∅' }), h('span', { text: r && r.instrumental ? 'Инструментал' : 'Текст для этой песни не найден' })));
  }
  ui.lyList.style.transform = 'translate3d(0,0,0)';
  renderSubs(true);
}
function findLine(t) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
function fillWords(container, p) {
  for (const w of container.children) {
    if (w._a === undefined) continue;
    const wp = clamp((p - w._a) / (w._b - w._a));
    const q = Math.round(wp * 50) / 50;
    if (q !== w._wp) { w._wp = q; w.style.setProperty('--wp', q); if (q >= 1) w.classList.add('lit'); else w.classList.remove('lit'); }
  }
}
function tickLyrics() {
  const t = video.currentTime + 0.18;
  const i = findLine(t);
  if (i !== lastLine) { setActiveLine(i, lastLine); lastLine = i; }
  if (i >= 0) {
    const l = lines[i]; const end = lines[i + 1] ? lines[i + 1].t : l.t + 5;
    const p = clamp((t - l.t) / Math.max(0.3, Math.min(end - l.t, 12) * 0.92));
    if (lyricsOpen && l.el) fillWords(l.el, p);
    if (S.subtitles && ui.subCur.firstChild) fillWords(ui.subCur.firstChild, p);
  }
}
function setActiveLine(i, prev) {
  if (prev >= 0 && lines[prev] && lines[prev].el) { lines[prev].el.classList.remove('active'); for (const w of lines[prev].el.children) if (w._a !== undefined) { w._wp = 1; w.style.setProperty('--wp', 1); w.classList.add('lit'); } }
  for (let k = 0; k < lines.length; k++) if (lines[k].el) {
    lines[k].el.classList.toggle('past', k < i);
    const d = Math.min(Math.abs(k - i), 6); lines[k].el.style.setProperty('--d', d);
  }
  const l = lines[i];
  if (l && l.el) {
    l.el.classList.add('active');
    if (lyricsOpen && performance.now() - userScrolledAt > 3500) {
      if (ui.lyrics.classList.contains('free')) {
        const st = ui.lyScroll.scrollTop;
        ui.lyList.style.transition = 'none'; ui.lyList.style.transform = `translate3d(0,${-st}px,0)`;
        ui.lyrics.classList.remove('free'); ui.lyScroll.scrollTop = 0; void ui.lyList.offsetHeight; ui.lyList.style.transition = '';
      }
      const y = ui.lyScroll.clientHeight * 0.38 - l.el.offsetTop - l.el.offsetHeight / 2;
      ui.lyList.style.transform = `translate3d(0,${Math.round(y)}px,0)`;
    }
  }
  renderSubs();
}
function renderSubs(reset) {
  if (!ui.subs) return;
  const show = S.subtitles && lines.length && !lyricsOpen;
  ui.subs.classList.toggle('show', !!show);
  if (!show) { if (reset) { ui.subCur.replaceChildren(); ui.subNext.textContent = ''; } return; }
  const i = lastLine; const l = lines[i];
  const txt = l ? l.text : '';
  const line = h('div', { class: 'yp-sub-line' + (txt ? '' : ' empty') }, ...(txt ? wordSpans(txt) : [h('span', { class: 'yp-note', text: i < 0 ? '' : '♪' })]));
  let wi = 0; for (const w of line.children) if (w._a !== undefined) w.style.setProperty('--i', wi++);
  const old = ui.subCur.firstChild;
  if (old) { old.classList.add('leave'); setTimeout(() => old.remove(), 380); }
  ui.subCur.append(line);
  const n = lines[i + 1]; ui.subNext.textContent = n ? n.text : '';
}
function toggleLyrics(force) {
  lyricsOpen = force === undefined ? !lyricsOpen : !!force;
  ui.lyrics.classList.toggle('open', lyricsOpen);
  if (!lyricsOpen) ui.lyrics.classList.remove('full');
  ui.btnLyrics.classList.toggle('on', lyricsOpen);
  lastLine = -2; renderSubs(true); kick();
}
function toggleSubs() {
  save({ subtitles: !S.subtitles }); ui.btnSubs.classList.toggle('on', S.subtitles);
  toast(h('div', { class: 'yp-tt' }, icon(I.sub, 20), h('span', { text: S.subtitles ? 'Субтитры включены' : 'Субтитры выключены' })), { id: 'subs', timeout: 1600 });
  lastLine = -2; renderSubs(true); kick();
}

// ═════════════════════════ 12. Click ripple / splash ═════════════════════════
function ripple(e) {
  const btn = e.target.closest('button, yt-icon-button, tp-yt-paper-icon-button, .yp-tcard, tp-yt-paper-item, ytmusic-chip-cloud-chip-renderer, a.yt-simple-endpoint');
  if (!btn || !ui.root) return;
  const r = btn.getBoundingClientRect(); const size = Math.max(r.width, r.height) * 1.6;
  if (size > 600) return;
  const s = h('span', { class: 'yp-ripple', style: { left: e.clientX - size / 2 + 'px', top: e.clientY - size / 2 + 'px', width: size + 'px', height: size + 'px' } });
  ui.root.append(s); setTimeout(() => s.remove(), 650);
}

// ═════════════════════════ 13. Watchdog loop (cheap, 2–4 Hz) ═════════════════════════
function watchdog() {
  const v = $('video'); if (v) attachVideo(v);
  const tr = readTrack(); if (tr && tr.key !== track.key) onTrackChange(tr);
  adCheck();
  const there = $('ytmusic-you-there-renderer button, ytmusic-you-there-renderer yt-button-renderer');
  if (there) there.click();
  setTimeout(watchdog, document.hidden ? 1500 : 500);
}

// thumbnail toolbar
ipcRenderer.on('yp:media', (_e, a) => {
  const bar = getPlayerBar(); if (!bar) return;
  const b = a === 'prev' ? $('.previous-button', bar) : a === 'next' ? $('.next-button', bar) : $('#play-pause-button', bar);
  if (b) b.click();
});

// ═════════════════════════ 14. Boot ═════════════════════════
function boot() {
  if (!document.body || !/music\.youtube\.com$/.test(location.hostname)) return;
  ready.then(() => {
    buildUI();
    document.addEventListener('pointerdown', ripple, { passive: true, capture: true });
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.code === 'KeyL') { e.preventDefault(); toggleLyrics(); }
      else if (e.ctrlKey && e.code === 'KeyJ') { e.preventDefault(); toggleSubs(); }
      else if (e.ctrlKey && e.code === 'Comma') { e.preventDefault(); openSettings(); }
      else if (e.key === 'Escape') { if (modal) closeSettings(); else if (ui.lyrics.classList.contains('full')) ui.lyrics.classList.remove('full'); else if (lyricsOpen) toggleLyrics(false); }
    }, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    if (lastUpdate) ipcRenderer.emit('yp:update', null, lastUpdate);
    else if (S.update) { lastUpdate = S.update; }
    watchdog();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
