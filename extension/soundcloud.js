'use strict';
/* YouPlay — SoundCloud tracks in the same queue as YouTube Music.
   Tracks are added by link and played through SoundCloud's official embeddable widget
   (w.soundcloud.com/player), controlled with its postMessage API. Loaded after content.js. */

const SC = {
  frame: null, ready: false,
  queue: [],            // upcoming SoundCloud items, play right after the current YouTube Music track
  current: null,        // item that is playing now
  active: false,        // SoundCloud is the current source
  paused: true, pos: 0, dur: 0,
  bypassNext: false,
};
const SC_ORIGIN = 'https://w.soundcloud.com';
const isScUrl = (u) => /^https?:\/\/(www\.|m\.|on\.)?soundcloud\.com\/\S+|^https?:\/\/snd\.sc\/\S+/i.test(String(u || '').trim());

function scPost(method, value) {
  if (SC.frame && SC.frame.contentWindow) SC.frame.contentWindow.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), SC_ORIGIN);
}
function scWidgetUrl(url, autoplay) {
  return SC_ORIGIN + '/player/?url=' + encodeURIComponent(url) + '&auto_play=' + (autoplay ? 'true' : 'false') + '&visual=false&show_artwork=false&show_comments=false&buying=false&sharing=false&download=false&show_playcount=false&show_user=false';
}
function scBigArt(a) { return a ? a.replace(/-(large|t\d+x\d+|small|badge|tiny|mini|crop)\./, '-t500x500.') : ''; }

// ───────── playback ─────────
function scLoad(item) {
  SC.current = item; SC.active = true; SC.ready = false; SC.pos = 0; SC.dur = (item.duration || 0); SC.paused = true;
  document.documentElement.classList.add('yp-sc-active');
  if (video && !video.paused) video.pause();
  if (!SC.frame) {
    SC.frame = h('iframe', { id: 'yp-sc-frame', allow: 'autoplay; encrypted-media', title: 'SoundCloud', tabindex: '-1' });
    document.body.append(SC.frame);
  }
  SC.frame.src = scWidgetUrl(item.url, true);
  scShowTrack();
  renderQueue();
}
function scPlayNext() {
  const next = SC.queue.shift();
  if (next) { scLoad(next); return true; }
  return false;
}
function scStop(resumeYt) {
  if (!SC.active) return;
  SC.active = false; SC.current = null; SC.paused = true;
  document.documentElement.classList.remove('yp-sc-active');
  scPost('pause');
  if (SC.frame) { SC.frame.src = 'about:blank'; }
  track = { key: '' };                 // let the watchdog re-announce the YouTube Music track
  if (resumeYt === 'next') { SC.bypassNext = true; clickBar('.next-button'); setTimeout(() => { SC.bypassNext = false; }, 500); }
  else if (resumeYt === 'play' && video && video.paused) video.play();
  renderQueue();
  syncPlayIcon();
}
function scFinished() {
  if (!scPlayNext()) scStop('next');   // back to YouTube Music: its next track
}

window.addEventListener('message', (e) => {
  if (e.origin !== SC_ORIGIN || !SC.frame || e.source !== SC.frame.contentWindow) return;
  let m; try { m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  if (!m || !m.method) return;
  const v = m.value;
  switch (m.method) {
    case 'ready':
      SC.ready = true;
      for (const ev of ['play', 'pause', 'finish', 'playProgress', 'error']) scPost('addEventListener', ev);
      scPost('setVolume', Math.round((video ? video.volume : 1) * 100));
      scPost('play');
      scPost('getCurrentSound'); scPost('getDuration');
      break;
    case 'play': SC.paused = false; playing = true; syncPlayIcon(); kick(); if (video && !video.paused) video.pause(); break;
    case 'pause': SC.paused = true; playing = false; syncPlayIcon(); paintProgress(); break;
    case 'playProgress': if (v) { SC.pos = (v.currentPosition || 0) / 1000; if (SC.paused) { SC.paused = false; playing = true; syncPlayIcon(); kick(); } } break;
    case 'getDuration': if (v) SC.dur = v / 1000; break;
    case 'getCurrentSound':
      if (v && SC.current) {
        const it = SC.current;
        it.title = v.title || it.title; it.artist = (v.user && v.user.username) || it.artist;
        it.art = scBigArt(v.artwork_url || (v.user && v.user.avatar_url)) || it.art;
        if (v.duration) { SC.dur = v.duration / 1000; it.duration = SC.dur; }
        scShowTrack(true);
      }
      break;
    case 'finish': scFinished(); break;
    case 'error': toast(h('div', { class: 'yp-tt' }, h('span', { text: 'SoundCloud не смог воспроизвести этот трек — пропускаю' })), { timeout: 3500 }); scFinished(); break;
  }
});

// time / seeking used by Now Playing, lyrics and the progress bar
function scSeek(sec) { SC.pos = sec; scPost('seekTo', Math.max(0, sec * 1000)); }

function scShowTrack(withLyrics) {
  const it = SC.current; if (!it) return;
  setBackdrop(it.art || '');
  ui.lyArt.src = it.art || '';
  ui.lyBgArt.style.backgroundImage = it.art ? `url("${it.art}")` : '';
  ui.lyTitle.textContent = it.title || 'SoundCloud';
  syncPlayIcon();
  ui.lyArtist.textContent = it.artist || '';
  setSrcBadge('sc');
  if (!ui.lyrics.classList.contains('full')) openNowPlaying();
  if (withLyrics !== false && (it.title || it.artist) && it._lyricsFor !== it.title) {
    it._lyricsFor = it.title;
    loadLyrics({ title: it.title, artist: it.artist || '', album: '', key: 'sc|' + it.url, sc: true });
  }
}

// ───────── adding by link ─────────
async function scResolve(url) {
  const o = await chrome.runtime.sendMessage({ type: 'sc-oembed', url });
  if (!o || !o.html) return null;
  const src = (o.html.match(/src="([^"]+)"/) || [])[1] || '';
  const inner = decodeURIComponent((src.match(/[?&]url=([^&]+)/) || [])[1] || '');
  const isSet = /\/playlists\//.test(inner) || /\/sets\//.test(url);
  let title = o.title || '', artist = o.author_name || '';
  const by = title.lastIndexOf(' by ');
  if (by > 0 && title.slice(by + 4) === artist) title = title.slice(0, by);
  return { isSet, title, artist, art: scBigArt(o.thumbnail_url), widgetSrc: inner || url };
}
// a playlist: load it once in a hidden widget and read its track list
function scExpandSet(apiUrl) {
  return new Promise((resolve) => {
    const f = h('iframe', { class: 'yp-sc-probe', allow: 'autoplay', tabindex: '-1', src: scWidgetUrl(apiUrl, false) });
    let done = false;
    const finish = (list) => { if (done) return; done = true; removeEventListener('message', on); f.remove(); resolve(list); };
    const on = (e) => {
      if (e.origin !== SC_ORIGIN || e.source !== f.contentWindow) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.method === 'ready') f.contentWindow.postMessage(JSON.stringify({ method: 'getSounds' }), SC_ORIGIN);
      if (m.method === 'getSounds' && Array.isArray(m.value)) finish(m.value);
    };
    addEventListener('message', on);
    document.body.append(f);
    setTimeout(() => finish([]), 15000);
  });
}
async function scAdd(url, playNow) {
  url = String(url || '').trim();
  if (!isScUrl(url)) { toast(h('div', { class: 'yp-tt' }, h('span', { text: 'Это не ссылка SoundCloud' })), { timeout: 2500 }); return; }
  const wait = toast(h('div', { class: 'yp-tt' }, h('span', { class: 'yp-badge sc', text: 'SoundCloud' }), h('span', { text: 'Добавляю…' })), { timeout: 0 });
  let r = null;
  try { r = await scResolve(url); } catch {}
  if (!r) { dismiss(wait); toast(h('div', { class: 'yp-tt' }, h('span', { text: 'Не удалось открыть ссылку SoundCloud (трек приватный или удалён?)' })), { timeout: 4000 }); return; }
  let items = [];
  if (r.isSet) {
    const sounds = await scExpandSet(r.widgetSrc);
    items = sounds.map((s) => ({ url: s.permalink_url || ('https://api.soundcloud.com/tracks/' + s.id), title: s.title || '', artist: (s.user && s.user.username) || r.artist, art: scBigArt(s.artwork_url) || r.art, duration: s.duration ? s.duration / 1000 : 0 }));
  } else {
    items = [{ url, title: r.title, artist: r.artist, art: r.art, duration: 0 }];
  }
  dismiss(wait);
  if (!items.length) { toast(h('div', { class: 'yp-tt' }, h('span', { text: 'В этом плейлисте нет доступных треков' })), { timeout: 3000 }); return; }
  for (const it of items) it.id = Math.random().toString(36).slice(2);
  SC.queue.push(...items);
  toast(h('div', { class: 'yp-tt' }, h('span', { class: 'yp-badge sc', text: 'SoundCloud' }),
    h('span', { text: items.length > 1 ? `В очередь добавлено ${items.length} треков из «${r.title}»` : `В очереди: ${items[0].title || 'трек'}${items[0].artist ? ' — ' + items[0].artist : ''}` })), { timeout: 3500 });
  if (playNow || (!SC.active && (!video || video.paused) && !ytQueueItems().length)) scPlayNext();
  renderQueue();
}
function scPlayItem(id) {
  const i = SC.queue.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [it] = SC.queue.splice(i, 1);
  scLoad(it);
}
function scRemove(id) { SC.queue = SC.queue.filter((x) => x.id !== id); renderQueue(); }

// ───────── hooks into YouTube Music playback ─────────
// 1) at the end of a YouTube Music track, queued SoundCloud tracks play first
function scWatchEnd() {
  if (SC.active || !SC.queue.length || !video || video.paused || !isFinite(video.duration)) return;
  const repeatOne = $('ytmusic-player-bar .repeat:is([title*="один"], [title*="одну"], [title*="One"], [title*="one"])');
  if (!repeatOne && video.duration - video.currentTime < 0.45 && video.currentTime > 1) { video.pause(); scPlayNext(); }
}
// 2) "next" while SoundCloud items are waiting plays them; "next" during SoundCloud goes on
document.addEventListener('click', (e) => {
  const nb = e.target.closest && e.target.closest('ytmusic-player-bar .next-button');
  if (!nb || SC.bypassNext) return;
  if (SC.active) { e.preventDefault(); e.stopPropagation(); scFinished(); return; }
  if (SC.queue.length) { e.preventDefault(); e.stopPropagation(); if (video) video.pause(); scPlayNext(); }
}, true);
// 3) pressing play on YouTube Music while SoundCloud plays returns to YouTube Music
function scOnVideoPlay() { if (SC.active) scStop(); }

// paste a SoundCloud link anywhere (outside text fields) to queue it
document.addEventListener('paste', (e) => {
  const t = e.target;
  if (t && (t.closest('input, textarea, [contenteditable="true"]') && !t.closest('.yp-sc-add'))) return;
  const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
  if (isScUrl(text)) { e.preventDefault(); scAdd(text); }
}, true);

// queue rows for SoundCloud items (used by renderQueue)
function scRows() {
  const rows = [];
  if (SC.active && SC.current) rows.push(scRow(SC.current, true));
  SC.queue.forEach((it) => rows.push(scRow(it, false)));
  return rows;
}
function scRow(it, on) {
  return h('div', { class: 'yp-q-item yp-q-sc' + (on ? ' on' : ''), title: it.title, role: 'button', onclick: () => { if (!on) scPlayItem(it.id); } },
    h('span', { class: 'yp-q-n' }, on ? h('i', { class: 'yp-eq' }, h('b'), h('b'), h('b')) : h('span', { class: 'yp-cloud' })),
    h('img', { src: it.art || '', alt: '', loading: 'lazy' }),
    h('span', { class: 'yp-q-meta' }, h('b', { text: it.title || 'Трек SoundCloud' }), h('small', {}, h('span', { class: 'yp-badge sc', text: 'SoundCloud' }), ' ' + (it.artist || ''))),
    on ? h('span', { class: 'yp-q-d', text: SC.dur ? fmt(SC.dur) : '' }) :
      h('span', { class: 'yp-q-x', title: 'Убрать из очереди', onclick: (e) => { e.stopPropagation(); scRemove(it.id); }, text: '×' }));
}
