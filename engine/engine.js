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
      artistHref: artistLink(n),
    };
  }
  function artistLink(n) {
    const a = n && n.querySelector('.secondary-flexible-columns a[href*="channel/"], .secondary-flexible-columns a[href*="browse/UC"], .subtitle a[href*="channel/"], .subtitle a[href*="browse/UC"], .byline a[href*="channel/"], .byline a[href*="browse/UC"]');
    return a ? a.getAttribute('href') : null;
  }
  function card(n) {
    const a = n.querySelector('a.image-wrapper, a[href]');
    const href = a ? a.getAttribute('href') || '' : '';
    const img = n.querySelector('img');
    const v = /watch\?v=/.test(href) ? new URL(href, location.origin).searchParams.get('v') : null;
    return {
      src: 'yt', kind: v ? 'song' : /channel\//.test(href) ? 'artist' : 'playlist', videoId: v, browse: v ? null : href,
      artistHref: artistLink(n), title: text(n.querySelector('.title')), artist: text(n.querySelector('.subtitle, .details .subtitle')).replace(/^\s*(композиция|песня|трек|song|track|видео|video|клип|сингл|single|ep|альбом|album|плейлист|playlist)\s*[•·]\s*/i, ''),
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
      await wait(140);
      if (!match()) continue;
      const n = $$('ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer', pageRoot()).length;
      if (n > 0 && n === last) { if (++stable >= 2) return true; } else stable = 0;
      last = n;
    }
    return false;
  }
  const pageRoot = () => $('ytmusic-browse-response:not([hidden]), ytmusic-search-page:not([hidden])') || document;

  // jobs that need this window to open a page run one at a time
  const qHigh = [], qLow = []; let busy = false;
  const job = (fn, low) => new Promise((res) => { (low ? qLow : qHigh).push({ fn, res }); pump(); });
  async function pump() {
    if (busy) return;
    const it = qHigh.shift() || qLow.shift(); if (!it) return;
    busy = true;
    try { it.res(await it.fn()); } catch (e) { it.res({ error: String(e && e.message || e) }); }
    busy = false; pump();
  }
  const urgent = () => qHigh.length > 0;

  async function home() {
    nav({ browseEndpoint: { browseId: 'FEmusic_home' } });
    await settle(() => location.pathname === '/');
    return { sections: sections(pageRoot()) };
  }
  const pageSig = () => $$('ytmusic-responsive-list-item-renderer a[href*="watch?v="], ytmusic-two-row-item-renderer a[href]', pageRoot()).slice(0, 6).map((a) => a.getAttribute('href')).join('|');
  let lastSearch = '', lastBrowse = '';
  async function search(q) {
    const before = pageSig(), same = q === lastSearch && location.pathname === '/search';
    nav({ searchEndpoint: { query: q } });
    await settle(() => location.pathname === '/search' && new URLSearchParams(location.search).get('q') === q && (same || pageSig() !== before));
    lastSearch = q;
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
    const before = pageSig(), same = id === lastBrowse;
    nav({ browseEndpoint: { browseId: id } });
    await settle(() => location.href.includes(m[1]) && (same || pageSig() !== before));
    lastBrowse = id;
    const head = $('ytmusic-responsive-header-renderer, ytmusic-detail-header-renderer, ytmusic-immersive-header-renderer, ytmusic-visual-header-renderer');
    const root = pageRoot();
    const tracks = $$('ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer, ytmusic-shelf-renderer ytmusic-responsive-list-item-renderer', root).map(row).filter((x) => x.videoId);
    const img = head && head.querySelector('img');
    const isArtist = /channel\/|browse\/UC/.test(href) || !!$('ytmusic-immersive-header-renderer, ytmusic-visual-header-renderer');
    if (isArtist) {
      const sb = subBtn();
      return {
        artist: true, title: text(head && head.querySelector('h1, .title')), subtitle: text(head && head.querySelector('.subscription-count, .subtitle, .strapline')),
        art: img && img.src && !img.src.startsWith('data:') ? big(img.src) : '', subscribed: sb ? isSub(sb) : false, canSubscribe: !!sb,
        tracks: tracks.slice(0, 20), sections: sections(root).filter((x) => x.layout === 'cards'),
      };
    }
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
    for (let i = 0; i < 60 && stable < 3 && !urgent(); i++) {   // scrolling loads the rest (stops at once when you search or open a page)
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
      artistHref: artistLink(b),
      title: md ? md.title : text(b && b.querySelector('.title')), artist: md ? md.artist : '', album: md ? md.album : '', art: big(art),
      liked: pressed(['Нравится', 'Like']), disliked: pressed(['Не нравится', 'Dislike']), ad: !!$('#movie_player.ad-showing'),
    };
    // stop at the end when the app plays the next track itself
    if (expectEnd && st.dur && st.dur - st.time < 0.6 && st.time > 1 && endSent !== id) { endSent = id; v.pause(); send({ t: 'ended', videoId: id }); }
    // exact end of a track: the video's own events (the 250 ms loop can miss the last moment)
    if (!v.__ypEnd) {
      v.__ypEnd = true;
      const atEnd = () => { const vid2 = nowId(); if (!expectEnd || !isFinite(v.duration) || v.currentTime < 1 || endSent === vid2) return; if (v.duration - v.currentTime < 0.6 || v.ended) { endSent = vid2; v.pause(); send({ t: 'ended', videoId: vid2 }); } };
      v.addEventListener('timeupdate', atEnd); v.addEventListener('ended', atEnd);
    }
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

  // ── playlists: YouTube Music's own menus, opened inside this hidden window ──
  const vis = (el) => !!el && el.offsetParent !== null;
  async function waitFor(fn, ms = 6000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = fn(); if (r) return r; await wait(150); } return null; }
  const esc = () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); const bd = $('tp-yt-iron-overlay-backdrop.opened'); if (bd) bd.click(); };
  const nowId = () => { try { const p = $('#movie_player'); return (p && p.getVideoData && p.getVideoData().video_id) || ''; } catch (e) { return ''; } };
  const signedIn = () => account().signedIn;
  async function playlists() {
    if (!signedIn()) return { login: false, items: [] };
    nav({ browseEndpoint: { browseId: 'FEmusic_liked_playlists' } });
    await settle(() => /FEmusic_liked_playlists|library\/playlists/.test(location.href), 9000);
    const items = [], seen = new Set();
    for (const s of sections(pageRoot())) for (const it of s.items) {
      const m = it.browse && (/list=([\w-]+)/.exec(it.browse) || /browse\/VL([\w-]+)/.exec(it.browse));
      if (!m || seen.has(m[1]) || m[1] === 'LM' || m[1] === 'SE') continue;
      seen.add(m[1]); items.push({ id: m[1], title: it.title, sub: it.artist, art: it.art, browse: it.browse });
    }
    return { login: true, items };
  }
  async function openMenu(videoId, title, artist) {
    let btn = null;
    if (nowId() === videoId) btn = $('ytmusic-player-bar ytmusic-menu-renderer #button-shape button, ytmusic-player-bar ytmusic-menu-renderer button');
    if (!btn) {
      nav({ searchEndpoint: { query: (title + ' ' + (artist || '')).trim() } });
      await settle(() => location.pathname === '/search', 8000);
      const row = $$('ytmusic-responsive-list-item-renderer', pageRoot()).find((r) => r.querySelector('a[href*="v=' + videoId + '"]'));
      if (!row) return false;
      row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      btn = row.querySelector('ytmusic-menu-renderer #button-shape button, ytmusic-menu-renderer button');
    }
    if (!btn) return false;
    btn.click();
    return !!(await waitFor(() => $$('ytmusic-menu-popup-renderer').find(vis), 4000));
  }
  async function saveDialog(videoId, title, artist) {
    if (!(await openMenu(videoId, title, artist))) return null;
    const pop = $$('ytmusic-menu-popup-renderer').find(vis);
    const item = $$('ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer', pop).find((i) => /плейлист|playlist/i.test(text(i)) && !/удал|remove/i.test(text(i)));
    if (!item) { esc(); return null; }
    (item.querySelector('a, tp-yt-paper-item') || item).click();
    return waitFor(() => $$('ytmusic-add-to-playlist-renderer').find(vis), 8000);
  }
  async function plAdd(c) {
    if (!signedIn()) return { ok: false, login: false };
    const d = await saveDialog(c.videoId, c.title, c.artist);
    if (!d) return { ok: false };
    const want = (c.playlist || '').trim().toLowerCase();
    const opt = await waitFor(() => $$('ytmusic-playlist-add-to-option-renderer', d).find((o) => text(o.querySelector('#title, .title, yt-formatted-string')).toLowerCase() === want), 5000);
    if (!opt) { esc(); return { ok: false, error: 'not-found' }; }
    (opt.querySelector('button, tp-yt-paper-item, #title') || opt).click();
    await wait(900); esc();
    return { ok: true };
  }
  async function plCreate(c) {
    if (!signedIn()) return { ok: false, login: false };
    if (c.videoId) {
      const d = await saveDialog(c.videoId, c.title, c.artist);
      if (!d) return { ok: false };
      const nb = $$('button, yt-button-renderer', d).find((b) => /новый плейлист|new playlist|создать плейлист/i.test(text(b)));
      if (!nb) { esc(); return { ok: false }; }
      ((nb.querySelector && nb.querySelector('button')) || nb).click();
    } else {
      nav({ browseEndpoint: { browseId: 'FEmusic_liked_playlists' } });
      await settle(() => /FEmusic_liked_playlists|library\/playlists/.test(location.href), 9000);
      const nb = $$('button, ytmusic-two-row-item-renderer, a', pageRoot()).find((b) => /^(новый плейлист|new playlist)$/i.test(text(b)));
      if (!nb) return { ok: false };
      nb.click();
    }
    const form = await waitFor(() => $$('ytmusic-playlist-form').find(vis), 6000);
    if (!form) { esc(); return { ok: false }; }
    const input = form.querySelector('input, textarea');
    if (!input) { esc(); return { ok: false }; }
    input.focus(); input.value = c.name; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(300);
    const create = $$('button', form).find((b) => /создать|create|сохранить|save/i.test(text(b)) && !b.disabled);
    if (!create) { esc(); return { ok: false }; }
    create.click();
    await wait(1500); esc();
    return { ok: true };
  }
  // lyrics from YouTube Music itself (tab "Текст" of the playing track)
  let lastLyr = { id: '', text: '' };
  async function lyrics(c) {
    if (c.videoId && nowId() !== c.videoId) return { text: '' };
    const page = $('ytmusic-player-page'); if (!page) return { text: '' };
    const tabs = $$('tp-yt-paper-tab', page);
    const tab = tabs.find((t) => /текст|lyrics/i.test(text(t)));
    if (!tab || tab.hasAttribute('disabled') || tab.getAttribute('aria-disabled') === 'true') return { text: '' };
    tab.click();
    const shelf = await waitFor(() => { const d = $('ytmusic-player-page ytmusic-description-shelf-renderer'); return d && text(d.querySelector('.description, yt-formatted-string.description')) ? d : null; }, 6000);
    const desc = shelf ? shelf.querySelector('.description, yt-formatted-string.description') : null;
    let out = desc ? desc.innerText.trim() : '';
    // the tab can still show the previous song's lyrics for a moment
    if (out && lastLyr.text === out && lastLyr.id !== c.videoId) { await wait(2500); const d2 = $('ytmusic-player-page ytmusic-description-shelf-renderer .description'); out = d2 ? d2.innerText.trim() : ''; if (out === lastLyr.text) out = ''; }
    if (out) lastLyr = { id: c.videoId, text: out };
    const src = shelf ? text(shelf.querySelector('.footer, .non-expandable-description')) : '';
    if (tabs[0]) tabs[0].click();
    return { text: out, source: src };
  }

  // ── the music video of the playing track (for the Now Playing background) ──
  function clip(c) {
    const id = nowId();
    if (!id || (c.videoId && c.videoId !== id)) return { clip: null };
    const dataOf = (q) => q.data || (q.__data && q.__data.data) || {};
    const ids = (d) => { const out = [d.videoId]; try { out.push(d.primaryRenderer.playlistPanelVideoRenderer.videoId, d.counterpart[0].counterpartRenderer.playlistPanelVideoRenderer.videoId); } catch (e) {} return out; };
    const item = $$('ytmusic-player-queue-item').find((q) => ids(dataOf(q)).indexOf(id) >= 0);
    let d = item ? (item.data || (item.__data && item.__data.data)) : null;
    const type = (x) => { try { return x.navigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig.musicVideoType; } catch (e) { return ''; } };
    if (d && d.primaryRenderer) {
      const p = d.primaryRenderer.playlistPanelVideoRenderer || {}; const cp = d.counterpart && d.counterpart[0] && d.counterpart[0].counterpartRenderer && d.counterpart[0].counterpartRenderer.playlistPanelVideoRenderer;
      if (type(p) === 'MUSIC_VIDEO_TYPE_OMV' || type(p) === 'MUSIC_VIDEO_TYPE_UGC') return { clip: p.videoId || id };
      if (cp && (type(cp) === 'MUSIC_VIDEO_TYPE_OMV' || type(cp) === 'MUSIC_VIDEO_TYPE_UGC')) return { clip: cp.videoId, offset: 0 };
      return { clip: null };
    }
    if (d && (type(d) === 'MUSIC_VIDEO_TYPE_OMV' || type(d) === 'MUSIC_VIDEO_TYPE_UGC')) return { clip: d.videoId || id };
    return { clip: null };
  }

  // ── credits of the playing track (YouTube Music's own "Credits" dialog, when it has one) ──
  async function credits(c) {
    if (c.videoId && nowId() !== c.videoId) return { items: [] };
    const btn = $('ytmusic-player-bar ytmusic-menu-renderer #button-shape button, ytmusic-player-bar ytmusic-menu-renderer button');
    if (!btn) return { items: [] };
    btn.click();
    const pop = await waitFor(() => $$('ytmusic-menu-popup-renderer').find(vis), 3000);
    if (!pop) return { items: [] };
    const item = $$('ytmusic-menu-navigation-item-renderer, ytmusic-menu-service-item-renderer', pop).find((i) => /авторы|сведения|credits/i.test(text(i)));
    if (!item) { esc(); return { items: [] }; }
    (item.querySelector('a, tp-yt-paper-item') || item).click();
    const dlg = await waitFor(() => $$('ytmusic-dismissable-dialog-renderer, tp-yt-paper-dialog').find((d) => vis(d) && text(d).length > 10), 5000);
    const out = [];
    if (dlg) {
      const secs = $$('ytmusic-dismissable-dialog-description-section-renderer, .section, yt-formatted-string.description', dlg);
      const lines = (dlg.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean);
      // pairs: a role title followed by names
      for (let i = 1; i + 1 < lines.length && out.length < 12; i += 2) { if (lines[i].length < 40) out.push({ role: lines[i], names: lines[i + 1] }); }
      esc();
      if (!secs.length && !out.length) return { items: [] };
    }
    return { items: out };
  }

  // ── artists: subscribe and the list of subscriptions ──
  const subBtn = () => $('ytmusic-browse-response:not([hidden]) ytmusic-subscribe-button-renderer, ytmusic-subscribe-button-renderer');
  const isSub = (b) => b.hasAttribute('subscribed') || b.getAttribute('is-subscribed') === 'true' || /вы подписаны|subscribed/i.test(text(b)) && !/^подписаться|^subscribe$/i.test(text(b));
  async function subscribe(c) {
    if (!signedIn()) return { ok: false, login: false };
    const m = /browse\/([\w-]+)/.exec(c.href) || /channel\/([\w-]+)/.exec(c.href);
    if (!m) return { ok: false };
    nav({ browseEndpoint: { browseId: m[1] } });
    await settle(() => location.href.includes(m[1]), 8000);
    const b = await waitFor(subBtn, 5000);
    if (!b) return { ok: false };
    if (isSub(b) !== !!c.on) {
      (b.querySelector('button') || b).click();
      await wait(700);
      const confirm = $$('yt-confirm-dialog-renderer button, tp-yt-paper-dialog button').find((x) => /отказаться|unsubscribe|отписаться/i.test(text(x)));
      if (confirm) { confirm.click(); await wait(600); }
    }
    const b2 = subBtn();
    return { ok: true, subscribed: b2 ? isSub(b2) : !!c.on };
  }
  async function artists() {
    if (!signedIn()) return { login: false, items: [] };
    nav({ browseEndpoint: { browseId: 'FEmusic_library_corpus_artists' } });
    await settle(() => /FEmusic_library_corpus_artists|library\/artists/.test(location.href), 8000);
    const out = [], seen = new Set();
    for (const el of $$('ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer', pageRoot())) {
      const a = el.querySelector('a[href*="channel/"], a[href*="browse/UC"]'); if (!a) continue;
      const href = a.getAttribute('href'); if (seen.has(href)) continue; seen.add(href);
      const img = el.querySelector('img');
      out.push({ name: text(el.querySelector('.title')), href, art: img && img.src && !img.src.startsWith('data:') ? big(img.src) : '' });
    }
    return { login: true, items: out };
  }

  // ── commands from the app ──
  window.__ypEng = async function (cmd) {
    const reply = (data) => send({ t: 'eng', id: cmd.id, data });
    try {
      switch (cmd.cmd) {
        case 'home': reply(await job(home)); break;
        case 'search': reply(await job(() => search(cmd.q), !!cmd.low)); break;
        case 'browse': reply(await job(() => browse(cmd.href))); break;
        case 'likes': reply(await job(likes, true)); break;
        case 'account': reply(account()); break;
        case 'queue': reply({ items: queue() }); break;
        case 'play': play(cmd.videoId, cmd.listId); reply({ ok: true }); break;
        case 'control': control(cmd); reply({ ok: true }); break;
        case 'playlists': reply(await job(playlists, true)); break;
        case 'plAdd': reply(await job(() => plAdd(cmd))); break;
        case 'plCreate': reply(await job(() => plCreate(cmd))); break;
        case 'lyrics': reply(await lyrics(cmd)); break;
        case 'subscribe': reply(await job(() => subscribe(cmd))); break;
        case 'artists': reply(await job(artists, true)); break;
        case 'clip': reply(clip(cmd)); break;
        case 'credits': reply(await job(() => credits(cmd), true)); break;
        case 'audioOnly': window.__ypAudioOnly = !!cmd.value; reply({ ok: true }); break;
        default: reply({ error: 'unknown' });
      }
    } catch (e) { reply({ error: String(e && e.message || e) }); }
  };
  const ready = () => send({ t: 'engine-ready', account: account() });
  if (document.readyState === 'complete') setTimeout(ready, 1500); else addEventListener('load', () => setTimeout(ready, 1500));
})();
