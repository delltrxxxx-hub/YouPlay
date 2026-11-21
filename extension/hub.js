'use strict';
/* YouPlay hub — one interface for YouTube Music + SoundCloud:
   · unified search: one list with both sources (SoundCloud results come from YouPlay's hidden SoundCloud window)
   · "Любимое": YouTube Music likes + SoundCloud likes merged into one playlist, newest first
   · a YouPlay play list that plays mixed items in order (or shuffled)
   Loaded after content.js and soundcloud.js. */

const HUB = {
  el: null, view: null, // 'search' | 'likes'
  q: '', filter: 'all', hideFor: null,
  yt: [], sc: [], scState: 'idle', // idle | loading | done | error
  likes: { yt: [], sc: [], scLogin: null, scUser: '', loadingYt: false, loadingSc: false, updated: 0 },
  list: null,            // { items, i, name }
};
let curVideoId = '';
const ytNav = (videoId, playlistId) => window.postMessage({ ypYt: 'nav', videoId, playlistId }, location.origin);
const ytBrowse = (browseId) => window.postMessage({ ypYt: 'browse', browseId }, location.origin);
const rid = () => Math.random().toString(36).slice(2, 10);
const scJobs = new Map();
function scJob(op, arg) {
  const id = rid();
  return new Promise((resolve) => { scJobs.set(id, resolve); sendHost(`sc:${op}:${id}:${arg || ''}`); setTimeout(() => { if (scJobs.has(id)) { scJobs.delete(id); resolve({ error: 'timeout' }); } }, 45000); });
}
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data) return;
  if (e.data.ypYtNow) { curVideoId = e.data.ypYtNow; hubOnYtTrack(); }
  if (e.data.ypScData && scJobs.has(e.data.ypScData.id)) { const r = scJobs.get(e.data.ypScData.id); scJobs.delete(e.data.ypScData.id); r(e.data.ypScData); }
  if (typeof e.data.ypScLogin === 'boolean') { if (e.data.ypScLogin) { toast(h('div', { class: 'yp-tt' }, h('span', { class: 'yp-badge sc', text: 'SoundCloud' }), h('span', { text: 'Подключено! Загружаю ваши лайки…' })), { timeout: 3000 }); loadScLikes(true); } }
});

// ───────── storage ─────────
const store = {
  get: (k) => chrome.storage.local.get(k).then((o) => o[k]),
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};
let ytLikeDates = {};
store.get('ytLikeDates').then((v) => { ytLikeDates = v || {}; });

// ───────── shell ─────────
function hubEl() {
  if (HUB.el) return HUB.el;
  HUB.el = h('section', { id: 'yp-hub' });
  ui.root.append(HUB.el);
  return HUB.el;
}
function hubShow(view) {
  HUB.view = view;
  hubEl().classList.add('open');
  document.documentElement.classList.add('yp-hub-open');
  render();
}
function hubHide() {
  HUB.view = null;
  if (HUB.el) HUB.el.classList.remove('open');
  document.documentElement.classList.remove('yp-hub-open');
}
function guideWidth() {
  const mini = $('#mini-guide'), full = $('#guide-wrapper');
  const vis = (e) => e && e.getBoundingClientRect().right > 4 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  if (vis(full)) return full.getBoundingClientRect().right;
  if (vis(mini)) return mini.getBoundingClientRect().right;
  return 0;
}

// ───────── rows ─────────
const ago = (iso) => {
  const t = Date.parse(iso); if (!t) return '';
  const d = (Date.now() - t) / 864e5;
  if (d < 1) return 'сегодня'; if (d < 2) return 'вчера'; if (d < 30) return Math.floor(d) + ' дн. назад';
  if (d < 365) return Math.floor(d / 30) + ' мес. назад';
  return new Date(t).toLocaleDateString('ru-RU', { year: 'numeric', month: 'short' });
};
function row(it, onPlay, opts = {}) {
  const isSc = it.src === 'sc';
  const playingNow = isSc ? (scOn() && SC.current && SC.current.url === it.url) : (!scOn() && curVideoId && curVideoId === it.videoId);
  const r = h('div', { class: 'yp-h-row' + (playingNow ? ' on' : ''), role: 'button', tabindex: '0', onclick: onPlay, onkeydown: (e) => { if (e.key === 'Enter') onPlay(); } },
    h('span', { class: 'yp-h-n' }, playingNow ? h('i', { class: 'yp-eq' }, h('b'), h('b'), h('b')) : (opts.n != null ? String(opts.n) : '')),
    h('span', { class: 'yp-h-art' }, h('img', { src: it.art || '', alt: '', loading: 'lazy' }), h('span', { class: 'yp-h-play' }, icon(I.play, 18))),
    h('span', { class: 'yp-h-meta' }, h('b', { text: it.title || '—' }),
      h('small', {}, h('span', { class: 'yp-badge ' + (isSc ? 'sc' : 'yt'), text: isSc ? 'SoundCloud' : (it.kind === 'video' ? 'YouTube · клип' : 'YouTube Music') }), ' ' + (it.artist || ''))),
    h('span', { class: 'yp-h-date', text: opts.date || '' }),
    h('span', { class: 'yp-h-acts' },
      isSc ? h('button', { class: 'yp-h-btn', title: 'Лайк в SoundCloud (попадёт в «Любимое»)', onclick: (e) => { e.stopPropagation(); likeSc(it, e.currentTarget); } }, icon(I.heart || I.lyrics, 18)) : null,
      isSc ? h('button', { class: 'yp-h-btn', title: 'В очередь', onclick: (e) => { e.stopPropagation(); SC.queue.push({ ...it, id: rid() }); toast(h('div', { class: 'yp-tt' }, h('span', { text: 'В очереди: ' + it.title })), { timeout: 2000 }); renderQueue(); } }, h('span', { class: 'yp-h-plus', text: '+' })) : null),
    h('span', { class: 'yp-h-d', text: it.duration ? fmt(it.duration) : (it.durText || '') }));
  return r;
}

// ───────── unified search ─────────
function scrapeYtSearch() {
  const out = []; const seen = new Set();
  const nodes = document.querySelectorAll('ytmusic-search-page ytmusic-responsive-list-item-renderer, ytmusic-tabbed-search-results-renderer ytmusic-responsive-list-item-renderer');
  for (const n of nodes) {
    const a = n.querySelector('a[href*="watch?v="]');
    if (!a) continue;
    const v = new URL(a.href, location.origin).searchParams.get('v');
    if (!v || seen.has(v)) continue; seen.add(v);
    const title = ((n.querySelector('.title, yt-formatted-string.title') || a).textContent || '').trim();
    const subEl = n.querySelector('.secondary-flexible-columns') || n.querySelector('.flex-column') || n.querySelector('.subtitle');
    const sub = ((subEl || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const fixed = ((n.querySelector('.fixed-columns, .fixed-column') || {}).textContent || '').trim();
    const parts = sub.split('•').map((x) => x.trim()).filter(Boolean);
    if (/^(исполнитель|artist|альбом|album|плейлист|playlist|сингл|single|ep|подкаст|podcast|эпизод|episode|профиль|profile)$/i.test(parts[0] || '')) continue;
    const kind = /видео|video|клип/i.test(parts[0] || '') ? 'video' : 'song';
    if (/^(видео|video|композиция|song|трек|track|клип)$/i.test(parts[0] || '')) parts.shift();
    const dur = parts.find((p) => /^\d+:\d\d(:\d\d)?$/.test(p)) || (/^\d+:\d\d/.test(fixed) ? fixed : '');
    const img = n.querySelector('img');
    let artist = parts.filter((p) => p !== dur && !/прослуш|просмотр|views|plays/i.test(p)).slice(0, 2).join(' • ');
    if (!artist) { const card = n.closest('ytmusic-card-shelf-renderer'); const ct = card && card.querySelector('.details-container .title, .title'); if (ct) artist = ct.textContent.trim(); }
    const src = img && img.src && !img.src.startsWith('data:') ? img.src.replace(/=w\d+-h\d+[^&]*/, '=w240-h240-l90-rj') : `https://i.ytimg.com/vi/${v}/mqdefault.jpg`;
    out.push({ src: 'yt', videoId: v, title, artist, art: src, durText: dur, kind });
  }
  out.sort((a, b) => (a.kind === 'video') - (b.kind === 'video'));
  return out.slice(0, 30);
}
async function searchSoundCloud(q) {
  HUB.scState = 'loading'; HUB.sc = []; render();
  const r = await scJob('search', q);
  if (HUB.q !== q) return;
  HUB.sc = (r.items || []).map((t) => ({ ...t, src: 'sc' }));
  HUB.scState = r.error ? 'error' : 'done';
  render();
}
function merged() {
  const out = [];
  const a = HUB.filter === 'sc' ? [] : HUB.yt, b = HUB.filter === 'yt' ? [] : HUB.sc;
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
  return out;
}
function playSearchItem(it) {
  HUB.list = null;
  if (it.src === 'sc') { SC.queue = []; scLoad({ ...it, id: rid() }); }
  else { if (scOn()) scStop(); ytNav(it.videoId); }
}
function renderSearch() {
  const el = hubEl();
  const items = merged();
  const tab = (id, label, n) => h('button', { class: 'yp-h-tab' + (HUB.filter === id ? ' on' : ''), onclick: () => { HUB.filter = id; render(); } }, label, n != null ? h('i', { text: String(n) }) : null);
  el.replaceChildren(
    h('header', { class: 'yp-h-head' },
      h('div', {}, h('small', { text: 'Поиск' }), h('h1', { text: HUB.q })),
      h('div', { class: 'yp-h-tabs' }, tab('all', 'Всё', HUB.yt.length + HUB.sc.length), tab('yt', 'YouTube Music', HUB.yt.length), tab('sc', 'SoundCloud', HUB.scState === 'loading' ? '…' : HUB.sc.length)),
      h('button', { class: 'yp-h-link', text: 'Альбомы и исполнители в YouTube Music →', onclick: () => { HUB.hideFor = HUB.q; hubHide(); } })),
    h('div', { class: 'yp-h-list' },
      items.length ? items.map((it) => row(it, () => playSearchItem(it))) : null,
      HUB.scState === 'loading' && HUB.filter !== 'yt' ? h('div', { class: 'yp-h-note' }, h('div', { class: 'yp-dots' }, h('i'), h('i'), h('i')), h('span', { text: 'Ищу в SoundCloud…' })) : null,
      HUB.scState === 'error' && HUB.filter !== 'yt' ? h('div', { class: 'yp-h-note', text: 'SoundCloud не ответил — попробуйте ещё раз' }) : null,
      !items.length && HUB.scState !== 'loading' ? h('div', { class: 'yp-h-note', text: 'Ничего не нашлось' }) : null));
}
function searchTick() {
  const isSearch = location.pathname === '/search';
  const q = isSearch ? (new URLSearchParams(location.search).get('q') || '') : '';
  if (!isSearch) { if (HUB.view === 'search') hubHide(); return; }
  if (q !== HUB.q) { HUB.q = q; HUB.yt = []; HUB.filter = 'all'; HUB.hideFor = null; if (q) searchSoundCloud(q); }
  if (HUB.hideFor === q) return;
  if (HUB.view !== 'search') hubShow('search');
  const yt = scrapeYtSearch();
  if (yt.length !== HUB.yt.length || (yt[0] && HUB.yt[0] && yt[0].videoId !== HUB.yt[0].videoId)) { HUB.yt = yt; render(); }
}

// ───────── likes ─────────
async function loadYtLikes(force) {
  if (HUB.likes.loadingYt) return;
  const cached = await store.get('ytLikes');
  if (cached && !force) HUB.likes.yt = cached;
  if (!force && cached && Date.now() - (await store.get('ytLikesAt') || 0) < 10 * 60e3) { render(); return; }
  HUB.likes.loadingYt = true; render();
  // open YouTube Music's own "Liked music" page underneath and read it (scrolling loads the rest)
  ytBrowse('VLLM');
  const rows = () => [...document.querySelectorAll('ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer, ytmusic-browse-response #contents ytmusic-responsive-list-item-renderer')];
  let n = -1, stable = 0;
  for (let i = 0; i < 120 && stable < 4; i++) {
    await new Promise((r) => setTimeout(r, i < 6 ? 500 : 700));
    if (!/list=LM|VLLM/.test(location.href) && i > 8) break;
    const c = rows().length;
    if (c === n && c > 0) stable++; else stable = 0;
    n = c;
    window.scrollTo(0, document.documentElement.scrollHeight);
  }
  const out = []; const seen = new Set();
  for (const r of rows()) {
    const a = r.querySelector('a[href*="watch?v="]'); if (!a) continue;
    const v = new URL(a.href, location.origin).searchParams.get('v'); if (!v || seen.has(v)) continue; seen.add(v);
    const title = ((r.querySelector('.title-column .title, .title') || a).textContent || '').trim();
    const artist = ((r.querySelector('.secondary-flexible-columns yt-formatted-string, .secondary-flexible-columns') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    const dur = ((r.querySelector('.fixed-columns') || {}).textContent || '').trim();
    const img = r.querySelector('img');
    out.push({ src: 'yt', videoId: v, title, artist, durText: dur, art: img && img.src && !img.src.startsWith('data:') ? img.src.replace(/=w\d+-h\d+[^&]*/, '=w240-h240-l90-rj') : `https://i.ytimg.com/vi/${v}/mqdefault.jpg` });
  }
  window.scrollTo(0, 0);
  HUB.likes.loadingYt = false;
  if (out.length) { HUB.likes.yt = out; store.set('ytLikes', out); store.set('ytLikesAt', Date.now()); }
  render();
}
async function loadScLikes(force) {
  if (HUB.likes.loadingSc) return;
  const cached = await store.get('scLikes');
  if (cached && !force) { HUB.likes.sc = cached.items || []; HUB.likes.scLogin = cached.login; HUB.likes.scUser = cached.user || ''; }
  if (!force && cached && Date.now() - (cached.at || 0) < 10 * 60e3) { render(); return; }
  HUB.likes.loadingSc = true; render();
  const r = await scJob('likes');
  HUB.likes.loadingSc = false;
  if (r.login === false) { HUB.likes.scLogin = false; HUB.likes.sc = []; store.set('scLikes', { login: false, items: [], at: Date.now() }); }
  else if (r.items) {
    HUB.likes.scLogin = true; HUB.likes.scUser = r.user || '';
    HUB.likes.sc = r.items.map((t) => ({ ...t, src: 'sc' }));
    store.set('scLikes', { login: true, user: r.user || '', items: HUB.likes.sc, at: Date.now() });
  }
  render();
}
// newest first. SoundCloud gives real like dates; YouTube Music only gives the order, so its items are
// placed between dated neighbours (or spread over the SoundCloud date range); likes made in YouPlay are dated.
function mergedLikes() {
  const sc = HUB.likes.sc.map((t) => ({ ...t, t: Date.parse(t.likedAt) || 0, real: !!t.likedAt }));
  const yt = HUB.likes.yt.map((t) => ({ ...t, t: ytLikeDates[t.videoId] || 0, real: !!ytLikeDates[t.videoId] }));
  const scT = sc.map((x) => x.t).filter(Boolean);
  const top = Math.max(Date.now(), ...scT), bottom = scT.length ? Math.min(...scT) : Date.now() - 365 * 864e5;
  const n = yt.length;
  for (let i = 0; i < n; i++) if (!yt[i].real) {
    let k1 = i - 1; while (k1 >= 0 && !yt[k1].real) k1--;
    let k2 = i + 1; while (k2 < n && !yt[k2].real) k2++;
    if (k1 >= 0 && k2 < n) yt[i].t = yt[k1].t + (yt[k2].t - yt[k1].t) * (i - k1) / (k2 - k1);
    else if (k1 >= 0) yt[i].t = yt[k1].t - (i - k1) * (top - bottom) / Math.max(n, 1);
    else if (k2 < n) yt[i].t = yt[k2].t + (k2 - i) * (top - bottom) / Math.max(n, 1);
    else yt[i].t = top - (n > 1 ? i / (n - 1) : 0) * (top - bottom);
  }
  return [...yt, ...sc].sort((a, b) => b.t - a.t);
}
async function likeSc(it, btn) {
  if (btn) btn.classList.add('busy');
  const r = await scJob('like', it.url);
  if (btn) btn.classList.remove('busy');
  if (r.login === false) { scConnectPrompt(); return; }
  if (r.ok) {
    if (btn) btn.classList.add('on');
    toast(h('div', { class: 'yp-tt' }, h('span', { class: 'yp-badge sc', text: 'SoundCloud' }), h('span', { text: '♥ ' + it.title })), { timeout: 2000 });
    const now = new Date().toISOString();
    if (!HUB.likes.sc.some((x) => x.url === it.url)) { HUB.likes.sc.unshift({ ...it, src: 'sc', likedAt: now }); store.set('scLikes', { login: true, user: HUB.likes.scUser, items: HUB.likes.sc, at: Date.now() }); }
    if (HUB.view === 'likes') render();
  } else toast(h('div', { class: 'yp-tt' }, h('span', { text: 'Не получилось поставить лайк в SoundCloud' })), { timeout: 3000 });
}
function scConnectPrompt() {
  toast(h('div', { class: 'yp-tt' }, h('span', { class: 'yp-badge sc', text: 'SoundCloud' }), h('span', { text: 'Войдите в SoundCloud, чтобы объединить лайки' }),
    h('button', { class: 'yp-btn', text: 'Войти', onclick: () => sendHost('sclogin') })), { id: 'sclogin', timeout: 9000 });
}
function openLikes() {
  hubShow('likes');
  loadYtLikes(false); loadScLikes(false);
}
function renderLikes() {
  const el = hubEl(); const L = HUB.likes;
  const all = mergedLikes();
  const nYt = L.yt.length, nSc = L.sc.length;
  el.replaceChildren(
    h('header', { class: 'yp-h-head likes' },
      h('div', { class: 'yp-h-cover' }, icon(I.heart || I.lyrics, 64)),
      h('div', { class: 'yp-h-ttl' }, h('small', { text: 'Плейлист' }), h('h1', { text: 'Любимое' }),
        h('p', {}, h('span', { class: 'yp-badge yt', text: 'YouTube Music' }), ` ${nYt}${L.loadingYt ? '…' : ''}   `, h('span', { class: 'yp-badge sc', text: 'SoundCloud' }), ` ${L.scLogin === false ? 'не подключён' : nSc + (L.loadingSc ? '…' : '')}`),
        h('div', { class: 'yp-h-btns' },
          h('button', { class: 'yp-btn', onclick: () => startList(all, 0, 'Любимое') }, icon(I.play, 18), h('span', { text: 'Слушать' })),
          h('button', { class: 'yp-h-ghost', onclick: () => { const s = all.slice(); for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } startList(s, 0, 'Любимое · перемешано'); } }, icon(I.shuffle, 18), h('span', { text: 'Перемешать' })),
          h('button', { class: 'yp-h-ghost', title: 'Обновить', onclick: () => { loadYtLikes(true); if (L.scLogin !== false) loadScLikes(true); } }, icon(I.update, 18))))),
    L.scLogin === false ? h('div', { class: 'yp-h-banner' }, h('span', { class: 'yp-cloud big' }),
      h('div', {}, h('b', { text: 'Подключите SoundCloud' }), h('small', { text: 'Лайки из SoundCloud и YouTube Music соберутся в один плейлист по датам.' })),
      h('button', { class: 'yp-btn', text: 'Войти в SoundCloud', onclick: () => sendHost('sclogin') })) : null,
    h('div', { class: 'yp-h-list' },
      all.map((it, i) => row(it, () => startList(all, i, 'Любимое'), { n: i + 1, date: it.real ? ago(it.likedAt || new Date(it.t).toISOString()) : '' })),
      !all.length && (L.loadingYt || L.loadingSc) ? h('div', { class: 'yp-h-note' }, h('div', { class: 'yp-dots' }, h('i'), h('i'), h('i')), h('span', { text: 'Собираю ваши лайки…' })) : null,
      !all.length && !L.loadingYt && !L.loadingSc ? h('div', { class: 'yp-h-note', text: 'Пока пусто. Лайкайте треки сердечком — они появятся здесь.' }) : null));
}
// remember when a YouTube Music track is liked (the like button in the player bar)
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('ytmusic-like-button-renderer button');
  if (!b) return;
  const like = /Нравится|Like/.test(b.getAttribute('aria-label') || '') && !/Не нравится|Dislike/.test(b.getAttribute('aria-label') || '');
  if (!like || !curVideoId) return;
  setTimeout(() => {
    if (b.getAttribute('aria-pressed') === 'true') { ytLikeDates[curVideoId] = Date.now(); store.set('ytLikeDates', ytLikeDates); store.set('ytLikesAt', 0); }
  }, 600);
}, true);

// ───────── YouPlay play list (mixed sources) ─────────
function startList(items, i, name) {
  if (!items.length) return;
  HUB.list = { items: items.map((x) => ({ ...x })), i: -1, name };
  playAt(i);
  openNowPlaying(); toggleQueue(true);
}
function playAt(i) {
  const L = HUB.list; if (!L || i < 0 || i >= L.items.length) { HUB.list = null; return; }
  L.i = i; const it = L.items[i];
  if (it.src === 'sc') { SC.queue = []; scLoad({ ...it, id: rid() }); }
  else { if (scOn()) scStop(); L.expect = it.videoId; ytNav(it.videoId); }
  renderQueue();
}
function listNext() { if (!HUB.list) return false; playAt(HUB.list.i + 1); return true; }
function listPrev() { if (!HUB.list) return false; if (curTime() > 3) { seekTo(0); return true; } playAt(Math.max(0, HUB.list.i - 1)); return true; }
// hooks used by content.js / soundcloud.js
function hubOnScFinished() { return listNext(); }
function hubWatchEnd() {
  const L = HUB.list; if (!L || scOn() || !video || video.paused || !isFinite(video.duration)) return;
  const it = L.items[L.i]; if (!it || it.src !== 'yt') return;
  if (video.duration - video.currentTime < 0.45 && video.currentTime > 1) { video.pause(); listNext(); }
}
function hubOnYtTrack() {
  const L = HUB.list;
  if (L && !scOn()) {
    const it = L.items[L.i];
    if (L.expect && curVideoId === L.expect) L.expect = null;
    else if (!L.expect && it && it.src === 'yt' && curVideoId !== it.videoId) HUB.list = null; // user picked something else
  }
  if (HUB.view) render();
  renderQueue();
}
function hubRenderQueue() {
  const L = HUB.list; if (!L) return false;
  ui.qCount.textContent = L.name + ' · ' + L.items.length + ' треков';
  let cur = null;
  ui.qList.replaceChildren(...L.items.map((it, i) => { const r = row(it, () => playAt(i), { n: i + 1 }); if (i === L.i) { r.classList.add('on'); cur = r; } return r; }));
  if (cur) requestAnimationFrame(() => cur.scrollIntoView({ block: 'center' }));
  return true;
}
document.addEventListener('click', (e) => {
  if (!HUB.list || e.defaultPrevented) return;
  const nb = e.target.closest && e.target.closest('ytmusic-player-bar .next-button, ytmusic-player-bar .previous-button');
  if (!nb) return;
  e.preventDefault(); e.stopPropagation();
  if (nb.classList.contains('next-button')) listNext(); else listPrev();
}, true);

// ───────── routing ─────────
function render() { if (HUB.view === 'search') renderSearch(); else if (HUB.view === 'likes') renderLikes(); if (HUB.el) HUB.el.style.setProperty('--yp-hub-left', guideWidth() + 'px'); }
function hubTick() {
  if (!ui.root) return;
  searchTick();
  const onLM = location.pathname === '/playlist' && new URLSearchParams(location.search).get('list') === 'LM';
  if (onLM && HUB.view !== 'likes' && !HUB.likes.loadingYt) openLikes();
  if (HUB.el && HUB.view) HUB.el.style.setProperty('--yp-hub-left', guideWidth() + 'px');
}
setInterval(hubTick, 600);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && HUB.view && !document.querySelector('#yp-modal-wrap') && !(ui.lyrics && ui.lyrics.classList.contains('full'))) { if (HUB.view === 'search') HUB.hideFor = HUB.q; hubHide(); } });
