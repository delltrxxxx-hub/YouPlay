'use strict';
/* YouPlay mobile shell (Android app; also active in a desktop browser that emulates an Android phone).
   Bottom tabs, mini player, full-screen Now Playing with Lyrics / Queue sheets, swipe-down to close,
   Android back button and media-notification bridge. Loaded after content.js, soundcloud.js and hub.js. */
const MOBILE = /Android/i.test(navigator.userAgent) || !!window.YouPlayNative;
if (MOBILE) (function () {
  document.documentElement.classList.add('yp-mobile');
  const M = {};
  const go = (path) => { const a = document.createElement('a'); a.href = path; a.className = 'yt-simple-endpoint'; document.body.append(a); a.click(); a.remove(); };
  const browse = (id) => window.postMessage({ ypYt: 'browse', browseId: id }, location.origin);

  function build() {
    if (M.tabs || !ui.root) return;
    // ── bottom tabs ──
    const tab = (id, label, ic, on) => h('button', { class: 'yp-tab', 'data-t': id, onclick: on }, icon(ic, 24), h('span', { text: label }));
    M.tabs = h('nav', { id: 'yp-tabs' },
      tab('home', 'Главная', 'M4 10.2L12 4l8 6.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z', () => { try { hubHide(); } catch {} browse('FEmusic_home'); }),
      tab('search', 'Поиск', 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm5.6 9.2 4.6 4.6-1.4 1.4-4.6-4.6z', () => openSearch()),
      tab('likes', 'Любимое', I.heart, () => { try { openLikes(); } catch {} }),
      tab('library', 'Медиатека', 'M5 4h2v16H5zm4.5 0h2v16h-2zm4.3.6 1.9-.6 4.5 15.4-1.9.6z', () => { try { hubHide(); } catch {} browse('FEmusic_library_landing'); }),
      tab('settings', 'Настройки', I.gear, () => openSettings()));
    // ── mini player ──
    M.mini = h('div', { id: 'yp-mini', onclick: (e) => { if (!e.target.closest('button')) openNowPlaying(); } },
      M.miniBar = h('i', { class: 'yp-mini-bar' }),
      M.miniArt = h('img', { alt: '' }),
      h('div', { class: 'yp-mini-meta' }, M.miniTitle = h('b'), M.miniArtist = h('small')),
      M.miniLike = h('button', { class: 'yp-mini-btn', title: 'Нравится', onclick: () => likeCurrent() }, icon(I.heartLine, 22)),
      M.miniPlay = h('button', { class: 'yp-mini-btn play', title: 'Играть / пауза', onclick: () => togglePlay() }, icon(I.play, 26)),
      h('button', { class: 'yp-mini-btn', title: 'Далее', onclick: () => clickBar('.next-button') }, icon(I.next, 24)));
    ui.root.append(M.mini, M.tabs);
    // ── Now Playing: phone layout extras ──
    M.npTop = h('div', { class: 'yp-np-top' },
      h('button', { class: 'yp-ic', title: 'Свернуть', onclick: () => toggleLyrics(false) }, icon('M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z', 28)),
      M.npTopTitle = h('span', { text: 'Сейчас играет' }),
      h('button', { class: 'yp-ic', title: 'Настройки', onclick: () => openSettings() }, icon(I.gear, 22)));
    M.npTabs = h('div', { class: 'yp-np-sheets' },
      M.tLyrics = h('button', { class: 'yp-chip', onclick: () => sheet('lyrics') }, icon(I.lyrics, 15), h('span', { text: 'Текст' })),
      M.tQueue = h('button', { class: 'yp-chip', onclick: () => sheet('queue') }, icon(I.queue, 15), h('span', { text: 'Очередь' })),
      M.tCloud = h('button', { class: 'yp-chip', onclick: () => { sheet('queue'); setTimeout(() => ui.scInput && ui.scInput.focus(), 300); } }, icon(I.cloud, 15), h('span', { text: 'SoundCloud' })));
    ui.lyrics.prepend(M.npTop);
    const ctrl = ui.lyrics.querySelector('.yp-np-ctrl');
    if (ctrl) ctrl.append(M.npTabs);
    // swipe down on the cover to close Now Playing
    let y0 = null;
    ui.lyrics.addEventListener('touchstart', (e) => { if (!e.target.closest('.yp-ly-scroll, .yp-q-list, .yp-np-bar')) y0 = e.touches[0].clientY; }, { passive: true });
    ui.lyrics.addEventListener('touchmove', (e) => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) ui.lyrics.style.transform = `translateY(${dy}px)`; }, { passive: true });
    ui.lyrics.addEventListener('touchend', (e) => { if (y0 == null) return; const dy = (e.changedTouches[0].clientY - y0); y0 = null; ui.lyrics.style.transform = ''; if (dy > 120) toggleLyrics(false); }, { passive: true });
  }
  function sheet(which) {
    const L = ui.lyrics;
    const cur = L.classList.contains('show-queue') ? 'queue' : L.classList.contains('m-lyrics') ? 'lyrics' : null;
    L.classList.remove('m-lyrics'); toggleQueue(false);
    if (cur !== which) { if (which === 'lyrics') L.classList.add('m-lyrics'); else toggleQueue(true); }
    M.tLyrics.classList.toggle('on', L.classList.contains('m-lyrics'));
    M.tQueue.classList.toggle('on', L.classList.contains('show-queue'));
    lastLine = -2; kick();
  }
  function openSearch() {
    try { hubHide(); } catch {}
    const btn = $('ytmusic-nav-bar ytmusic-search-box .search-button, ytmusic-nav-bar tp-yt-paper-icon-button.search-button, ytmusic-search-box #input');
    if (btn) { btn.click(); setTimeout(() => { const i = $('ytmusic-search-box input'); if (i) i.focus(); }, 150); }
  }
  function togglePlay() { if (scOn()) scPost('toggle'); else clickBar('#play-pause-button'); }

  // ── keep the mini player and tabs in sync ──
  let lastMedia = '';
  function tick() {
    build();
    if (!M.mini) return;
    // YouTube Music opened its own full-screen player: show YouPlay's Now Playing instead
    const lay = $('ytmusic-app-layout');
    const st = lay ? lay.getAttribute('player-ui-state') : '';
    const ytPage = st === 'FULLSCREEN' || st === 'PLAYER_PAGE_OPEN';
    const npFull = ui.lyrics.classList.contains('full');
    if (M.npWasFull && !npFull && ytPage) browse('FEmusic_home');          // closing Now Playing leaves YouTube's player page; music keeps playing
    else if (ytPage && !npFull && !M.npWasFull && (track.title || scOn())) openNowPlaying();
    M.npWasFull = ui.lyrics.classList.contains('full');
    const sc = scOn() && SC.current;
    const title = sc ? SC.current.title : track.title;
    const has = !!title;
    M.mini.classList.toggle('show', has && !ui.lyrics.classList.contains('full'));
    document.documentElement.classList.toggle('yp-has-mini', has);
    if (has) {
      const artist = sc ? SC.current.artist : track.artist, art = sc ? SC.current.art : track.art;
      if (M.miniTitle.textContent !== title) M.miniTitle.textContent = title;
      if (M.miniArtist.textContent !== (artist || '')) M.miniArtist.textContent = artist || '';
      if (art && M.miniArt.src !== art) M.miniArt.src = art;
      const p = curDur() ? clamp(curTime() / curDur()) : 0;
      M.miniBar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      M.miniPlay.replaceChildren(icon(playing ? I.pause : I.play, 26));
      M.miniLike.replaceChildren(icon(ui.npLike && ui.npLike.classList.contains('on') ? I.heart : I.heartLine, 22));
      M.miniLike.classList.toggle('on', !!(ui.npLike && ui.npLike.classList.contains('on')));
      if (M.npTopTitle) M.npTopTitle.textContent = sc ? 'SoundCloud' : 'YouTube Music';
      // media notification (Android)
      const media = JSON.stringify({ title, artist: artist || '', art: art || '', playing: !!playing, src: sc ? 'sc' : 'yt' });
      if (media !== lastMedia) { lastMedia = media; sendHost('media:' + media); }
    }
    const view = (() => { try { return HUB.view; } catch { return null; } })();
    const t = view === 'likes' ? 'likes' : (view === 'search' || location.pathname === '/search') ? 'search' : /library/.test(location.pathname) ? 'library' : location.pathname === '/' ? 'home' : '';
    for (const b of M.tabs.children) b.classList.toggle('on', b.dataset.t === t);
  }
  setInterval(tick, 500);

  // media notification buttons and the Android back button (called by the app)
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.ypMedia) return;
    const a = e.data.ypMedia;
    if (a === 'toggle') togglePlay(); else if (a === 'play') { if (!playing) togglePlay(); } else if (a === 'pause') { if (playing) togglePlay(); }
    else if (a === 'next') clickBar('.next-button'); else if (a === 'prev') clickBar('.previous-button');
  });
  window.__ypBack = function () {
    if (document.querySelector('#yp-upd-wrap')) { document.querySelector('#yp-upd-wrap').remove(); return true; }
    if (document.querySelector('#yp-modal-wrap')) { closeSettings(); return true; }
    if (ui.lyrics && ui.lyrics.classList.contains('full')) {
      if (ui.lyrics.classList.contains('m-lyrics') || ui.lyrics.classList.contains('show-queue')) { sheet(ui.lyrics.classList.contains('m-lyrics') ? 'lyrics' : 'queue'); return true; }
      toggleLyrics(false); return true;
    }
    try { if (HUB.view) { HUB.hideFor = HUB.q; hubHide(); return true; } } catch {}
    const sb = $('ytmusic-search-box[opened]');
    if (sb) { const c = $('ytmusic-search-box #clear-button, ytmusic-search-box .back-button'); if (c) c.click(); return true; }
    return false;
  };
})();
