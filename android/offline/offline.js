'use strict';
/* YouPlay — "Моя музыка": works with no internet at all. Plays audio files from the phone
   (served by the app at /media/<id>), with Now Playing, favourites, recents, shuffle/repeat,
   sleep timer and the system media notification. */
const N = window.YouPlayNative;
const $ = (s) => document.querySelector(s);
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.7c0-.8.9-1.3 1.6-.9l9.6 6.3c.6.4.6 1.4 0 1.8l-9.6 6.3c-.7.4-1.6-.1-1.6-.9z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7.5 5h1.8c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5H7.5C6.7 19 6 18.3 6 17.5v-11C6 5.7 6.7 5 7.5 5zm7.2 0h1.8c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5h-1.8c-.8 0-1.5-.7-1.5-1.5v-11c0-.8.7-1.5 1.5-1.5z"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.6c-.2 0-.3 0-.5-.1C11.2 20.3 3.5 15.7 3.5 9.5a5.3 5.3 0 0 1 8.5-4.2 5.3 5.3 0 0 1 8.5 4.2c0 6.2-7.7 10.8-8 11-.2.1-.3.1-.5.1z"/></svg>',
  heartLine: '<svg viewBox="0 0 24 24"><path d="M12 20.6c-.2 0-.3 0-.5-.1C11.2 20.3 3.5 15.7 3.5 9.5a5.3 5.3 0 0 1 8.5-4.2 5.3 5.3 0 0 1 8.5 4.2c0 6.2-7.7 10.8-8 11-.2.1-.3.1-.5.1zM12 7.6l-.8-.7a3.3 3.3 0 0 0-5.7 2.6c0 4.3 5 8 6.5 9 1.5-1 6.5-4.7 6.5-9a3.3 3.3 0 0 0-5.7-2.6z"/></svg>',
};
const store = () => { try { return JSON.parse(N ? N.storageGetAll() : localStorage.getItem('yp-local') || '{}'); } catch (e) { return {}; } };
const save = (o) => { if (N) N.storageSet(JSON.stringify(o)); else localStorage.setItem('yp-local', JSON.stringify({ ...store(), ...o })); };
const host = (m) => { if (N) N.postHost(m); };
const fmt = (s) => { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let tracks = [], view = [], filter = 'all', queue = [], qi = -1, shuffle = false, repeat = 'off', sleepAt = 0;
let fav = new Set(store().localFav || []), recent = store().localRecent || [];
const audio = $('#audio');
const st = store();
if (st.accent) document.documentElement.style.setProperty('--accent', st.accent);

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); }
const art = (t) => t && t.albumId ? '/art/' + t.albumId : '';

async function load() {
  let r;
  try { r = await (await fetch('/api/tracks')).json(); } catch (e) { r = { tracks: [] }; }
  if (r.perm === false) { $('#perm').hidden = false; $('#count').textContent = 'Нужен доступ к музыке'; return; }
  $('#perm').hidden = true;
  tracks = (r.tracks || []).sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title, 'ru'));
  $('#count').textContent = tracks.length ? `${tracks.length} ${tracks.length % 10 === 1 && tracks.length % 100 !== 11 ? 'трек' : 'треков'} на телефоне` : 'Музыкальных файлов на телефоне не найдено';
  render();
}
function render() {
  const q = $('#filter').value.trim().toLowerCase();
  let list = tracks;
  if (filter === 'fav') list = tracks.filter((t) => fav.has(t.id));
  if (filter === 'recent') list = recent.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
  if (q) list = list.filter((t) => (t.title + ' ' + t.artist + ' ' + t.album).toLowerCase().includes(q));
  view = list;
  const cur = queue[qi];
  $('#list').innerHTML = list.length ? list.map((t, i) => `
    <div class="row${cur && cur.id === t.id ? ' on' : ''}" data-i="${i}">
      <span class="cover">${t.albumId ? `<img loading="lazy" src="${art(t)}" onerror="this.remove()">` : ''}</span>
      <span class="meta"><b>${esc(t.title)}</b><small>${esc(t.artist)}${t.album ? ' · ' + esc(t.album) : ''}</small></span>
      <span class="dur">${fmt(t.duration / 1000)}</span>
      <button class="fav${fav.has(t.id) ? ' on' : ''}" data-fav="${esc(t.id)}">${fav.has(t.id) ? ICON.heart : ICON.heartLine}</button>
    </div>`).join('') : `<div class="empty">${filter === 'fav' ? 'Отмечайте треки сердечком — они появятся здесь.' : filter === 'recent' ? 'Здесь будут треки, которые вы слушали.' : q ? 'Ничего не нашлось' : ''}</div>`;
}
$('#list').addEventListener('click', (e) => {
  const f = e.target.closest('[data-fav]');
  if (f) { toggleFav(f.dataset.fav); return; }
  const row = e.target.closest('.row');
  if (row) playList(view, +row.dataset.i);
});
function toggleFav(id) {
  if (fav.has(id)) fav.delete(id); else fav.add(id);
  save({ localFav: [...fav] }); render(); paint();
}

// ── playback ──
function playList(list, i) {
  queue = list.slice();
  if (shuffle) { const first = queue.splice(i, 1)[0]; for (let k = queue.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [queue[k], queue[j]] = [queue[j], queue[k]]; } queue.unshift(first); i = 0; }
  playAt(i);
  openNp();
}
function playAt(i) {
  if (i < 0 || i >= queue.length) return;
  qi = i; const t = queue[i];
  audio.src = '/media/' + encodeURIComponent(t.id);
  audio.play().catch(() => {});
  recent = [t.id, ...recent.filter((x) => x !== t.id)].slice(0, 60); save({ localRecent: recent });
  paint(); render();
}
function next(auto) {
  if (repeat === 'one' && auto) { audio.currentTime = 0; audio.play(); return; }
  if (qi + 1 < queue.length) playAt(qi + 1);
  else if (repeat === 'all' && queue.length) playAt(0);
  else { audio.pause(); paint(); }
}
function prev() { if (audio.currentTime > 3) audio.currentTime = 0; else playAt(Math.max(0, qi - 1)); }
const toggle = () => { if (!audio.src) { if (view.length) playList(view, 0); return; } if (audio.paused) audio.play(); else audio.pause(); };
audio.addEventListener('ended', () => next(true));
audio.addEventListener('play', paint); audio.addEventListener('pause', paint);
audio.addEventListener('error', () => { toast('Этот файл не воспроизводится — пропускаю'); setTimeout(() => next(true), 600); });

function paint() {
  const t = queue[qi];
  $('#mini').hidden = !t;
  document.body.classList.toggle('has-mini', !!t);
  const playIcon = audio.paused ? ICON.play : ICON.pause;
  $('#mini-play').innerHTML = playIcon; $('#c-play').innerHTML = playIcon;
  if (!t) return;
  for (const [sel, v] of [['#mini-title', t.title], ['#mini-artist', t.artist], ['#np-title', t.title], ['#np-artist', t.artist + (t.album ? ' · ' + t.album : '')]]) $(sel).textContent = v;
  const a = art(t);
  for (const img of [$('#mini-art'), $('#np-art')]) { img.src = a || 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; img.classList.toggle('none', !a); }
  $('#bg-art').style.backgroundImage = a ? `url("${a}")` : '';
  const liked = fav.has(t.id);
  $('#np-like').innerHTML = liked ? ICON.heart : ICON.heartLine; $('#np-like').classList.toggle('on', liked);
  $('#c-shuffle').classList.toggle('on', shuffle);
  $('#c-repeat').classList.toggle('on', repeat !== 'off'); $('#c-repeat').classList.toggle('one', repeat === 'one');
  host('media:' + JSON.stringify({ title: t.title, artist: t.artist, art: '', playing: !audio.paused, src: 'local' }));
}
function frame() {
  const d = audio.duration || 0, c = audio.currentTime || 0, p = d ? c / d : 0;
  $('#mini .bar').style.transform = `scaleX(${p})`;
  $('#seek .fill').style.transform = `scaleX(${p})`; $('#seek .knob').style.left = (p * 100) + '%';
  $('#t-cur').textContent = fmt(c); $('#t-dur').textContent = fmt(d);
  if (sleepAt && Date.now() >= sleepAt) { sleepAt = 0; audio.pause(); $('#sleep-label').hidden = true; toast('Спокойной ночи — музыка на паузе'); }
  if (sleepAt) $('#sleep-label').textContent = 'Пауза через ' + Math.ceil((sleepAt - Date.now()) / 60000) + ' мин';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// seek bar (touch + mouse)
const seek = $('#seek');
seek.addEventListener('pointerdown', (e) => {
  seek.setPointerCapture(e.pointerId);
  const go = (ev) => { const r = seek.getBoundingClientRect(); if (audio.duration) audio.currentTime = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * audio.duration; };
  go(e); seek.onpointermove = go; seek.onpointerup = () => { seek.onpointermove = null; };
});

// Now Playing
const openNp = () => { $('#np').classList.add('open'); $('#np').setAttribute('aria-hidden', 'false'); };
const closeNp = () => { $('#np').classList.remove('open'); $('#np').setAttribute('aria-hidden', 'true'); };
$('#mini').addEventListener('click', (e) => { if (!e.target.closest('button')) openNp(); });
$('#np-close').onclick = closeNp;
$('#mini-play').onclick = toggle; $('#c-play').onclick = toggle;
$('#mini-next').onclick = () => next(false); $('#c-next').onclick = () => next(false); $('#c-prev').onclick = prev;
$('#c-shuffle').onclick = () => { shuffle = !shuffle; toast(shuffle ? 'Перемешивание включено' : 'Перемешивание выключено'); paint(); };
$('#c-repeat').onclick = () => { repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; toast(repeat === 'off' ? 'Повтор выключен' : repeat === 'all' ? 'Повтор всего списка' : 'Повтор трека'); paint(); };
$('#np-like').onclick = () => { const t = queue[qi]; if (t) toggleFav(t.id); };
$('#np-sleep').onclick = () => {
  const steps = [15, 30, 60, 0]; const curMin = sleepAt ? Math.round((sleepAt - Date.now()) / 60000) : 0;
  const nxt = steps[(steps.findIndex((s) => s >= curMin && s !== 0 && curMin) + 1) % steps.length] ?? 15;
  const v = sleepAt ? nxt : 15;
  sleepAt = v ? Date.now() + v * 60000 : 0; $('#sleep-label').hidden = !v; toast(v ? 'Пауза через ' + v + ' мин' : 'Таймер сна выключен');
};
let y0 = null;
$('#np').addEventListener('touchstart', (e) => { if (!e.target.closest('#seek')) y0 = e.touches[0].clientY; }, { passive: true });
$('#np').addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 110) closeNp(); y0 = null; }, { passive: true });

// header / lists
$('#play-all').onclick = () => { if (view.length) { shuffle = false; playList(view, 0); } };
$('#shuffle-all').onclick = () => { if (view.length) { shuffle = true; playList(view, Math.floor(Math.random() * view.length)); } };
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => { filter = b.dataset.f; for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x === b); render(); };
$('#filter').addEventListener('input', render);
$('#perm-btn').onclick = () => host('perm-audio');
$('#retry').onclick = () => host('go-online');
$('#online-btn').onclick = () => host('go-online');

// called by the app
window.__ypNet = (online) => {
  $('#net').hidden = false;
  $('#net').classList.toggle('online', online);
  $('#net-title').textContent = online ? 'Интернет снова есть' : 'Нет подключения к интернету';
  $('#net-sub').textContent = online ? 'Можно вернуться в YouTube Music и SoundCloud' : 'Играет музыка с вашего телефона — YouPlay работает и без сети';
  $('#retry').textContent = online ? 'Открыть' : 'Повторить';
  $('#online-btn').hidden = !online;
};
window.__ypReload = load;
window.__ypBack = () => { if ($('#np').classList.contains('open')) { closeNp(); return true; } return false; };
window.addEventListener('message', (e) => {
  const a = e.data && e.data.ypMedia; if (!a) return;
  if (a === 'toggle') toggle(); else if (a === 'play') audio.play(); else if (a === 'pause') audio.pause(); else if (a === 'next') next(false); else if (a === 'prev') prev();
});
load();
