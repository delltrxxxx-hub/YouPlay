// YouPlay engine — runs inside the hidden YouTube Music window (main world). The visible YouPlay app
// asks it for pages (home, search, playlists, likes) which it opens inside this hidden window and reads
// from what YouTube Music renders, and it plays / controls tracks with YouTube Music's own player.
(function () {
  if (window.__ypEngine) return; window.__ypEngine = true;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = (o) => {
    const s = JSON.stringify(o);
    if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(s);
    else if (window.YouPlayNative) window.YouPlayNative.postHost('ui:' + s);
  };
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const big = (u) => (u ? u.replace(/=w\d+-h\d+[^&]*/, '=w544-h544-l90-rj').replace(/\/(sd|hq|mq|default)default\.jpg/, '/hqdefault.jpg') : '');
  const vid = (a) => { try { return new URL(a.href, location.origin).searchParams.get('v'); } catch (e) { return null; } };
  const app = () => $('ytmusic-app');
  const nav = (endpoint) => { const a = app(); if (a) a.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } })); };

  // ── reading what YouTube Music shows ──
  function row(n) {
    const a = n.querySelector('a[href*="watch?v="]');
    const title = text(n.querySelector('.title-column .title, .title'));
    const sub = text(n.querySelector('.secondary-flexible-columns') || n.querySelector('.flex-column'));
    const parts = sub.split('•').map((x) => x.trim()).filter(Boolean);
    const kindRaw = (parts[0] || '').toLowerCase();
    let kind = /видео|video|клип/.test(kindRaw) ? 'video' : /исполнитель|artist/.test(kindRaw) ? 'artist' : /альбом|album|сингл|single|ep/.test(kindRaw) ? 'album' : /плейлист|playlist/.test(kindRaw) ? 'playlist' : 'song';
    if (/^(видео|video|композиция|song|трек|track|клип|исполнитель|artist|альбом|album|сингл|single|ep|плейлист|playlist)$/i.test(parts[0] || '')) parts.shift();
    const fixed = text(n.querySelector('.fixed-columns, .fixed-column'));
    const dur = parts.find((p) => /^\d+:\d\d(:\d\d)?$/.test(p)) || (/^\d+:\d\d/.test(fixed) ? fixed : '');
    const img = n.querySelector('img');
    const link = n.querySelector('a[href*="browse/"], a[href*="playlist?list="], a[href*="channel/"]');
    const v = a ? vid(a) : null;
    if (!v && kind === 'song') kind = link ? 'album' : 'song';
    let artist = parts.filter((p) => p !== dur && !/прослуш|просмотр|views|plays|слушател|подписч/i.test(p)).slice(0, 2).join(', ');
    if (!artist) { const cs = n.closest('ytmusic-card-shelf-renderer'); if (cs) artist = text(cs.querySelector('.details-container .title, .title')); }
    return {
      src: 'yt', kind, videoId: v, title,
      artist, durText: dur,
      art: img && img.src && !img.src.startsWith('data:') ? big(img.src) : (v ? `https://i.ytimg.com/vi/${v}/hqdefault.jpg` : ''),
      browse: !v && link ? link.getAttribute('href') : null,
    };
  }
  function card(n) {
    const a = n.querySelector('a.image-wrapper, a[href]');
    const href = a ? a.getAttribute('href') || '' : '';
    const img = n.querySelector('img');
    const v = /watch\?v=/.test(href) ? new URL(href, location.origin).searchParams.get('v') : null;
    return {
      src: 'yt', kind: v ? 'song' : /channel\//.test(href) ? 'artist' : 'playlist', videoId: v, browse: v ? null : href,
      title: text(n.querySelector('.title')), artist: text(n.querySelector('.subtitle, .details .subtitle')),
      art: img && img.src && !img.src.startsWith('data:') ? big(img.src) : (v ? `https://i.ytimg.com/vi/${v}/hqdefault.jpg` : ''),
      round: !!n.querySelector('.image-wrapper[aria-label], ytmusic-thumbnail-renderer[thumbnail-crop="MUSIC_THUMBNAIL_CROP_CIRCLE"]') || /channel\//.test(href),
    };
  }
  function sections(root) {
    // group every row / card by the shelf it sits in (YouTube Music changes these containers often, so be generous)
    const groups = new Map();
    for (const el of $$('ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer', root)) {
      if (el.closest('ytmusic-player-page, ytmusic-player-queue')) continue;
      const sh = el.closest('ytmusic-carousel-shelf-renderer, ytmusic-shelf-renderer, ytmusic-card-shelf-renderer, ytmusic-item-section-renderer, ytmusic-playlist-shelf-renderer, ytmusic-grid-renderer, [class*="shelf"]') || root;
      if (!groups.has(sh)) groups.set(sh, []);
      groups.get(sh).push(el);
    }
    const out = [];
    for (const [sh, els] of groups) {
      const title = sh === root ? '' : text(sh.querySelector('.title, h2'));
      const items = els.map((e) => e.tagName === 'YTMUSIC-TWO-ROW-ITEM-RENDERER' ? card(e) : row(e)).filter((x) => x.title);
      const cards = els.filter((e) => e.tagName === 'YTMUSIC-TWO-ROW-ITEM-RENDERER').length;
      if (items.length) out.push({ title, items: items.slice(0, 40), layout: cards > els.length / 2 ? 'cards' : 'rows' });
    }
    return out;
  }
  async function settle(match, timeout = 9000) {
    const t0 = Date.now(); let last = -1, stable = 0;
    while (Date.now() - t0 < timeout) {
      await wait(250);
      if (!match()) continue;
      const n = $('ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer', pageRoot()).length;
      if (n > 0 && n === last) { if (++stable >= 6) return true; } else stable = 0;
      last = n;
    }
    return false;
  }
  const pageRoot = () => $('ytmusic-browse-response:not([hidden]), ytmusic-search-page:not([hidden])') || document;

  // jobs that need this window to open a page run one at a time
  let chain = Promise.resolve();
  const job = (fn) => (chain = chain.then(fn, fn));

  async function home() {
    nav({ browseEndpoint: { browseId: 'FEmusic_home' } });
    await settle(() => location.pathname === '/');
    return { sections: sections(pageRoot()) };
  }
  async function search(q) {
    nav({ searchEndpoint: { query: q } });
    await settle(() => location.pathname === '/search' && new URLSearchParams(location.search).get('q') === q);
    const secs = sections(pageRoot());
    const tracks = [], seen = new Set(), more = [];
    for (const s of secs) for (const it of s.items) {
      if (it.videoId && !seen.has(it.videoId)) { seen.add(it.videoId); tracks.push(it); }
      else if (!it.videoId && it.browse) more.push(it);
    }
    tracks.sort((a, b) => (a.kind === 'video') - (b.kind === 'video'));
    return { tracks: tracks.slice(0, 40), more: more.slice(0, 16) };
  }
  async function browse(href) {
    const m = /browse\/([\w-]+)/.exec(href) || /list=([\w-]+)/.exec(href) || /channel\/([\w-]+)/.exec(href);
    if (!m) return { error: 'bad' };
    const id = /list=/.test(href) && !/^VL/.test(m[1]) ? 'VL' + m[1] : m[1];
    nav({ browseEndpoint: { browseId: id } });
    await settle(() => location.href.includes(m[1]));
    const head = $('ytmusic-responsive-header-renderer, ytmusic-detail-header-renderer, ytmusic-immersive-header-renderer, ytmusic-visual-header-renderer');
    const root = pageRoot();
    const tracks = $$('ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer, ytmusic-shelf-renderer ytmusic-responsive-list-item-renderer', root).map(row).filter((x) => x.videoId);
    const img = head && head.querySelector('img');
    return {
      title: text(head && head.querySelector('h1, .title')), subtitle: text(head && head.querySelector('.subtitle, .strapline, .description')),
      art: img && img.src && !img.src.startsWith('data:') ? big(img.src) : (tracks[0] && tracks[0].art) || '',
      listId: /list=([\w-]+)/.test(href) ? /list=([\w-]+)/.exec(href)[1] : (/^VL/.test(id) ? id.slice(2) : null),
      tracks, sections: tracks.length ? [] : sections(root),
    };
  }
  async function likes() {
    nav({ browseEndpoint: { browseId: 'VLLM' } });
    const ok = await settle(() => /VLLM|list=LM/.test(location.href), 12000);
    if (!ok && $('a.sign-in-link, ytmusic-nav-bar a[href*="ServiceLogin"]')) return { login: false, tracks: [] };
    let n = -1, stable = 0;
    for (let i = 0; i < 80 && stable < 4; i++) {   // scrolling loads the rest
      window.scrollTo(0, document.documentElement.scrollHeight);
      await wait(600);
      const c = $$('ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer').length;
      if (c === n) stable++; else stable = 0;
      n = c;
    }
    window.scrollTo(0, 0);
    return { login: true, tracks: $$('ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer').map(row).filter((x) => x.videoId) };
  }
  function account() {
    const signedIn = !$('ytmusic-nav-bar a.sign-in-link, ytmusic-nav-bar a[href*="ServiceLogin"]') && !!$('ytmusic-nav-bar ytmusic-settings-button img');
    const img = $('ytmusic-nav-bar ytmusic-settings-button img');
    return { signedIn, avatar: img ? img.src : '' };
  }

  // ── playback ──
  const video = () => $('video');
  const bar = () => $('ytmusic-player-bar');
  const click = (sel) => { const b = bar() && bar().querySelector(sel); if (b) (b.querySelector('button') || b).click(); return !!b; };
  let curId = '', expectEnd = false, endSent = '';
  function play(videoId, listId) {
    curId = videoId; endSent = '';
    nav({ watchEndpoint: listId ? { videoId, playlistId: listId } : { videoId } });
  }
  function control(c) {
    const v = video();
    if (c.op === 'toggle') { if (v && v.paused) v.play(); else if (v) v.pause(); }
    else if (c.op === 'play') v && v.play();
    else if (c.op === 'pause') v && v.pause();
    else if (c.op === 'seek' && v) v.currentTime = Math.max(0, +c.time || 0);
    else if (c.op === 'volume' && v) { v.volume = Math.min(1, Math.max(0, +c.value)); }
    else if (c.op === 'next') click('.next-button');
    else if (c.op === 'prev') click('.previous-button');
    else if (c.op === 'like' || c.op === 'dislike') {
      const lbl = c.op === 'like' ? ['Нравится', 'Like'] : ['Не нравится', 'Dislike'];
      const b = $$('ytmusic-player-bar ytmusic-like-button-renderer button').find((x) => lbl.includes(x.getAttribute('aria-label')));
      if (b) b.click();
    }
    else if (c.op === 'expectEnd') expectEnd = !!c.value;   // the app has its own next track: stop at the end instead of YouTube's autoplay
  }
  function pressed(lbl) { const b = $$('ytmusic-player-bar ytmusic-like-button-renderer button').find((x) => lbl.includes(x.getAttribute('aria-label'))); return !!b && b.getAttribute('aria-pressed') === 'true'; }
  function queue() {
    return $$('ytmusic-player-page ytmusic-player-queue ytmusic-player-queue-item').slice(0, 60).map((q) => ({
      title: text(q.querySelector('.song-title')), artist: text(q.querySelector('.byline')), durText: text(q.querySelector('.duration')),
      selected: q.hasAttribute('selected'),
    }));
  }
  let lastState = '';
  setInterval(() => {
    const v = video(); if (!v) return;
    let id = ''; try { const p = $('#movie_player'); id = (p && p.getVideoData && p.getVideoData().video_id) || ''; } catch (e) {}
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    const b = bar();
    const art = md && md.artwork && md.artwork.length ? md.artwork[md.artwork.length - 1].src : (b && b.querySelector('img.image') ? b.querySelector('img.image').src : '');
    const st = {
      t: 'state', videoId: id, playing: !v.paused, time: v.currentTime, dur: isFinite(v.duration) ? v.duration : 0, volume: v.volume,
      title: md ? md.title : text(b && b.querySelector('.title')), artist: md ? md.artist : '', album: md ? md.album : '', art: big(art),
      liked: pressed(['Нравится', 'Like']), disliked: pressed(['Не нравится', 'Dislike']), ad: !!$('#movie_player.ad-showing'),
    };
    // stop at the end when the app plays the next track itself
    if (expectEnd && st.dur && st.dur - st.time < 0.35 && st.time > 1 && endSent !== id) { endSent = id; v.pause(); send({ t: 'ended', videoId: id }); }
    const key = JSON.stringify({ ...st, time: Math.round(st.time * 4) });
    if (key !== lastState) { lastState = key; send(st); }
  }, 250);

  // small comforts: tracks instead of music videos, no "are you still there", no Premium pop-ups, skip ads that slip through
  setInterval(() => {
    const t = $('ytmusic-av-toggle');
    if (window.__ypAudioOnly !== false && t && t.getAttribute('is-video-playback-mode-selected') === 'true') { const s = t.querySelector('button.song-button'); if (s && s.getAttribute('aria-pressed') !== 'true') s.click(); }
    const there = $('ytmusic-you-there-renderer button'); if (there) there.click();
    for (const d of $$('tp-yt-paper-dialog, ytmusic-mealbar-promo-renderer')) if (/Premium|без рекламы/i.test(d.textContent || '')) d.remove();
    const mp = $('#movie_player'), v = video();
    if (mp && v && mp.classList.contains('ad-showing')) { v.muted = true; if (isFinite(v.duration)) v.currentTime = v.duration; const sk = $('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button', mp); if (sk) sk.click(); }
    else if (v && v.muted && mp && !mp.classList.contains('ad-showing') && window.__ypMutedByAd) { v.muted = false; }
    if (mp && v) window.__ypMutedByAd = mp.classList.contains('ad-showing');
  }, 700);

  // ── commands from the app ──
  window.__ypEng = async function (cmd) {
    const reply = (data) => send({ t: 'eng', id: cmd.id, data });
    try {
      switch (cmd.cmd) {
        case 'home': reply(await job(home)); break;
        case 'search': reply(await job(() => search(cmd.q))); break;
        case 'browse': reply(await job(() => browse(cmd.href))); break;
        case 'likes': reply(await job(likes)); break;
        case 'account': reply(account()); break;
        case 'queue': reply({ items: queue() }); break;
        case 'play': play(cmd.videoId, cmd.listId); reply({ ok: true }); break;
        case 'control': control(cmd); reply({ ok: true }); break;
        case 'audioOnly': window.__ypAudioOnly = !!cmd.value; reply({ ok: true }); break;
        default: reply({ error: 'unknown' });
      }
    } catch (e) { reply({ error: String(e && e.message || e) }); }
  };
  const ready = () => send({ t: 'engine-ready', account: account() });
  if (document.readyState === 'complete') setTimeout(ready, 1500); else addEventListener('load', () => setTimeout(ready, 1500));
})();
