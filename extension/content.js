'use strict';
/* YouPlay content script — isolated world on music.youtube.com (Microsoft Edge).
   DOM is touched via safe APIs only (no innerHTML: YT Music enforces Trusted Types). */

// ═════════════════════════ 1. Bridge to the extension background ═════════════════════════
const DEFAULT_SETTINGS = { theme: 'studio', accent: '#ff5a36', visualizer: 'bars', subtitles: true, nowPlayingToast: false, autoNowPlaying: true, adblock: true, hideSide: false };
const _listeners = {};
const ipcRenderer = {
  invoke(ch, arg) {
    if (ch === 'yp:get-settings') return chrome.storage.local.get(null).then((s) => ({ ...DEFAULT_SETTINGS, ...s, version: chrome.runtime.getManifest().version }));
    if (ch === 'yp:set-settings') {
      const reload = 'adblock' in arg && (localStorage.getItem('yp-adblock') !== '0') !== !!arg.adblock;
      if ('adblock' in arg) { localStorage.setItem('yp-adblock', arg.adblock ? '1' : '0'); chrome.runtime.sendMessage({ type: 'adblock', on: !!arg.adblock }); }
      return chrome.storage.local.set(arg).then(() => { if (reload) location.reload(); });
    }
    if (ch === 'yp:lyrics') return chrome.runtime.sendMessage({ type: 'lyrics', ...arg });
    return Promise.resolve(null);
  },
  send(ch) {
    if (ch === 'yp:check-update') chrome.runtime.sendMessage({ type: 'check-update' }).then((u) => u && ipcRenderer.emit('yp:update', null, u));
  },
  on(ch, fn) { (_listeners[ch] = _listeners[ch] || []).push(fn); },
  emit(ch, e, a) { for (const f of _listeners[ch] || []) f(e, a); },
};

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
  play: 'M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.78-6.86a1 1 0 0 0 0-1.69L9.54 4.3A1 1 0 0 0 8 5.14z',
  pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
  shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  queue: 'M4 6h12v2H4zm0 5h12v2H4zm0 5h8v2H4zm12 0v-5l5 3.5z',
  update: 'M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1a6.88 6.88 0 0 0 0 9.8 7.02 7.02 0 0 0 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58a8.987 8.987 0 0 1 12.65 0L21 3v7.12z',
};
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const send = (ch, ...a) => ipcRenderer.send(ch, ...a);

// ═════════════════════════ 3. State ═════════════════════════
let S = { autoNowPlaying: true, theme: 'glass', accent: '#ff3d77', visualizer: 'bars', subtitles: true, nowPlayingToast: true, adblock: true, version: '' };
const ready = ipcRenderer.invoke('yp:get-settings').then((s) => { S = { ...S, ...s }; applyTheme(); return S; });
const THEMES = [
  { id: 'studio', name: 'Studio', desc: 'Тёплый минимализм в цветах обложки', sw: ['#ff5a36', '#3a1d14', '#120c0a'] },
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
  root.dataset.ypHideSide = S.hideSide ? '1' : '0';
  root.dataset.ypCaption = ({ studio: '#120d0b', glass: '#0b0912', material: '#1d1b20', holo: '#1f1f1f', aero: '#3f7cbf', classic: '#030303' })[S.theme] || '#120d0b';
  root.style.setProperty('--yp-accent', S.accent);
  vizColors = null; // re-read on next frame
}
function save(patch) { Object.assign(S, patch); applyTheme(); if (patch.theme) setTimeout(guideMode, 50); return ipcRenderer.invoke('yp:set-settings', patch); }
// Studio uses the slim icon-only side menu: collapse YT Music's full guide once.
function guideMode() {
  const full = $('#guide-wrapper');
  const expanded = full && full.getBoundingClientRect().left >= 0 && getComputedStyle(full).visibility !== 'hidden' && full.offsetWidth > 100;
  const want = S.theme === 'studio' ? 'mini' : null;
  if (want === 'mini' && expanded) { const b = $('#guide-button button, #guide-button'); if (b) b.click(); }
}

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
    ui.btnNow = h('button', { class: 'yp-ic', title: 'Сейчас играет — во весь экран (Ctrl+K)', onclick: () => openNowPlaying() }, icon(I.expand)),
    ui.btnSettings = h('button', { class: 'yp-ic yp-brand', title: 'YouPlay — оформление и настройки', onclick: () => openSettings() }, icon(I.spark)));
  ui.btnSubs.classList.toggle('on', !!S.subtitles);

  ui.subs = h('div', { id: 'yp-subs', 'aria-live': 'polite' }, ui.subCur = h('div', { class: 'yp-sub-cur' }), ui.subNext = h('div', { class: 'yp-sub-next' }));

  ui.lyrics = h('aside', { id: 'yp-lyrics' },
    h('div', { class: 'yp-ly-bg' }, ui.lyBgArt = h('div', { class: 'yp-ly-bgart' })),
    h('header', { class: 'yp-ly-head' },
      ui.lyArt = h('img', { class: 'yp-ly-art', alt: '', title: 'Сейчас играет', onclick: () => openNowPlaying() }),
      h('div', { class: 'yp-ly-meta' }, ui.lyTitle = h('div', { class: 'yp-ly-title' }), ui.lyArtist = h('div', { class: 'yp-ly-artist' })),
      h('div', { class: 'yp-ly-tools' },
        ui.lyFull = h('button', { class: 'yp-ic', title: 'Сейчас играет — во весь экран', onclick: () => setFull(!ui.lyrics.classList.contains('full')) }, icon(I.expand)),
        h('button', { class: 'yp-ic', title: 'Закрыть (Esc)', onclick: () => toggleLyrics(false) }, icon(I.close))),
      h('div', { class: 'yp-np-ctrl' },
        h('div', { class: 'yp-np-bar', onpointerdown: seekStart }, ui.npFill = h('i', { class: 'fill' }), ui.npKnob = h('i', { class: 'knob' })),
        h('div', { class: 'yp-np-times' }, ui.npCur = h('span', { text: '0:00' }), ui.npDur = h('span', { text: '0:00' })),
        h('div', { class: 'yp-np-btns' },
          h('button', { class: 'yp-ic', title: 'Перемешать', onclick: () => clickBar('.shuffle') }, icon(I.shuffle, 20)),
          h('button', { class: 'yp-ic', title: 'Назад', onclick: () => clickBar('.previous-button') }, icon(I.prev, 24)),
          ui.npPlay = h('button', { class: 'yp-ic yp-np-play', title: 'Играть / пауза', onclick: () => clickBar('#play-pause-button') }, icon(I.pause, 30)),
          h('button', { class: 'yp-ic', title: 'Далее', onclick: () => clickBar('.next-button') }, icon(I.next, 24)),
          h('button', { class: 'yp-ic', title: 'Повтор', onclick: () => clickBar('.repeat') }, icon(I.repeat, 20)),
          ui.btnQueue = h('button', { class: 'yp-ic', title: 'Очередь', onclick: () => toggleQueue() }, icon(I.queue, 20))))),
    ui.lyScroll = h('div', { class: 'yp-ly-scroll' }, ui.lyList = h('div', { class: 'yp-ly-list' })),
    ui.queue = h('div', { class: 'yp-queue' }, h('div', { class: 'yp-q-head' }, h('b', { text: 'Очередь' }), ui.qCount = h('span')), ui.qList = h('div', { class: 'yp-q-list' })),
    h('div', { class: 'yp-ly-src' },
      h('span', { text: 'Тексты: LRCLIB' }),
      h('span', { class: 'yp-offset' },
        h('button', { title: 'Текст раньше на 0,5 с', text: '−0,5 с', onclick: () => nudge(-0.5) }),
        ui.offLabel = h('b', { text: 'синхр.', title: 'Сбросить сдвиг', onclick: () => nudge(0, true) }),
        h('button', { title: 'Текст позже на 0,5 с', text: '+0,5 с', onclick: () => nudge(0.5) }))));
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

function clickBar(sel) { const b = $('ytmusic-player-bar ' + sel); if (b) (b.querySelector('button') || b).click(); }
const fmt = (t) => { t = Math.max(0, t | 0); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
function seekStart(e) {
  const bar = e.currentTarget; if (!video || !isFinite(video.duration)) return;
  bar.setPointerCapture(e.pointerId);
  const go = (ev) => { const r = bar.getBoundingClientRect(); video.currentTime = clamp((ev.clientX - r.left) / r.width) * video.duration; lastLine = -2; paintProgress(); };
  go(e);
  bar.onpointermove = go;
  bar.onpointerup = () => { bar.onpointermove = null; bar.onpointerup = null; };
}
function setFull(on) { ui.lyrics.classList.toggle('full', on); document.documentElement.classList.toggle('yp-np-open', on); lastLine = -2; paintProgress(); kick(); }
function openNowPlaying() { if (!lyricsOpen) toggleLyrics(true); setFull(true); }
// ── queue (mirrors YT Music's own queue; clicking an item plays it) ──
let queueOpen = false;
function ytQueueItems() {
  const q = $('ytmusic-player-page ytmusic-player-queue') || $('ytmusic-player-queue');
  return q ? [...q.querySelectorAll('ytmusic-player-queue-item')].filter((x) => x.offsetParent !== null || x.closest('#contents')) : [];
}
function renderQueue() {
  if (!queueOpen) return;
  const items = ytQueueItems();
  ui.qCount.textContent = items.length ? items.length + ' треков' : '';
  if (!items.length) { ui.qList.replaceChildren(h('div', { class: 'yp-ly-msg' }, h('span', { text: 'Очередь пуста' }))); return; }
  let cur = null;
  ui.qList.replaceChildren(...items.slice(0, 200).map((it, i) => {
    const t = (it.querySelector('.song-title') || {}).textContent || '';
    const b = (it.querySelector('.byline') || {}).textContent || '';
    const img = it.querySelector('.thumbnail img, img');
    const d = (it.querySelector('.duration') || {}).textContent || '';
    const on = it.hasAttribute('selected');
    const row = h('button', { class: 'yp-q-item' + (on ? ' on' : ''), title: t, onclick: () => { const p = it.querySelector('ytmusic-play-button-renderer, .song-info, .left-items') || it; p.click(); setTimeout(renderQueue, 700); } },
      h('span', { class: 'yp-q-n', text: on ? '' : String(i + 1) }, on ? h('i', { class: 'yp-eq' }, h('b'), h('b'), h('b')) : null),
      h('img', { src: img ? img.src : '', alt: '', loading: 'lazy' }),
      h('span', { class: 'yp-q-meta' }, h('b', { text: t.trim() }), h('small', { text: b.trim() })),
      h('span', { class: 'yp-q-d', text: d.trim() }));
    if (on) cur = row;
    return row;
  }));
  if (cur) requestAnimationFrame(() => cur.scrollIntoView({ block: 'center' }));
}
function toggleQueue(force) {
  queueOpen = force === undefined ? !queueOpen : !!force;
  ui.lyrics.classList.toggle('show-queue', queueOpen);
  ui.btnQueue.classList.toggle('on', queueOpen);
  if (queueOpen) { if (!ytQueueItems().length) clickBar('.toggle-player-page-button, .expand-button'); setTimeout(renderQueue, 300); }
}

function syncPlayIcon() {
  if (ui.npPlay) ui.npPlay.replaceChildren(icon(playing ? I.pause : I.play, 30));
  document.documentElement.dataset.ypPlaying = playing ? '1' : '0';
}

// smooth progress: we drive YT Music's bar and our own every animation frame
let ytProg = null, ytKnob = null, ytSlider = null;
function paintProgress() {
  if (!video) return;
  const d = video.duration, t = video.currentTime;
  if (!isFinite(d) || d <= 0) return;
  const p = clamp(t / d);
  if (!ytSlider || !ytSlider.isConnected) { ytSlider = $('ytmusic-player-bar #progress-bar'); ytProg = ytSlider && ytSlider.querySelector('#primaryProgress'); ytKnob = ytSlider && ytSlider.querySelector('#sliderKnob'); }
  if (ytProg && !(ytSlider.dragging || ytSlider.hasAttribute('dragging') || ytSlider.classList.contains('dragging'))) {
    ytProg.style.transform = 'scaleX(' + p.toFixed(5) + ')';
    if (ytKnob) ytKnob.style.left = (p * 100).toFixed(4) + '%';
  }
  if (lyricsOpen && ui.npFill) {
    ui.npFill.style.transform = 'scaleX(' + p.toFixed(5) + ')';
    ui.npKnob.style.left = (p * 100).toFixed(4) + '%';
    const c = fmt(t); if (ui.npCur.textContent !== c) ui.npCur.textContent = c;
    const dd = fmt(d); if (ui.npDur.textContent !== dd) ui.npDur.textContent = dd;
  }
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
      h('label', {}, h('span', {}, h('b', { text: 'Скрыть правую панель' }), h('small', { text: 'Убирает очередь, текст и похожие треки на экране плеера' })), toggle(S.hideSide, (v) => save({ hideSide: v }))),
      h('label', {}, h('span', {}, h('b', { text: 'Открывать «Сейчас играет» при запуске трека' }), h('small', { text: 'Полноэкранный плеер с текстом и очередью' })), toggle(S.autoNowPlaying, (v) => save({ autoNowPlaying: v }))),
      h('label', {}, h('span', {}, h('b', { text: 'Карточка при смене трека' }), h('small', { text: 'Небольшое уведомление сверху' })), toggle(S.nowPlayingToast, (v) => save({ nowPlayingToast: v }))),
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
    case 'available': return `Вышла версия ${u.version} — установится сама, когда вы закроете YouPlay`;
    case 'error': return 'Не удалось проверить обновления';
  }
  return '';
}
let updToastShown = false;
ipcRenderer.on('yp:update', (_e, u) => {
  lastUpdate = u;
  if (ui.updStatus) ui.updStatus.textContent = updateText(u);
  if (!ui.toasts || u.state !== 'available' || updToastShown) return;
  updToastShown = true;
  toast(h('div', { class: 'yp-tt' }, icon(I.update, 20), h('span', { text: `Вышел YouPlay ${u.version}. Он скачивается в фоне и установится, когда вы закроете приложение.` })), { id: 'upd', timeout: 8000 });
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

let lastGesture = -1e9;
addEventListener('pointerdown', () => { lastGesture = performance.now(); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'MediaTrackNext' || e.key === 'MediaTrackPrevious') lastGesture = performance.now(); }, true);
function onTrackChange(tr) {
  track = tr;
  setBackdrop(tr.art);
  ui.lyArt.src = tr.art || '';
  ui.lyBgArt.style.backgroundImage = tr.art ? `url("${tr.art}")` : '';
  ui.lyTitle.textContent = tr.title; ui.lyArtist.textContent = tr.artist;
  const info = $('ytmusic-player-bar .content-info-wrapper');
  if (info) { info.classList.remove('yp-swap'); void info.offsetWidth; info.classList.add('yp-swap'); }
  showNowPlaying(tr);
  if (S.autoNowPlaying && performance.now() - lastGesture < 5000 && !(modal)) openNowPlaying();
  setTimeout(renderQueue, 900);
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
  v.addEventListener('play', () => { playing = true; syncPlayIcon(); send('yp:playing', true); ensureAudio(); kick(); });
  v.addEventListener('pause', () => { playing = false; syncPlayIcon(); paintProgress(); send('yp:playing', false); });
  v.addEventListener('seeked', () => { lastLine = -2; kick(); });
  v.addEventListener('timeupdate', adCheck);
  playing = !v.paused; syncPlayIcon();
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
  if (!video || video.paused || document.hidden) { relax(); return; }
  paintProgress();
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
let lyMeta = { dur: 0, tempo: false }, offset = 0, prevDuration = 0;
const offsets = new Map();
// Lyrics time for the current playback position. Slowed / sped-up edits are stretched versions of
// the original recording, so their timestamps are rescaled by the ratio of the two lengths.
function tempoRatio() {
  if (!video || !lyMeta.dur || !isFinite(video.duration) || video.duration <= 0) return 1;
  const k = lyMeta.dur / video.duration;
  if (k < 0.55 || k > 1.8) return 1;
  if (lyMeta.tempo || Math.abs(k - 1) > 0.04) return k;
  return 1;
}
const lyricClock = () => video.currentTime * tempoRatio() + offset;
const videoTimeFor = (lt) => Math.max(0, (lt - offset) / tempoRatio());
function nudge(d, reset) {
  offset = reset ? 0 : Math.round((offset + d) * 10) / 10;
  if (track.key) offsets.set(track.key, offset);
  showOffset(); lastLine = -2; kick();
}
function showOffset() { if (ui.offLabel) ui.offLabel.textContent = offset ? (offset > 0 ? '+' : '') + offset.toFixed(1).replace('.', ',') + ' с' : 'синхр.'; }
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
  // the <video> switches to the new track a moment after the metadata does — wait for its real length
  const before = prevDuration;
  for (let i = 0; i < 20 && video && (!isFinite(video.duration) || (video.duration === before && video.currentTime > 3)); i++) await new Promise((r) => setTimeout(r, 150));
  if (my !== lyricsReq) return;
  const dur = video && isFinite(video.duration) ? video.duration : 0;
  prevDuration = dur;
  let r = null;
  try { r = await ipcRenderer.invoke('yp:lyrics', { title: tr.title, artist: tr.artist, album: tr.album, duration: dur }); } catch {}
  if (my !== lyricsReq) return;
  lyMeta = { dur: (r && r.duration) || 0, tempo: !!(r && r.tempo) };
  offset = offsets.get(tr.key) || 0; showOffset();
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
      const el = h('p', { class: 'yp-line' + (l.text ? '' : ' gap'), onclick: () => { if (video) { video.currentTime = videoTimeFor(l.t) + 0.01; ui.lyrics.classList.remove('free'); lastLine = -2; } } }, ...(l.text ? wordSpans(l.text) : [h('span', { class: 'yp-note', text: '♪ ♪ ♪' })]));
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
  const t = lyricClock() + 0.45;
  const i = findLine(t);
  if (i !== lastLine) { setActiveLine(i, lastLine); lastLine = i; }
  if (i >= 0) {
    const l = lines[i]; const end = lines[i + 1] ? lines[i + 1].t : l.t + 5;
    const p = clamp((t - l.t) / Math.max(0.3, Math.min(end - l.t, 12) * 0.92));
    if (lyricsOpen && l.el) fillWords(l.el, p);
    if (S.subtitles && ui.subCur.lastChild) fillWords(ui.subCur.lastChild, p);
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
  for (const old of [...ui.subCur.children]) {
    if (old.classList.contains('leave')) continue;
    old.classList.add('leave');
    setTimeout(() => old.remove(), 380);
  }
  ui.subCur.append(line);
  const n = lines[i + 1]; ui.subNext.textContent = n ? n.text : '';
}
function toggleLyrics(force) {
  lyricsOpen = force === undefined ? !lyricsOpen : !!force;
  ui.lyrics.classList.toggle('open', lyricsOpen);
  if (!lyricsOpen) setFull(false);
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


// ═════════════════════════ 14. Boot ═════════════════════════
function boot() {
  if (!document.body || !/music\.youtube\.com$/.test(location.hostname)) return;
  ready.then(() => {
    buildUI();
    document.addEventListener('pointerdown', ripple, { passive: true, capture: true });
    document.addEventListener('click', (e) => {
      if (e.target.closest('ytmusic-player-bar .thumbnail-image-wrapper, ytmusic-player-bar img.image')) { e.preventDefault(); e.stopPropagation(); openNowPlaying(); }
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.code === 'KeyL') { e.preventDefault(); toggleLyrics(); }
      else if (e.ctrlKey && e.code === 'KeyK') { e.preventDefault(); if (ui.lyrics.classList.contains('full')) toggleLyrics(false); else openNowPlaying(); }
      else if (e.ctrlKey && e.code === 'KeyJ') { e.preventDefault(); toggleSubs(); }
      else if (e.ctrlKey && e.code === 'Comma') { e.preventDefault(); openSettings(); }
      else if (e.key === 'Escape') { if (modal) closeSettings(); else if (ui.lyrics.classList.contains('full')) setFull(false); else if (lyricsOpen) toggleLyrics(false); }
    }, true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    chrome.runtime.sendMessage({ type: 'update-status' }).then((u) => { if (u) ipcRenderer.emit('yp:update', null, u); }).catch(() => {});
    watchdog();
    setTimeout(guideMode, 1200); setTimeout(guideMode, 4000);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
