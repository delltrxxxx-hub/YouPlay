'use strict';
/* YouPlay 2 — the app. Own interface (this page lives inside the app), one shared queue for
   YouTube Music (played by the hidden engine window), SoundCloud (official widget) and files on the device. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
  const rid = () => Math.random().toString(36).slice(2, 10);
  const ANDROID = !!window.YouPlayNative;
  const IC = window.ic;

  // ───────── host bridge (Windows: WebView2, Android: JavaScript interface) ─────────
  const host = {
    send(o) {
      const s = JSON.stringify(o);
      if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage(s);
      else if (window.YouPlayNative) window.YouPlayNative.postHost(s);
      else console.log('[host]', s);
    },
  };
  const waiting = new Map();
  function ask(o, timeout = 40000) {
    const id = rid();
    return new Promise((res) => { waiting.set(id, res); host.send({ ...o, id }); setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); res({ error: 'timeout' }); } }, timeout); });
  }
  const eng = (cmd, extra) => ask({ t: 'eng', cmd, ...extra }).then((r) => (r && r.data) || r || {});
  function onHost(m) {
    if (!m || !m.t) return;
    if ((m.t === 'eng' || m.t === 'fetch' || m.t === 'local') && waiting.has(m.id)) { const r = waiting.get(m.id); waiting.delete(m.id); r(m); return; }
    if (m.t === 'scdata' && m.data && waiting.has(m.data.id)) { const r = waiting.get(m.data.id); waiting.delete(m.data.id); r(m.data); return; }
    if (m.t === 'state') return P.onYtState(m);
    if (m.t === 'ended') return P.onYtEnded(m);
    if (m.t === 'engine-ready') { S.account = m.account || S.account; engineReady = true; refreshAccounts(); if (route.name === 'home' && !homeData) render(); return; }
    if (m.t === 'login') { toast(m.ok ? (m.service === 'sc' ? 'SoundCloud подключён' : 'Вы вошли в аккаунт Google') : 'Вход отменён'); if (m.service === 'sc') { scStatus(); } else { eng('account').then((a) => { S.account = a; refreshAccounts(); }); homeData = null; likesCache.at = 0; } return; }
    if (m.t === 'update') return onUpdate(m);
    if (m.t === 'net') return setOnline(m.online);
    if (m.t === 'media-cmd') return P.cmd(m.op);
    if (m.t === 'back') { if (!back()) host.send({ t: 'back-unhandled' }); return; }
  }
  window.__ypRecv = onHost;
  if (window.chrome && window.chrome.webview) window.chrome.webview.addEventListener('message', (e) => { try { onHost(typeof e.data === 'string' ? JSON.parse(e.data) : e.data); } catch (_) {} });
  let engineReady = false;

  // ───────── settings (stored inside the app, kept across updates) ─────────
  const DEF = { playlists: [], theme: 'studio', accent: '#ff5a36', audioOnly: true, adblock: true, autoNP: true, volume: 1, offsets: {}, disliked: [], ytLikeDates: {}, recent: [] };
  const S = Object.assign({}, DEF, JSON.parse(localStorage.getItem('youplay') || '{}'), { account: null, sc: null });
  const save = () => { const { account, sc, ...keep } = S; localStorage.setItem('youplay', JSON.stringify(keep)); };
  function applyTheme() {
    document.documentElement.dataset.theme = S.theme;
    document.documentElement.style.setProperty('--accent', S.theme === 'holo' ? '#33b5e5' : S.theme === 'aero' ? '#3f9be0' : S.accent);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#120d0b';
    host.send({ t: 'window', op: 'caption', color: bg });
  }
  applyTheme();

  // ───────── toasts ─────────
  function toast(text, btn) {
    const t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = `<span>${esc(text)}</span>`;
    if (btn) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = btn.label; b.onclick = () => { btn.fn(); kill(); }; t.append(b); }
    $('#toasts').append(t);
    const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
    setTimeout(kill, btn ? 7000 : 2600);
  }

  // ───────── navigation ─────────
  const NAV = [
    { id: 'home', label: 'Главная', icon: 'home' },
    { id: 'search', label: 'Поиск', icon: 'search', mobileOnly: true },
    { id: 'lib', label: 'Библиотека', icon: 'library' },
    { id: 'settings', label: 'Настройки', icon: 'gear', mobileOnly: true },
  ];
  let route = { name: 'home' };
  const LIB = ['lib', 'likes', 'local', 'pl', 'scset'];
  const history = [];
  const viewCache = {};
  const CACHE = ['home', 'lib', 'likes', 'local'];
  const dirty = (...names) => { for (const n of names) delete viewCache[n]; };
  function stash() {
    if (!CACHE.includes(route.name) || !view.firstChild) return;
    const f = document.createDocumentFragment(); while (view.firstChild) f.append(view.firstChild);
    viewCache[route.name] = { f, top: view.scrollTop, at: Date.now() };
  }
  function go(name, params, push = true) {
    if (name === 'settings') { openSettings(); return; }
    if (name === 'search' && !(params && params.q)) { document.body.classList.add('searching'); $('#q').focus(); if (!lastSearch) { route = { name: 'search' }; render(); paintNav(); } else { route = { name: 'search', q: lastSearch }; render(); paintNav(); } return; }
    if (push && route.name !== name) history.push(route);
    stash();
    route = { name, ...(params || {}) };
    paintNav();
    const c = !params && viewCache[name];
    if (c && Date.now() - c.at < 10 * 60e3) { view.replaceChildren(c.f); view.scrollTop = c.top; delete viewCache[name]; return; }
    render(); view.scrollTop = 0;
  }
  function back() {
    if (!$('#modal').hidden) { closeModal(); return true; }
    if ($('#np').classList.contains('open')) { if ($('#np').classList.contains('sheet-on')) { setSheet(null); return true; } closeNP(); return true; }
    if (document.body.classList.contains('searching')) { document.body.classList.remove('searching'); $('#q').blur(); return true; }
    if (history.length) { stash(); route = history.pop(); paintNav(); const c = CACHE.includes(route.name) && viewCache[route.name]; if (c) { view.replaceChildren(c.f); view.scrollTop = c.top; delete viewCache[route.name]; } else render(); return true; }
    if (route.name !== 'home') { go('home', null, false); return true; }
    return false;
  }
  function paintNav() {
    const cur = LIB.includes(route.name) ? 'lib' : route.name;
    $('#nav').innerHTML = NAV.filter((n) => !n.mobileOnly).map((n) => `<button class="nav-i${cur === n.id ? ' on' : ''}" data-go="${n.id}"><span class="ic">${IC(n.icon)}</span>${n.label}</button>`).join('');
    $('#tabs').innerHTML = NAV.map((n) => `<button class="tab${(cur === n.id) ? ' on' : ''}" data-go="${n.id}"><span class="ic">${IC(n.icon)}</span>${n.label}</button>`).join('');
    $('#side-foot').innerHTML = `<button class="nav-i" data-go="settings"><span class="ic">${IC('gear')}</span>Настройки</button>`;
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go); return; }
  });
  $('#topbar .logo').onclick = () => go('home');

  // ───────── search ─────────
  let lastSearch = '';
  $('#search-form').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) { lastSearch = q; go('search', { q }); $('#q').blur(); } });

  // ───────── rendering helpers ─────────
  const view = $('#view');
  const srcBadge = (it) => it.src === 'sc' ? '<span class="badge sc">SoundCloud</span>' : it.src === 'local' ? '<span class="badge local">Файл</span>' : `<span class="badge yt">${it.kind === 'video' ? 'Клип' : 'YouTube'}</span>`;
  const key = (it) => it.src === 'sc' ? 'sc:' + it.url : it.src === 'local' ? 'local:' + it.id : 'yt:' + it.videoId;
  const isDisliked = (it) => S.disliked.some((d) => d.key === key(it));
  function rowHTML(it, i, opts = {}) {
    const on = P.cur && key(P.cur) === key(it);
    const liked = it.src === 'sc' ? scLiked(it.url) : false;
    return `<div class="row${on ? ' on' : ''}" data-i="${i}">
      <span class="r-n">${on ? '<i class="eq"><b></b><b></b><b></b></i>' : (opts.n === false ? '' : i + 1)}</span>
      <span class="r-cv">${it.art ? `<img loading="lazy" src="${esc(it.art)}" alt="">` : ''}</span>
      <span class="r-m"><span class="r-t">${esc(it.title)}</span><span class="r-s">${srcBadge(it)}<span>${esc(it.artist || '')}</span></span></span>
      <span class="r-date">${opts.date ? esc(opts.date(it)) : ''}</span>
      <span class="r-acts">${it.src === 'sc' ? `<button class="ib${liked ? ' on' : ''}" data-act="sclike" title="Лайк в SoundCloud">${IC(liked ? 'heart' : 'heartLine', 18)}</button>` : ''}<button class="ib" data-act="menu" title="Ещё: в очередь, в плейлист…">${IC('dots', 18)}</button></span>
      <span class="r-d">${it.duration ? fmt(it.duration) : esc(it.durText || '')}</span></div>`;
  }
  function bindRows(root, list, name, ctx) {
    root.onclick = async (e) => {
      const row = e.target.closest('.row'); if (!row) return;
      const it = list[+row.dataset.i];
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'menu') { trackMenu(it, ctx || {}); return; }
      if (act && act.dataset.act === 'queue') { P.addNext(it); toast('Будет играть следующим: ' + it.title); return; }
      if (act && act.dataset.act === 'sclike') { likeSc(it, act); return; }
      P.playList(list, +row.dataset.i, name);
    };
  }
  function cardHTML(it, i) {
    return `<div class="card${it.round ? ' round' : ''}" data-i="${i}"><div class="cv">${it.art ? `<img loading="lazy" src="${esc(it.art)}" alt="">` : ''}<span class="pb">${IC('play', 20)}</span></div><b>${esc(it.title)}</b><small>${esc(it.artist || '')}</small></div>`;
  }
  const loading = (n = 6) => Array.from({ length: n }, () => '<div class="skel"></div>').join('');

  // ───────── views ─────────
  let homeData = (() => { try { const h = JSON.parse(localStorage.getItem('youplay-home') || 'null'); return h && h.sections && h.sections.length ? h : null; } catch (_) { return null; } })(), homeFresh = false;
  async function render() {
    document.body.classList.toggle('searching', route.name === 'search' && document.body.classList.contains('searching'));
    const r = route.name;
    if (r === 'home') return renderHome();
    if (r === 'search') return renderSearch();
    if (r === 'likes') return renderLikes();
    if (r === 'local') return renderLocal();
    if (r === 'browse') return renderBrowse();
    if (r === 'lib') return renderLib();
    if (r === 'pl') return renderPl();
    if (r === 'scset') return renderScSet();
  }
  async function renderHome() {
    const hello = new Date().getHours();
    const greet = hello < 6 ? 'Доброй ночи' : hello < 12 ? 'Доброе утро' : hello < 18 ? 'Добрый день' : 'Добрый вечер';
    view.innerHTML = `<div class="page-h"><small>${greet}</small><h1>Главная</h1></div><div id="home-body">${online ? loading(8) : ''}</div>`;
    if (!online) { $('#home-body').innerHTML = `<div class="banner green"><span class="ic">${IC('music')}</span><div><b>Без интернета работает «Моя музыка»</b><small>Музыка с этого устройства играет без сети</small></div><button class="btn" data-go="local">Открыть</button></div>`; return; }
    if (!homeData || !homeFresh) {
      const refresh = eng('home').then((d) => { if (d.sections && d.sections.length) { homeData = d; homeFresh = true; try { localStorage.setItem('youplay-home', JSON.stringify(d)); } catch (_) {} } });
      if (!homeData) { await refresh; if (route.name !== 'home') return; } else refresh.then(() => { if (route.name === 'home' && !$('#modal').querySelector('.sheet') && view.scrollTop < 40) renderHome(); });
    }
    const body = $('#home-body'); if (!body) return;
    if (!homeData || !homeData.sections.length) { body.innerHTML = `<div class="note">YouTube Music загружается…</div>`; setTimeout(() => { if (route.name === 'home' && !homeData) render(); }, 3000); return; }
    const recentHTML = S.recent.length ? `<section class="sec"><div class="sec-h"><h2>Недавно играло</h2></div><div class="cards" id="sec-recent">${S.recent.slice(0, 16).map(cardHTML).join('')}</div></section>` : '';
    body.innerHTML = recentHTML + homeData.sections.map((s, si) => `<section class="sec"><div class="sec-h"><h2>${esc(s.title || 'Для вас')}</h2></div>${s.layout === 'cards' ? `<div class="cards" data-s="${si}">${s.items.map(cardHTML).join('')}</div>` : `<div class="rows non" data-s="${si}">${s.items.slice(0, 8).map((it, i) => rowHTML(it, i, { n: false })).join('')}</div>`}</section>`).join('');
    if (S.recent.length) bindCards($('#sec-recent'), S.recent, 'Недавно играло');
    for (const el of $$('[data-s]', body)) { const s = homeData.sections[+el.dataset.s]; if (s.layout === 'cards') bindCards(el, s.items, s.title); else bindRows(el, s.items, s.title); }
  }
  function bindCards(el, items, name) {
    el.onclick = (e) => {
      const c = e.target.closest('.card'); if (!c) return;
      const it = items[+c.dataset.i];
      if (it.videoId || it.src === 'sc' || it.src === 'local') { const songs = items.filter((x) => x.videoId || x.src !== 'yt'); P.playList(songs, songs.indexOf(it), name); }
      else if (it.browse) go('browse', { href: it.browse, title: it.title, art: it.art });
    };
  }
  let searchSeq = 0;
  async function renderSearch() {
    const q = route.q || '';
    if (!q) { view.innerHTML = `<div class="page-h"><small>Поиск</small><h1>Что послушаем?</h1><p>YouTube Music и SoundCloud — в одном списке</p></div>`; return; }
    const my = ++searchSeq;
    view.innerHTML = `<div class="page-h"><small>Поиск</small><h1>${esc(q)}</h1></div><div class="tabs-row" id="s-tabs"></div><div id="s-more"></div><div class="rows" id="s-list">${loading(8)}</div>`;
    let yt = null, sc = null, filter = 'all';
    const paint = () => {
      if (my !== searchSeq) return;
      const a = filter === 'sc' ? [] : (yt ? yt.tracks : []), b = filter === 'yt' ? [] : (sc || []);
      const list = []; for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) list.push(a[i]); if (b[i]) list.push(b[i]); }
      const clean = list.filter((x) => !isDisliked(x));
      $('#s-tabs').innerHTML = [['all', 'Всё', (yt ? yt.tracks.length : 0) + (sc ? sc.length : 0)], ['yt', 'YouTube Music', yt ? yt.tracks.length : '…'], ['sc', 'SoundCloud', sc ? sc.length : '…']].map(([id, l, n]) => `<button class="chip${filter === id ? ' on' : ''}" data-f="${id}">${l} <span style="opacity:.6">${n}</span></button>`).join('');
      $$('#s-tabs .chip').forEach((b) => b.onclick = () => { filter = b.dataset.f; paint(); });
      const more = yt && yt.more && filter !== 'sc' ? yt.more.slice(0, 12) : [];
      $('#s-more').innerHTML = more.length ? `<section class="sec" style="margin-top:6px"><div class="cards" id="s-cards">${more.map(cardHTML).join('')}</div></section>` : '';
      if (more.length) bindCards($('#s-cards'), more, q);
      const box = $('#s-list');
      box.innerHTML = clean.length ? clean.map((it, i) => rowHTML(it, i)).join('') : (yt && sc ? '<div class="note">Ничего не нашлось</div>' : loading(6));
      bindRows(box, clean, 'Поиск: ' + q);
    };
    if (online) {
      eng('search', { q }).then((d) => { yt = d.tracks ? d : { tracks: [], more: [] }; paint(); });
      ask({ t: 'sc', op: 'search', arg: q }, 45000).then((d) => { sc = (d.items || []).map((t) => ({ ...t, src: 'sc' })); paint(); });
    } else { yt = { tracks: [], more: [] }; sc = []; }
    const local = (await localTracks()).filter((t) => (t.title + ' ' + t.artist + ' ' + t.album).toLowerCase().includes(q.toLowerCase()));
    if (local.length && my === searchSeq) { const el = document.createElement('section'); el.className = 'sec'; el.innerHTML = `<div class="sec-h"><h2>На этом устройстве</h2></div><div class="rows">${local.slice(0, 10).map((t, i) => rowHTML(t, i)).join('')}</div>`; view.append(el); bindRows($('.rows', el), local, 'Моя музыка'); }
    paint();
  }
  async function renderBrowse() {
    view.innerHTML = `<div class="hero"><div class="cv">${route.art ? `<img src="${esc(route.art)}">` : ''}</div><div class="hero-t"><div class="page-h" style="margin:0"><small>YouTube Music</small><h1>${esc(route.title || '')}</h1><p id="b-sub"></p></div><div class="hero-btns"><button class="btn" id="b-play">${IC('play', 18)}Слушать</button><button class="btn ghost" id="b-shuf">${IC('shuffle', 18)}Перемешать</button></div></div></div><div class="rows" id="b-list">${loading(8)}</div>`;
    const d = await eng('browse', { href: route.href });
    if (route.name !== 'browse') return;
    $('#b-sub').textContent = d.subtitle || (d.tracks ? d.tracks.length + ' треков' : '');
    if (d.art && !route.art) $('.hero .cv').innerHTML = `<img src="${esc(d.art)}">`;
    const list = (d.tracks || []).filter((x) => !isDisliked(x));
    if (list.length) {
      $('#b-list').innerHTML = list.map((it, i) => rowHTML(it, i)).join('');
      bindRows($('#b-list'), list, route.title);
    } else if (d.sections && d.sections.length) {
      $('#b-list').outerHTML = d.sections.map((s, si) => `<section class="sec"><div class="sec-h"><h2>${esc(s.title)}</h2></div><div class="${s.layout === 'cards' ? 'cards' : 'rows'}" data-bs="${si}">${s.layout === 'cards' ? s.items.map(cardHTML).join('') : s.items.map((it, i) => rowHTML(it, i)).join('')}</div></section>`).join('');
      for (const el of $$('[data-bs]')) { const s = d.sections[+el.dataset.bs]; if (s.layout === 'cards') bindCards(el, s.items, s.title); else bindRows(el, s.items, s.title); }
    } else $('#b-list').innerHTML = '<div class="note">Здесь пока пусто</div>';
    $('#b-play').onclick = () => list.length && P.playList(list, 0, route.title);
    $('#b-shuf').onclick = () => list.length && P.playList(shuffled(list), 0, route.title);
  }
  const shuffled = (a) => { const s = a.slice(); for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s; };

  // Любимое: YouTube Music likes + SoundCloud likes, newest first
  const likesCache = JSON.parse(localStorage.getItem('youplay-likes') || '{"yt":[],"sc":[],"at":0}');
  const scLiked = (url) => (likesCache.sc || []).some((x) => x.url === url);
  async function loadLikes(force) {
    if (!online) return;
    if (!force && Date.now() - likesCache.at < 10 * 60e3 && (likesCache.yt.length || likesCache.sc.length)) return;
    const [yt, sc] = await Promise.all([eng('likes'), ask({ t: 'sc', op: 'likes', arg: '' }, 60000)]);
    if (yt && yt.tracks) { likesCache.yt = yt.tracks; S.ytLogin = yt.login !== false; }
    if (sc) { if (sc.login === false) { likesCache.sc = []; S.sc = { login: false }; } else if (sc.items) { likesCache.sc = sc.items.map((t) => ({ ...t, src: 'sc' })); S.sc = { login: true, user: sc.user }; } }
    likesCache.at = Date.now();
    localStorage.setItem('youplay-likes', JSON.stringify(likesCache));
  }
  function mergedLikes() {
    const sc = likesCache.sc.map((t) => ({ ...t, t: Date.parse(t.likedAt) || 0, real: !!t.likedAt }));
    const yt = likesCache.yt.map((t) => ({ ...t, t: S.ytLikeDates[t.videoId] || 0, real: !!S.ytLikeDates[t.videoId] }));
    const ts = sc.map((x) => x.t).filter(Boolean);
    const top = Math.max(Date.now(), ...ts), bottom = ts.length ? Math.min(...ts) : Date.now() - 365 * 864e5, n = yt.length;
    yt.forEach((x, i) => { if (!x.real) x.t = top - (n > 1 ? i / (n - 1) : 0) * (top - bottom); });
    return [...yt, ...sc].sort((a, b) => b.t - a.t).filter((x) => !isDisliked(x));
  }
  const ago = (t) => { const d = (Date.now() - t) / 864e5; return d < 1 ? 'сегодня' : d < 2 ? 'вчера' : d < 30 ? Math.floor(d) + ' дн. назад' : d < 365 ? Math.floor(d / 30) + ' мес. назад' : new Date(t).toLocaleDateString('ru-RU', { year: 'numeric', month: 'short' }); };
  async function renderLikes(refresh) {
    const paint = (busy) => {
      if (route.name !== 'likes') return;
      const all = mergedLikes();
      view.innerHTML = `<div class="hero"><div class="cv likes">${IC('heart', 64)}</div><div class="hero-t"><div class="page-h" style="margin:0"><small>Плейлист</small><h1>Любимое</h1><p><span class="badge yt">YouTube Music</span> ${likesCache.yt.length} &nbsp; <span class="badge sc">SoundCloud</span> ${S.sc && S.sc.login === false ? 'не подключён' : likesCache.sc.length}</p></div>
        <div class="hero-btns"><button class="btn" id="l-play">${IC('play', 18)}Слушать</button><button class="btn ghost" id="l-shuf">${IC('shuffle', 18)}Перемешать</button><button class="btn ghost" id="l-ref" title="Обновить">${IC('update', 18)}</button></div></div></div>
        ${S.sc && S.sc.login === false ? `<div class="banner"><span class="ic" style="color:#ff8a3d">${IC('cloud')}</span><div><b>Подключите SoundCloud</b><small>Лайки SoundCloud и YouTube Music соберутся в один плейлист по датам</small></div><button class="btn" id="l-sc">Войти в SoundCloud</button></div>` : ''}
        ${S.account && !S.account.signedIn ? `<div class="banner"><span class="ic" style="color:#ff5a5a">${IC('yt')}</span><div><b>Войдите в YouTube Music</b><small>Чтобы здесь появились ваши лайки и сердечко сохраняло треки</small></div><button class="btn" id="l-yt">Войти</button></div>` : ''}
        <div class="rows" id="l-list">${all.length ? all.map((it, i) => rowHTML(it, i, { date: (x) => x.real ? ago(x.t) : '' })).join('') : busy ? loading(8) : '<div class="note">Пока пусто. Лайкайте треки сердечком — они появятся здесь.</div>'}</div>`;
      bindRows($('#l-list'), all, 'Любимое');
      $('#l-play').onclick = () => all.length && P.playList(all, 0, 'Любимое');
      $('#l-shuf').onclick = () => all.length && P.playList(shuffled(all), 0, 'Любимое · перемешано');
      $('#l-ref').onclick = () => renderLikes(true);
      if ($('#l-sc')) $('#l-sc').onclick = () => host.send({ t: 'login', service: 'sc' });
      if ($('#l-yt')) $('#l-yt').onclick = () => host.send({ t: 'login', service: 'google' });
    };
    paint(true);
    await loadLikes(refresh);
    paint(false);
  }
  // ───────── Библиотека: Любимое, Моя музыка, плейлисты YouPlay, YouTube Music и SoundCloud ─────────
  const pls = { yt: null, sc: null, at: 0, busy: null };
  function loadRemotePls(force) {
    if (!online) return Promise.resolve();
    if (pls.busy) return pls.busy;
    if (!force && pls.at && Date.now() - pls.at < 5 * 60e3) return Promise.resolve();
    pls.busy = Promise.all([eng('playlists'), ask({ t: 'sc', op: 'sets', arg: '' }, 45000)]).then(([y, c]) => {
      pls.yt = y && y.items ? y : { login: y && y.login, items: [] };
      pls.sc = c && c.items ? c : { login: c && c.login, items: [] };
      pls.at = Date.now();
    }).finally(() => { pls.busy = null; });
    return pls.busy;
  }
  const plArt = (p) => (p.items.find((x) => x.art) || {}).art || '';
  const slim = (x) => ({ src: x.src, kind: x.kind, videoId: x.videoId, url: x.url, id: x.id, title: x.title, artist: x.artist, art: x.art, duration: x.duration, durText: x.durText });
  let libFilter = 'all';
  async function renderLib(force) {
    const paint = (busy) => {
      if (route.name !== 'lib') return;
      const tiles = [];
      if (libFilter === 'all' || libFilter === 'yp') {
        tiles.push({ kind: 'likes', title: 'Любимое', sub: 'Лайки YouTube Music и SoundCloud', cls: 'likes', icon: 'heart' });
        tiles.push({ kind: 'local', title: 'Моя музыка', sub: 'Файлы · работает без интернета', cls: 'local', icon: ANDROID ? 'phone' : 'music' });
        for (const p of S.playlists) tiles.push({ kind: 'pl', id: p.id, title: p.name, sub: 'YouPlay · ' + p.items.length + ' тр.', art: plArt(p), icon: 'library' });
      }
      if ((libFilter === 'all' || libFilter === 'yt') && pls.yt) for (const p of pls.yt.items) tiles.push({ kind: 'yt', href: p.browse, title: p.title, sub: p.sub || 'YouTube Music', art: p.art, src: 'yt' });
      if ((libFilter === 'all' || libFilter === 'sc') && pls.sc) for (const p of pls.sc.items) tiles.push({ kind: 'sc', url: p.url, title: p.title, sub: p.count + ' тр.', art: p.art, src: 'sc' });
      const ytOut = pls.yt && pls.yt.login === false, scOut = pls.sc && pls.sc.login === false;
      view.innerHTML = `<div class="page-h"><small>Всё в одном месте</small><h1>Библиотека</h1></div>
        <div class="tabs-row" id="lib-f">${[['all', 'Всё'], ['yp', 'YouPlay'], ['yt', 'YouTube Music'], ['sc', 'SoundCloud']].map(([id, l]) => `<button class="chip${libFilter === id ? ' on' : ''}" data-f="${id}">${l}</button>`).join('')}<button class="chip ghost" id="lib-ref" title="Обновить">${IC('update', 16)}</button></div>
        <div class="grid" id="lib-grid"><div class="tile new" data-k="new"><div class="cv">${IC('plus', 40)}</div><b>Новый плейлист</b><small>YouPlay, YouTube Music или SoundCloud</small></div>
        ${tiles.map((t, i) => `<div class="tile" data-t="${i}"><div class="cv ${t.cls || ''}">${t.art ? `<img loading="lazy" src="${esc(t.art)}" alt="">` : IC(t.icon || 'library', 44)}${t.src ? `<span class="badge ${t.src}">${t.src === 'yt' ? 'YouTube' : 'SoundCloud'}</span>` : ''}</div><b>${esc(t.title)}</b><small>${esc(t.sub)}</small></div>`).join('')}
        ${busy ? '<div class="tile"><div class="cv skel"></div></div><div class="tile"><div class="cv skel"></div></div>' : ''}</div>
        ${(ytOut && libFilter !== 'sc' && libFilter !== 'yp') || (scOut && libFilter !== 'yt' && libFilter !== 'yp') ? `<div class="banner"><span class="ic">${IC('user')}</span><div><b>Подключите аккаунты</b><small>${[ytOut ? 'YouTube Music' : '', scOut ? 'SoundCloud' : ''].filter(Boolean).join(' и ')} — тогда здесь появятся ваши плейлисты оттуда</small></div><button class="btn" id="lib-acc">Открыть настройки</button></div>` : ''}`;
      $$('#lib-f [data-f]').forEach((b) => b.onclick = () => { libFilter = b.dataset.f; paint(!pls.at); });
      $('#lib-ref').onclick = () => renderLib(true);
      if ($('#lib-acc')) $('#lib-acc').onclick = () => openSettings();
      $('#lib-grid').onclick = (e) => {
        if (e.target.closest('[data-k=new]')) { createPlaylist(); return; }
        const el = e.target.closest('[data-t]'); if (!el) return; const t = tiles[+el.dataset.t];
        if (t.kind === 'likes') go('likes'); else if (t.kind === 'local') go('local'); else if (t.kind === 'pl') go('pl', { id: t.id });
        else if (t.kind === 'yt') go('browse', { href: t.href, title: t.title, art: t.art, from: 'yt' }); else if (t.kind === 'sc') go('scset', { url: t.url, title: t.title, art: t.art });
      };
    };
    paint(!pls.at || force);
    await loadRemotePls(force);
    paint(false);
  }
  function renderPl() {
    const p = S.playlists.find((x) => x.id === route.id); if (!p) { go('lib', null, false); return; }
    const list = p.items.filter((x) => !isDisliked(x));
    const n = { yt: 0, sc: 0, local: 0 }; for (const x of p.items) n[x.src] = (n[x.src] || 0) + 1;
    view.innerHTML = `<div class="hero"><div class="cv">${plArt(p) ? `<img src="${esc(plArt(p))}">` : IC('library', 60)}</div><div class="hero-t"><div class="page-h" style="margin:0"><small>Плейлист YouPlay</small><h1>${esc(p.name)}</h1><p>${p.items.length} тр. ${n.yt ? '· <span class="badge yt">YouTube</span> ' + n.yt : ''} ${n.sc ? '· <span class="badge sc">SoundCloud</span> ' + n.sc : ''} ${n.local ? '· <span class="badge local">Файлы</span> ' + n.local : ''}</p></div>
      <div class="hero-btns"><button class="btn" id="p-play">${IC('play', 18)}Слушать</button><button class="btn ghost" id="p-shuf">${IC('shuffle', 18)}Перемешать</button><button class="btn ghost" id="p-ren">Переименовать</button><button class="btn ghost" id="p-del">Удалить</button></div></div></div>
      <div class="rows" id="p-list">${list.length ? list.map((it, i) => rowHTML(it, i)).join('') : '<div class="note">Пока пусто. Нажмите ⋯ у любого трека → «Добавить в плейлист».</div>'}</div>`;
    bindRows($('#p-list'), list, p.name, { pl: p });
    $('#p-play').onclick = () => list.length && P.playList(list, 0, p.name);
    $('#p-shuf').onclick = () => list.length && P.playList(shuffled(list), 0, p.name);
    $('#p-ren').onclick = () => askText('Название плейлиста', p.name, (v) => { p.name = v; save(); renderPl(); });
    $('#p-del').onclick = () => confirmBox('Удалить плейлист «' + p.name + '»?', 'Треки останутся в YouTube Music и SoundCloud, удалится только этот список.', 'Удалить', () => { S.playlists = S.playlists.filter((x) => x !== p); save(); go('lib', null, false); toast('Плейлист удалён'); });
  }
  async function renderScSet() {
    view.innerHTML = `<div class="hero"><div class="cv">${route.art ? `<img src="${esc(route.art)}">` : IC('cloud', 60)}</div><div class="hero-t"><div class="page-h" style="margin:0"><small>Плейлист SoundCloud</small><h1>${esc(route.title || '')}</h1><p id="ss-n">Загружаю…</p></div><div class="hero-btns"><button class="btn" id="ss-play">${IC('play', 18)}Слушать</button><button class="btn ghost" id="ss-shuf">${IC('shuffle', 18)}Перемешать</button></div></div></div><div class="rows" id="ss-list">${loading(8)}</div>`;
    const url = route.url;
    const d = await ask({ t: 'sc', op: 'set', arg: url }, 45000);
    if (route.name !== 'scset' || route.url !== url) return;
    const list = (d.items || []).map((t) => ({ ...t, src: 'sc' })).filter((x) => !isDisliked(x));
    $('#ss-n').textContent = list.length + ' тр.';
    $('#ss-list').innerHTML = list.length ? list.map((it, i) => rowHTML(it, i)).join('') : '<div class="note">Не удалось открыть плейлист SoundCloud</div>';
    bindRows($('#ss-list'), list, route.title);
    $('#ss-play').onclick = () => list.length && P.playList(list, 0, route.title);
    $('#ss-shuf').onclick = () => list.length && P.playList(shuffled(list), 0, route.title);
  }

  // small dialogs
  function askText(title, value, done) {
    openModal(`<div class="sheet-h"><h2>${esc(title)}</h2><button class="ib" data-close>${IC('close')}</button></div><input class="field" id="ask-in" maxlength="120" value="${esc(value || '')}"><div class="sheet-f"><span></span><button class="btn" id="ask-ok">Сохранить</button></div>`, 'small');
    const inp = $('#ask-in'); setTimeout(() => { inp.focus(); inp.select(); }, 60);
    const ok = () => { const v = inp.value.trim(); if (!v) return; closeModal(); done(v); };
    $('#ask-ok').onclick = ok; inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    $('#modal [data-close]').onclick = closeModal;
  }
  function confirmBox(title, text, yes, done) {
    openModal(`<div class="sheet-h"><h2>${esc(title)}</h2></div><p class="muted">${esc(text)}</p><div class="sheet-f"><button class="btn ghost" id="cf-no">Отмена</button><button class="btn danger" id="cf-yes">${esc(yes)}</button></div>`, 'small');
    $('#cf-no').onclick = closeModal; $('#cf-yes').onclick = () => { closeModal(); done(); };
  }

  // ⋯ menu of a track
  function trackMenu(it, ctx) {
    const scl = it.src === 'sc' && scLiked(it.url);
    openModal(`<div class="menu-h"><span class="r-cv">${it.art ? `<img src="${esc(it.art)}" alt="">` : ''}</span><div><b>${esc(it.title)}</b><small>${srcBadge(it)} ${esc(it.artist || '')}</small></div></div>
      <div class="menu">
        <button data-m="now">${IC('play', 20)}Играть сейчас</button>
        <button data-m="next">${IC('queue', 20)}Играть следующим</button>
        <button data-m="pl">${IC('plus', 20)}Добавить в плейлист…</button>
        ${ctx.pl ? `<button data-m="rm">${IC('close', 20)}Убрать из «${esc(ctx.pl.name)}»</button>` : ''}
        ${it.src === 'sc' ? `<button data-m="sclike">${IC(scl ? 'heart' : 'heartLine', 20)}${scl ? 'Убрать лайк в SoundCloud' : 'Лайк в SoundCloud'}</button>` : ''}
        <button data-m="dis">${IC('broken', 20)}Не предлагать этот трек</button>
      </div>`, 'menu-sheet');
    $('#modal .menu').onclick = (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return; const m = b.dataset.m;
      if (m === 'pl') { addToPlaylist(it); return; }
      closeModal();
      if (m === 'now') P.playList([it], 0, it.title);
      if (m === 'next') { P.addNext(it); toast('Будет играть следующим: ' + it.title); }
      if (m === 'rm') { ctx.pl.items = ctx.pl.items.filter((x) => key(x) !== key(it)); save(); if (route.name === 'pl') renderPl(); toast('Убрано из плейлиста'); }
      if (m === 'sclike') likeSc(it);
      if (m === 'dis') dislike(it);
    };
  }

  // add a track to a playlist: YouPlay (any track), YouTube Music (YouTube tracks), SoundCloud (SoundCloud tracks)
  async function addToPlaylist(it) {
    openModal(`<div class="sheet-h"><h2>В плейлист</h2><button class="ib" data-close>${IC('close')}</button></div>
      <p class="muted" style="margin:0 0 12px">«${esc(it.title)}» — ${it.src === 'yt' ? 'плейлисты YouPlay и YouTube Music' : it.src === 'sc' ? 'плейлисты YouPlay и SoundCloud' : 'плейлисты YouPlay'}</p>
      <div class="pick" id="pick"></div>`, 'small');
    $('#modal [data-close]').onclick = closeModal;
    const draw = (busy) => {
      const box = $('#pick'); if (!box) return;
      const yt = it.src === 'yt' && pls.yt ? pls.yt.items : [], sc = it.src === 'sc' && pls.sc ? pls.sc.items.filter((p) => p.mine !== false) : [];
      const has = (p) => p.items.some((x) => key(x) === key(it));
      box.innerHTML = `<button class="pk new" data-new="1"><span class="pc">${IC('plus', 22)}</span><span><b>Новый плейлист</b><small>Создать и добавить трек</small></span></button>
        ${S.playlists.map((p, i) => `<button class="pk" data-yp="${i}"><span class="pc">${plArt(p) ? `<img src="${esc(plArt(p))}">` : IC('library', 22)}</span><span><b>${esc(p.name)}</b><small>YouPlay · ${p.items.length} тр.</small></span>${has(p) ? `<span class="ok">${IC('check', 18)}</span>` : ''}</button>`).join('')}
        ${yt.map((p, i) => `<button class="pk" data-yt="${i}"><span class="pc">${p.art ? `<img src="${esc(p.art)}">` : IC('yt', 22)}</span><span><b>${esc(p.title)}</b><small><span class="badge yt">YouTube Music</span></small></span></button>`).join('')}
        ${sc.map((p, i) => `<button class="pk" data-sc="${i}"><span class="pc">${p.art ? `<img src="${esc(p.art)}">` : IC('cloud', 22)}</span><span><b>${esc(p.title)}</b><small><span class="badge sc">SoundCloud</span> ${p.count} тр.</small></span></button>`).join('')}
        ${busy ? '<div class="note">Загружаю плейлисты из аккаунтов…</div>' : ''}`;
      box.onclick = async (e) => {
        const b = e.target.closest('.pk'); if (!b) return;
        if (b.dataset.new) { createPlaylist(it); return; }
        if (b.dataset.yp != null) { const p = S.playlists[+b.dataset.yp]; if (!has(p)) { p.items.push(slim(it)); save(); dirty('lib'); toast('Добавлено в «' + p.name + '»'); } else toast('Уже есть в «' + p.name + '»'); closeModal(); if (route.name === 'lib') renderLib(); return; }
        closeModal();
        if (b.dataset.yt != null) { const p = yt[+b.dataset.yt]; toast('Добавляю в YouTube Music…'); const r = await eng('plAdd', { videoId: it.videoId, title: it.title, artist: it.artist, playlist: p.title }); toast(r.ok ? '✓ Добавлено в «' + p.title + '» (YouTube Music)' : r.login === false ? 'Войдите в YouTube Music в настройках' : 'YouTube Music не принял трек — попробуйте ещё раз'); }
        if (b.dataset.sc != null) { const p = sc[+b.dataset.sc]; toast('Добавляю в SoundCloud…'); const r = await ask({ t: 'sc', op: 'addto', arg: it.url + '#name=' + encodeURIComponent(p.title) }, 45000); toast(r.ok ? '✓ Добавлено в «' + p.title + '» (SoundCloud)' : r.login === false ? 'Войдите в SoundCloud в настройках' : 'SoundCloud не принял трек — попробуйте ещё раз'); }
      };
    };
    draw(it.src !== 'local' && !pls.at);
    if (it.src !== 'local') { await loadRemotePls(false); draw(false); }
  }

  // new playlist: in YouPlay (any tracks), YouTube Music or SoundCloud
  function createPlaylist(it) {
    const ytOk = !!(S.account && S.account.signedIn) && (!it || it.src === 'yt');
    const scOk = !!(S.sc && S.sc.login) && !!it && it.src === 'sc';
    const why = { yt: !(S.account && S.account.signedIn) ? 'Войдите в YouTube Music в настройках' : 'Сюда можно только треки YouTube Music', sc: !(S.sc && S.sc.login) ? 'Подключите SoundCloud в настройках' : !it ? 'SoundCloud создаёт плейлист вместе с первым треком — нажмите ⋯ у трека SoundCloud' : 'Сюда можно только треки SoundCloud' };
    openModal(`<div class="sheet-h"><h2>Новый плейлист</h2><button class="ib" data-close>${IC('close')}</button></div>
      <input class="field" id="pl-name-in" maxlength="120" placeholder="Название плейлиста">
      <div class="where" id="where">
        <button class="wh on" data-w="yp"><span class="pc">${IC('library', 22)}</span><span><b>YouPlay</b><small>Любые треки вместе: YouTube Music, SoundCloud и файлы</small></span></button>
        <button class="wh" data-w="yt" ${ytOk ? '' : 'disabled'}><span class="pc yt">${IC('yt', 22)}</span><span><b>YouTube Music</b><small>${ytOk ? 'Сохранится в вашем аккаунте YouTube Music' : why.yt}</small></span></button>
        <button class="wh" data-w="sc" ${scOk ? '' : 'disabled'}><span class="pc sc">${IC('cloud', 22)}</span><span><b>SoundCloud</b><small>${scOk ? 'Сохранится в вашем аккаунте SoundCloud' : why.sc}</small></span></button>
      </div>
      <div class="sheet-f"><span>${it ? 'Трек «' + esc(it.title) + '» сразу попадёт в плейлист' : ''}</span><button class="btn" id="pl-create">Создать</button></div>`, 'small');
    let where = 'yp';
    $('#modal [data-close]').onclick = closeModal;
    $('#where').onclick = (e) => { const b = e.target.closest('.wh'); if (!b || b.disabled) return; where = b.dataset.w; $$('#where .wh').forEach((x) => x.classList.toggle('on', x === b)); };
    const inp = $('#pl-name-in'); setTimeout(() => inp.focus(), 60);
    const make = async () => {
      const name = inp.value.trim(); if (!name) { inp.focus(); return; }
      closeModal();
      if (where === 'yp') {
        const p = { id: 'p' + Date.now().toString(36), name, items: it ? [slim(it)] : [], at: Date.now() };
        S.playlists.unshift(p); save(); dirty('lib'); toast('Плейлист «' + name + '» создан');
        if (route.name === 'lib') renderLib(); else if (!it) go('pl', { id: p.id });
      } else if (where === 'yt') {
        toast('Создаю плейлист в YouTube Music…');
        const r = await eng('plCreate', it ? { name, videoId: it.videoId, title: it.title, artist: it.artist } : { name });
        pls.at = 0; toast(r.ok ? '✓ Плейлист «' + name + '» создан в YouTube Music' : 'YouTube Music не создал плейлист — попробуйте ещё раз');
        if (route.name === 'lib') renderLib(true);
      } else {
        toast('Создаю плейлист в SoundCloud…');
        const r = await ask({ t: 'sc', op: 'create', arg: it.url + '#name=' + encodeURIComponent(name) }, 45000);
        pls.at = 0; toast(r.ok ? '✓ Плейлист «' + name + '» создан в SoundCloud' : 'SoundCloud не создал плейлист — попробуйте ещё раз');
        if (route.name === 'lib') renderLib(true);
      }
    };
    $('#pl-create').onclick = make; inp.onkeydown = (e) => { if (e.key === 'Enter') make(); };
  }

  // Моя музыка: files on this device, no internet needed
  let localCache = null;
  async function localTracks(force) {
    if (localCache && !force) return localCache;
    const r = await ask({ t: 'local' }, 30000);
    if (r.perm === false) return (localCache = { perm: false, list: [] }).list;
    localCache = { list: (r.tracks || []).map((t) => ({ ...t, src: 'local', duration: t.duration > 1000 ? t.duration / 1000 : t.duration })) };
    return localCache.list;
  }
  async function renderLocal() {
    view.innerHTML = `<div class="hero"><div class="cv local">${IC(ANDROID ? 'phone' : 'music', 60)}</div><div class="hero-t"><div class="page-h" style="margin:0"><small>Работает без интернета</small><h1>Моя музыка</h1><p id="lo-n">Ищу музыку…</p></div>
      <div class="hero-btns"><button class="btn" id="lo-play">${IC('play', 18)}Слушать</button><button class="btn ghost" id="lo-shuf">${IC('shuffle', 18)}Перемешать</button>${ANDROID ? '' : `<button class="btn ghost" id="lo-folder" title="Папка с музыкой">Папка…</button>`}</div></div></div>
      <div class="rows" id="lo-list">${loading(6)}</div>`;
    const list = (await localTracks(true)).sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title, 'ru'));
    if (route.name !== 'local') return;
    if (localCache.perm === false) {
      $('#lo-n').textContent = 'Нужен доступ к музыке на устройстве';
      $('#lo-list').innerHTML = `<div class="banner green"><div><b>Разрешите доступ к аудиофайлам</b><small>YouPlay покажет и сыграет музыку с этого устройства</small></div><button class="btn" id="lo-perm">Разрешить</button></div>`;
      $('#lo-perm').onclick = () => host.send({ t: 'perm-audio' });
      return;
    }
    $('#lo-n').textContent = list.length ? list.length + ' треков на устройстве' : (ANDROID ? 'Музыкальных файлов не найдено' : 'В папке «Музыка» нет аудиофайлов');
    $('#lo-list').innerHTML = list.length ? list.map((it, i) => rowHTML(it, i)).join('') : '<div class="note">Положите музыку (MP3, M4A, FLAC, OGG, WAV) в папку «Музыка» — она появится здесь</div>';
    bindRows($('#lo-list'), list, 'Моя музыка');
    $('#lo-play').onclick = () => list.length && P.playList(list, 0, 'Моя музыка');
    $('#lo-shuf').onclick = () => list.length && P.playList(shuffled(list), 0, 'Моя музыка');
    if ($('#lo-folder')) $('#lo-folder').onclick = () => host.send({ t: 'pick-folder' });
  }
  window.__ypLocalReload = () => { localCache = null; if (route.name === 'local') renderLocal(); };

  // ───────── player: one queue, three sources ─────────
  const audio = $('#audio'), scFrame = $('#sc-frame');
  const P = {
    list: [], i: -1, name: '', cur: null, playing: false, time: 0, dur: 0, shuffle: false, repeat: 'off',
    yt: {}, sc: { pos: 0, dur: 0, ready: false },
    playList(list, i, name) {
      if (!list || !list.length) return;
      this.list = list.map((x) => ({ ...x })); this.name = name || ''; this.playAt(i < 0 ? 0 : i);
      if (S.autoNP && !matchMedia('(max-width: 820px)').matches) openNP();
      else if (S.autoNP) openNP();
    },
    addNext(it) { if (!this.cur) { this.playList([it], 0, 'Очередь'); return; } this.list.splice(this.i + 1, 0, { ...it }); renderQueue(); },
    playAt(i) {
      if (i < 0 || i >= this.list.length) return;
      const it = this.list[i];
      if (isDisliked(it)) { if (i + 1 < this.list.length) return this.playAt(i + 1); return; }
      this.stopAll(it.src);
      this.i = i; this.cur = it; this.time = 0; this.dur = it.duration || 0;
      if (it.src === 'yt') { host.send({ t: 'eng', cmd: 'control', op: 'expectEnd', value: true, id: rid() }); host.send({ t: 'eng', cmd: 'play', videoId: it.videoId, listId: it.listId || null, id: rid() }); }
      else if (it.src === 'sc') scLoad(it);
      else { audio.src = it.url; audio.volume = S.volume; audio.play().catch(() => {}); }
      S.recent = [it, ...S.recent.filter((x) => key(x) !== key(it))].slice(0, 24).map((x) => ({ src: x.src, videoId: x.videoId, url: x.url, id: x.id, title: x.title, artist: x.artist, art: x.art, duration: x.duration }));
      save();
      paintTrack(); loadLyrics(it); renderQueue(); repaintRows();
    },
    stopAll(except) {
      if (except !== 'local' && !audio.paused) audio.pause();
      if (except !== 'sc' && this.sc.ready) { scPost('pause'); }
      if (except !== 'yt' && this.cur && this.cur.src === 'yt') host.send({ t: 'eng', cmd: 'control', op: 'pause', id: rid() });
    },
    next(auto) {
      if (this.repeat === 'one' && auto) { this.seek(0); this.resume(); return; }
      if (this.i + 1 < this.list.length) this.playAt(this.i + 1);
      else if (this.repeat === 'all' && this.list.length) this.playAt(0);
      else if (this.cur && this.cur.src === 'yt') { host.send({ t: 'eng', cmd: 'control', op: 'expectEnd', value: false, id: rid() }); host.send({ t: 'eng', cmd: 'control', op: 'next', id: rid() }); this.radio = true; }
      else { this.pause(); }
    },
    prev() { if (this.time > 3) this.seek(0); else if (this.i > 0) this.playAt(this.i - 1); else this.seek(0); },
    toggle() { this.playing ? this.pause() : this.resume(); },
    pause() { const s = this.cur && this.cur.src; if (s === 'yt') host.send({ t: 'eng', cmd: 'control', op: 'pause', id: rid() }); else if (s === 'sc') scPost('pause'); else audio.pause(); },
    resume() { const s = this.cur && this.cur.src; if (!s) return; if (s === 'yt') host.send({ t: 'eng', cmd: 'control', op: 'play', id: rid() }); else if (s === 'sc') scPost('play'); else audio.play(); },
    seek(t) { const s = this.cur && this.cur.src; this.time = t; if (s === 'yt') host.send({ t: 'eng', cmd: 'control', op: 'seek', time: t, id: rid() }); else if (s === 'sc') scPost('seekTo', t * 1000); else audio.currentTime = t; },
    volume(v) { S.volume = v; save(); audio.volume = v; scPost('setVolume', Math.round(v * 100)); host.send({ t: 'eng', cmd: 'control', op: 'volume', value: v, id: rid() }); },
    cmd(op) { if (op === 'toggle') this.toggle(); else if (op === 'play') this.resume(); else if (op === 'pause') this.pause(); else if (op === 'next') this.next(); else if (op === 'prev') this.prev(); },
    onYtState(s) {
      this.yt = s;
      if (!this.cur || this.cur.src !== 'yt') {
        // YouTube Music continues on its own (radio after our list ended): follow it
        if (this.radio && s.videoId && s.playing) { this.cur = { src: 'yt', videoId: s.videoId, title: s.title, artist: s.artist, art: s.art }; this.list.push(this.cur); this.i = this.list.length - 1; paintTrack(); loadLyrics(this.cur); }
        else return;
      }
      if (this.radio && s.videoId && this.cur.videoId !== s.videoId && s.title) { this.cur = { src: 'yt', videoId: s.videoId, title: s.title, artist: s.artist, art: s.art }; this.list.push(this.cur); this.i = this.list.length - 1; paintTrack(); loadLyrics(this.cur); renderQueue(); }
      if (s.videoId && s.videoId !== this.cur.videoId) return;   // still switching
      this.playing = s.playing; this.time = s.time; this.dur = s.dur || this.dur;
      if (s.art && !this.cur.art) this.cur.art = s.art;
      if (s.title && !this.cur.title) this.cur.title = s.title;
      this.cur.liked = s.liked; this.cur.disliked = s.disliked;
      paintPlay(); paintLikes();
    },
    onYtEnded(m) { if (this.cur && this.cur.src === 'yt' && m.videoId === this.cur.videoId) this.next(true); },
  };
  audio.addEventListener('play', () => { if (P.cur && P.cur.src === 'local') { P.playing = true; paintPlay(); } });
  audio.addEventListener('pause', () => { if (P.cur && P.cur.src === 'local') { P.playing = false; paintPlay(); } });
  audio.addEventListener('timeupdate', () => { if (P.cur && P.cur.src === 'local') { P.time = audio.currentTime; P.dur = audio.duration || P.dur; } });
  audio.addEventListener('ended', () => { if (P.cur && P.cur.src === 'local') P.next(true); });
  audio.addEventListener('error', () => { if (P.cur && P.cur.src === 'local' && audio.src) { toast('Файл не воспроизводится — пропускаю'); setTimeout(() => P.next(true), 500); } });

  // SoundCloud official widget (postMessage API)
  const SCO = 'https://w.soundcloud.com';
  function scPost(method, value) { if (scFrame.contentWindow && P.sc.ready) scFrame.contentWindow.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), SCO); }
  function scLoad(it) {
    P.sc = { pos: 0, dur: it.duration || 0, ready: false };
    scFrame.src = SCO + '/player/?url=' + encodeURIComponent(it.url) + '&auto_play=true&visual=false&show_artwork=false&show_comments=false&buying=false&sharing=false&download=false';
  }
  window.addEventListener('message', (e) => {
    if (e.origin !== SCO || e.source !== scFrame.contentWindow) return;
    let m; try { m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (_) { return; }
    if (!m || !P.cur || P.cur.src !== 'sc') return;
    const v = m.value;
    if (m.method === 'ready') { P.sc.ready = true; for (const ev of ['play', 'pause', 'finish', 'playProgress', 'error']) scFrame.contentWindow.postMessage(JSON.stringify({ method: 'addEventListener', value: ev }), SCO); scPost('setVolume', Math.round(S.volume * 100)); scPost('play'); scPost('getCurrentSound'); }
    if (m.method === 'play') { P.playing = true; paintPlay(); }
    if (m.method === 'pause') { P.playing = false; paintPlay(); }
    if (m.method === 'playProgress' && v) { P.time = v.currentPosition / 1000; if (!P.playing) { P.playing = true; paintPlay(); } }
    if (m.method === 'getCurrentSound' && v) { if (v.duration) P.dur = v.duration / 1000; if (!P.cur.title) P.cur.title = v.title; if (!P.cur.art && v.artwork_url) { P.cur.art = v.artwork_url.replace('-large.', '-t500x500.'); paintTrack(); } }
    if (m.method === 'finish') P.next(true);
    if (m.method === 'error') { toast('SoundCloud не смог воспроизвести трек — пропускаю'); P.next(true); }
  });

  // ───────── painting the player ─────────
  let bgFlip = false;
  function paintTrack() {
    const it = P.cur; if (!it) return;
    document.body.classList.add('has-track');
    $('#player').hidden = false;
    $('#pl-title').textContent = $('#np-title').textContent = it.title || '';
    $('#pl-artist').textContent = $('#np-artist').textContent = it.artist || '';
    for (const img of [$('#pl-art'), $('#np-art')]) img.src = it.art || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    $('#np-bg').style.backgroundImage = it.art ? `url("${it.art}")` : '';
    const a = bgFlip ? $('#bg-a') : $('#bg-b'), b = bgFlip ? $('#bg-b') : $('#bg-a'); bgFlip = !bgFlip;
    a.style.backgroundImage = it.art ? `url("${it.art}")` : ''; a.classList.add('on'); b.classList.remove('on');
    $('#np-badge').className = 'badge ' + it.src; $('#np-badge').textContent = it.src === 'sc' ? 'SoundCloud' : it.src === 'local' ? 'На устройстве' : 'YouTube Music';
    $('#np-src').textContent = P.name || 'Сейчас играет';
    document.title = (it.title ? it.title + ' — ' : '') + 'YouPlay';
    if ('mediaSession' in navigator && it.src !== 'yt') {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: it.title || '', artist: it.artist || '', artwork: it.art ? [{ src: it.art, sizes: '512x512' }] : [] }); } catch (_) {}
    }
    paintPlay(); paintLikes();
  }
  let lastMedia = '';
  function paintPlay() {
    const icon = IC(P.playing ? 'pause' : 'play', 26);
    $('#pl-play').innerHTML = icon; $('#np-play').innerHTML = IC(P.playing ? 'pause' : 'play', 32);
    document.body.classList.toggle('paused', !P.playing);
    $('#pl-shuffle').classList.toggle('on', P.shuffle); $('#np-shuffle').classList.toggle('on', P.shuffle);
    for (const b of [$('#pl-repeat'), $('#np-repeat')]) { b.classList.toggle('on', P.repeat !== 'off'); b.innerHTML = `<span class="ic">${IC(P.repeat === 'one' ? 'repeat1' : 'repeat', b.id === 'np-repeat' ? 24 : 20)}</span>`; }
    if (P.cur) { const m = JSON.stringify({ title: P.cur.title, artist: P.cur.artist, art: P.cur.art, playing: P.playing }); if (m !== lastMedia) { lastMedia = m; host.send({ t: 'media', ...JSON.parse(m) }); } }
  }
  function likedNow() { const it = P.cur; if (!it) return false; return it.src === 'sc' ? scLiked(it.url) : it.src === 'local' ? (S.localFav || []).includes(it.id) : !!it.liked; }
  function paintLikes() {
    const l = likedNow();
    for (const b of [$('#pl-like'), $('#np-like')]) { b.classList.toggle('on', l); b.innerHTML = IC(l ? 'heart' : 'heartLine', b.id === 'np-like' ? 24 : 20); }
    $('#np-dislike').classList.toggle('on', !!(P.cur && (P.cur.disliked || isDisliked(P.cur))));
  }
  let lastTick = performance.now();
  function frame() {
    const now = performance.now(), dt = (now - lastTick) / 1000; lastTick = now;
    if (P.cur && !document.hidden) {
      if (P.cur.src === 'sc' && P.playing) P.time += Math.min(dt, 1);   // between widget updates
      if (P.cur.src === 'yt' && P.playing && P.yt.time != null) P.time = Math.max(P.time, P.yt.time);
      const d = P.dur || 0, p = d ? clamp(P.time / d) : 0;
      for (const s of [$('#pl-seek'), $('#np-seek')]) { if (s.dataset.drag) continue; s.querySelector('.fill').style.transform = `scaleX(${p})`; s.querySelector('.knob').style.left = (p * 100) + '%'; }
      $('#mini-bar').style.transform = `scaleX(${p})`;
      const c = fmt(P.time), dd = fmt(d);
      if ($('#pl-cur').textContent !== c) { $('#pl-cur').textContent = c; $('#np-cur').textContent = c; }
      if ($('#pl-dur').textContent !== dd) { $('#pl-dur').textContent = dd; $('#np-dur').textContent = dd; }
      if ($('#np').classList.contains('open') && !$('#lyrics').classList.contains('on')) tickLyrics();
      sleepTick();
    }
  }
  setInterval(frame, 250);
  function bindSeek(el) {
    el.addEventListener('pointerdown', (e) => {
      if (!P.dur) return;
      el.setPointerCapture(e.pointerId); el.dataset.drag = '1';
      const at = (ev) => clamp((ev.clientX - el.getBoundingClientRect().left) / el.getBoundingClientRect().width);
      const show = (p) => { el.querySelector('.fill').style.transform = `scaleX(${p})`; el.querySelector('.knob').style.left = (p * 100) + '%'; };
      show(at(e));
      el.onpointermove = (ev) => show(at(ev));
      el.onpointerup = (ev) => { el.onpointermove = null; delete el.dataset.drag; P.seek(at(ev) * P.dur); lastLine = -2; };
    });
  }
  bindSeek($('#pl-seek')); bindSeek($('#np-seek'));
  $('#pl-play').onclick = () => P.toggle(); $('#np-play').onclick = () => P.toggle();
  $('#pl-next').onclick = () => P.next(); $('#np-next').onclick = () => P.next();
  $('#pl-prev').onclick = () => P.prev(); $('#np-prev').onclick = () => P.prev();
  const shuf = () => { P.shuffle = !P.shuffle; if (P.shuffle && P.list.length > 1) { const cur = P.list[P.i]; const rest = shuffled(P.list.filter((_, k) => k !== P.i)); P.list = [cur, ...rest]; P.i = 0; renderQueue(); } paintPlay(); toast(P.shuffle ? 'Перемешивание включено' : 'Перемешивание выключено'); };
  $('#pl-shuffle').onclick = shuf; $('#np-shuffle').onclick = shuf;
  const rep = () => { P.repeat = P.repeat === 'off' ? 'all' : P.repeat === 'all' ? 'one' : 'off'; paintPlay(); toast(P.repeat === 'off' ? 'Повтор выключен' : P.repeat === 'all' ? 'Повтор очереди' : 'Повтор трека'); };
  $('#pl-repeat').onclick = rep; $('#np-repeat').onclick = rep;
  $('#pl-vol').value = Math.round(S.volume * 100);
  $('#pl-vol').oninput = (e) => P.volume(e.target.value / 100);
  $('#pl-open').onclick = (e) => { if (!e.target.closest('button')) openNP(); };
  $('#pl-full').onclick = () => openNP();
  $('#pl-lyrics').onclick = () => { openNP(); setSheet('lyrics'); };
  $('#pl-queue').onclick = () => { openNP(); setSheet('queue'); };
  $('#pl-like').onclick = () => like(); $('#np-like').onclick = () => like();
  $('#np-dislike').onclick = () => dislike();
  $('#np-add').onclick = () => P.cur && addToPlaylist(P.cur);
  if ($('#pl-add')) $('#pl-add').onclick = () => P.cur && addToPlaylist(P.cur);

  // ───────── Now Playing ─────────
  function openNP() { if (!P.cur) return; $('#np').classList.add('open'); $('#np').setAttribute('aria-hidden', 'false'); lastLine = -2; }
  function closeNP() { $('#np').classList.remove('open'); $('#np').setAttribute('aria-hidden', 'true'); }
  $('#np-close').onclick = closeNP;
  function setSheet(which) {
    const np = $('#np');
    const cur = np.classList.contains('sheet-on') ? (np.dataset.sheet || null) : null;
    const target = which && which !== cur ? which : (matchMedia('(max-width: 820px)').matches ? null : (which || 'lyrics'));
    np.classList.toggle('sheet-on', !!target && matchMedia('(max-width: 820px)').matches);
    np.dataset.sheet = target || '';
    $('#lyrics').classList.toggle('on', (target || 'lyrics') === 'lyrics');
    $('#queue').classList.toggle('on', target === 'queue');
    $('#np-tab-lyrics').classList.toggle('on', target === 'lyrics');
    $('#np-tab-queue').classList.toggle('on', target === 'queue');
    if (target === 'queue') renderQueue();
    lastLine = -2;
  }
  $('#np-tab-lyrics').onclick = () => setSheet('lyrics');
  $('#np-tab-queue').onclick = () => setSheet('queue');
  let y0 = null;
  $('#np').addEventListener('touchstart', (e) => { if (!e.target.closest('.seek, .ly-scroll, .q-list, input')) y0 = e.touches[0].clientY; }, { passive: true });
  $('#np').addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 120) closeNP(); y0 = null; }, { passive: true });

  // queue + disliked
  let qTab = 'queue';
  $$('.q-tab').forEach((b) => b.onclick = () => { qTab = b.dataset.q; $$('.q-tab').forEach((x) => x.classList.toggle('on', x === b)); $('#queue').classList.toggle('dis', qTab === 'dis'); renderQueue(); });
  function renderQueue() {
    $('#dis-n').textContent = S.disliked.length || '';
    const box = $('#q-list'); if (!box) return;
    if (qTab === 'dis') {
      box.innerHTML = S.disliked.length ? S.disliked.map((d, i) => `<div class="row" data-u="${i}"><span class="r-n">${IC('broken', 16)}</span><span class="r-cv">${d.art ? `<img src="${esc(d.art)}">` : ''}</span><span class="r-m"><span class="r-t">${esc(d.title)}</span><span class="r-s">${srcBadge(d)}<span>${esc(d.artist || '')}</span></span></span><button class="chip" data-undo="${i}">Вернуть</button><span></span></div>`).join('') : '<div class="note">Треки с разбитым сердечком YouPlay пропускает и больше не предлагает</div>';
      box.onclick = (e) => { const u = e.target.closest('[data-undo]'); if (u) { S.disliked.splice(+u.dataset.undo, 1); save(); renderQueue(); paintLikes(); } };
      return;
    }
    box.innerHTML = P.list.length ? P.list.map((it, i) => rowHTML(it, i)).join('') : '<div class="note">Очередь пуста</div>';
    box.onclick = (e) => { const row = e.target.closest('.row'); if (!row) return; const i = +row.dataset.i; const act = e.target.closest('[data-act]'); if (act) return; P.playAt(i); };
    const on = $('.row.on', box); if (on) on.scrollIntoView({ block: 'center' });
  }
  function repaintRows() { for (const r of $$('#view .row.on')) r.classList.remove('on'); }
  $('#sc-add').addEventListener('submit', async (e) => {
    e.preventDefault(); const url = $('#sc-url').value.trim(); if (!url) return;
    if (!/soundcloud\.com\//.test(url)) { toast('Это не ссылка SoundCloud'); return; }
    $('#sc-url').value = '';
    const r = await ask({ t: 'fetch', url: 'https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(url) });
    let o = null; try { o = JSON.parse(r.body); } catch (_) {}
    if (!o) { toast('Не удалось открыть ссылку SoundCloud'); return; }
    const by = o.title.lastIndexOf(' by ');
    P.addNext({ src: 'sc', url, title: by > 0 ? o.title.slice(0, by) : o.title, artist: o.author_name, art: (o.thumbnail_url || '').replace(/-t\d+x\d+\./, '-t500x500.') });
    toast('Добавлено в очередь');
  });
  document.addEventListener('paste', (e) => {
    const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (/^https?:\/\/(on\.|m\.|www\.)?soundcloud\.com\//.test(t.trim()) && !e.target.closest('input')) { e.preventDefault(); $('#sc-url').value = t.trim(); $('#sc-add').requestSubmit(); }
  });

  // ───────── likes / dislikes ─────────
  async function like() {
    const it = P.cur; if (!it) return;
    if (it.src === 'yt') {
      host.send({ t: 'eng', cmd: 'control', op: 'like', id: rid() });
      if (!it.liked) { S.ytLikeDates[it.videoId] = Date.now(); save(); likesCache.at = 0; }
      toast(it.liked ? 'Убрано из понравившихся' : '♥ Сохранено в YouTube Music');
    } else if (it.src === 'sc') likeSc(it);
    else { S.localFav = S.localFav || []; const k = S.localFav.indexOf(it.id); if (k >= 0) S.localFav.splice(k, 1); else S.localFav.push(it.id); save(); paintLikes(); }
  }
  async function likeSc(it, btn) {
    const liked = scLiked(it.url);
    const r = await ask({ t: 'sc', op: liked ? 'unlike' : 'like', arg: it.url }, 45000);
    if (r.login === false) { toast('Войдите в SoundCloud, чтобы ставить лайки', { label: 'Войти', fn: () => host.send({ t: 'login', service: 'sc' }) }); return; }
    if (!r.ok) { toast('SoundCloud не принял лайк — попробуйте ещё раз'); return; }
    if (liked) likesCache.sc = likesCache.sc.filter((x) => x.url !== it.url);
    else likesCache.sc.unshift({ ...it, src: 'sc', likedAt: new Date().toISOString() });
    localStorage.setItem('youplay-likes', JSON.stringify(likesCache)); dirty('likes');
    if (btn) btn.innerHTML = IC(liked ? 'heartLine' : 'heart', 18), btn.classList.toggle('on', !liked);
    paintLikes(); toast(liked ? 'Убрано из лайков SoundCloud' : '♥ Сохранено в SoundCloud');
  }
  function dislike(track) {
    const it = track || P.cur; if (!it) return;
    if (track && P.cur && key(track) === key(P.cur)) return dislike();
    const k = key(it);
    if (isDisliked(it)) { S.disliked = S.disliked.filter((d) => d.key !== k); save(); paintLikes(); toast('Снова можно предлагать'); return; }
    S.disliked.unshift({ key: k, src: it.src, title: it.title, artist: it.artist, art: it.art, at: Date.now() }); save();
    if (!track && it.src === 'yt' && !it.disliked) host.send({ t: 'eng', cmd: 'control', op: 'dislike', id: rid() });
    toast('Больше не предложу: ' + it.title, { label: 'Отменить', fn: () => { S.disliked = S.disliked.filter((d) => d.key !== k); save(); renderQueue(); } });
    renderQueue(); P.next();
  }

  // ───────── lyrics (LRCLIB) ─────────
  let wordEls = null, smooth = 0, lastRaf = 0, lastP = '';
  let lines = [], lastLine = -2, lyMeta = { dur: 0, tempo: false }, lyReq = 0;
  const TEMPO = /(slowed|sped|speed up|nightcore|daycore)/i;
  const clean = (t) => t.replace(/\s*[\(\[][^\)\]]*(slowed|sped|reverb|nightcore|official|video|audio|lyric|mv|remaster|hd|hq|клип)[^\)\]]*[\)\]]/gi, '').replace(/\s*-\s*(official|lyric).*$/i, '').trim();
  let lyNet = false;
  async function lrc(path) {
    for (let a = 0; a < 2; a++) {
      const r = await ask({ t: 'fetch', url: 'https://lrclib.net' + path }, 15000).catch(() => null);
      if (r && r.status === 200) { try { return JSON.parse(r.body); } catch (_) { return null; } }
      if (r && r.status === 404) return null;
      lyNet = true;
    }
    return null;
  }
  async function loadLyrics(it) {
    const my = ++lyReq; lines = []; lastLine = -2;
    $('#ly-list').innerHTML = `<div class="ly-msg"><span class="dots"><i></i><i></i><i></i></span>Ищу текст…</div>`;
    $('#ly-list').style.transform = '';
    paintOffset();
    if (!online || !it.title) { $('#ly-list').innerHTML = `<div class="ly-msg">${online ? 'Текст не найден' : 'Текст недоступен без интернета'}</div>`; return; }
    lyNet = false;
    const tempo = TEMPO.test(it.title), a = (it.artist || '').split(/•|·|,| и | & | feat\.| ft\.| x /i)[0].replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').trim();
    let t = clean(it.title);
    if (a && t.toLowerCase().startsWith(a.toLowerCase())) t = t.slice(a.length).replace(/^\s*[—–-]\s*/, '') || t;   // "Artist — Title" (common on SoundCloud)
    let res = null;
    if (!tempo) res = await lrc('/api/get?' + new URLSearchParams({ track_name: t, artist_name: a }));
    if (!res || !res.syncedLyrics) {
      let list = await lrc('/api/search?' + new URLSearchParams({ track_name: t, artist_name: a }));
      if (!Array.isArray(list) || !list.length) list = await lrc('/api/search?' + new URLSearchParams({ q: t + ' ' + a }));
      if (Array.isArray(list) && list.length) { const n = {}; for (const x of list) if (x.syncedLyrics && x.duration) n[Math.round(x.duration)] = (n[Math.round(x.duration)] || 0) + 1; const common = +(Object.entries(n).sort((p, q) => q[1] - p[1])[0] || [0])[0]; list.sort((p, q) => ((q.syncedLyrics ? 1000 : 0) - Math.abs((q.duration || 0) - common)) - ((p.syncedLyrics ? 1000 : 0) - Math.abs((p.duration || 0) - common))); res = list[0]; }
    }
    if (my !== lyReq) return;
    if ((!res || (!res.syncedLyrics && !res.plainLyrics)) && it.src === 'yt' && it.videoId) {
      // YouTube Music's own lyrics (tab "Текст"), read from the hidden window
      for (let k = 0; k < 3 && my === lyReq; k++) {
        await new Promise((r) => setTimeout(r, 1500 + k * 1500));
        if (my !== lyReq || !P.cur || P.cur.videoId !== it.videoId) return;
        const y = await eng('lyrics', { videoId: it.videoId }).catch(() => null);
        if (y && y.text) { res = { plainLyrics: y.text, ytm: y.source || 'YouTube Music' }; break; }
      }
      if (my !== lyReq) return;
    }
    lyMeta = { dur: (res && res.duration) || 0, tempo };
    if (res && res.syncedLyrics) {
      for (const raw of res.syncedLyrics.split(/\r?\n/)) {
        const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
        const body = raw.replace(/\[[^\]]*\]/g, '');
        // enhanced LRC: <mm:ss.xx> before each word gives exact word timing
        const wt = [...body.matchAll(/<(\d+):(\d+(?:\.\d+)?)>\s*([^<]*)/g)].map((m) => ({ t: +m[1] * 60 + +m[2], w: m[3].trim() })).filter((x) => x.w);
        const txt = body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        for (const m of tags) lines.push({ t: +m[1] * 60 + +m[2], text: txt, wt: wt.length ? wt : null });
      }
      lines.sort((x, y) => x.t - y.t);
      lines.forEach((l, i) => {
        const end = i + 1 < lines.length ? Math.min(lines[i + 1].t, l.t + 9) : l.t + 6;
        const words = l.text ? l.text.split(' ') : [];
        if (l.wt && l.wt.length === words.length) l.words = l.wt.map((x, k) => ({ s: x.t, e: k + 1 < l.wt.length ? l.wt[k + 1].t : end }));
        else {
          // no word timing in the file: share the line's time between its words by length (sung words take ~85% of the line)
          const span = Math.max(0.6, (end - l.t) * 0.85), total = words.reduce((a, w) => a + w.length + 1.5, 0) || 1;
          let at = l.t; l.words = words.map((w) => { const d = span * (w.length + 1.5) / total, o = { s: at, e: at + d }; at += d; return o; });
        }
      });
      $('#ly-list').innerHTML = lines.map((l, i) => `<p class="ly-line" data-l="${i}">${l.text ? l.text.split(' ').map((w) => `<span class="w">${esc(w)}</span>`).join(' ') : '<span class="w">♪</span>'}</p>`).join('');
      wordEls = null;
    } else if (res && res.plainLyrics) {
      $('#ly-list').innerHTML = res.plainLyrics.split(/\r?\n/).map((l) => `<p class="ly-line plain">${esc(l) || '&nbsp;'}</p>`).join('');
      $('#ly-list').style.transform = 'translate3d(0,-30vh,0)';
    } else $('#ly-list').innerHTML = `<div class="ly-msg">${res && res.instrumental ? '♪ Инструментал' : lyNet ? 'Не удалось связаться с сервером текстов (LRCLIB). <button class="chip" id="ly-retry">Повторить</button>' : 'Текст для этой песни не найден'}</div>`;
    if ($('#ly-retry')) $('#ly-retry').onclick = () => loadLyrics(it);
    if ($('#ly-src')) $('#ly-src').textContent = res && res.ytm ? 'Текст: YouTube Music' : 'Текст: LRCLIB';
  }
  const ratio = () => { const d = P.dur; if (!lyMeta.dur || !d) return 1; const k = lyMeta.dur / d; return k < .55 || k > 1.8 ? 1 : (lyMeta.tempo || Math.abs(k - 1) > .04 ? k : 1); };
  const offset = () => (P.cur && S.offsets[key(P.cur)]) || 0;
  function tickLyrics() {
    if (!lines.length) return;
    const t = P.time * ratio() + offset() + 0.4;
    let lo = 0, hi = lines.length - 1, i = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].t <= t) { i = m; lo = m + 1; } else hi = m - 1; }
    if (i === lastLine) return;
    lastLine = i; wordEls = null;
    const els = $$('.ly-line', $('#ly-list'));
    els.forEach((el, k) => { el.classList.toggle('on', k === i); el.classList.toggle('past', k < i); el.style.setProperty('--d', Math.min(Math.abs(k - i), 6)); });
    const el = els[i];
    if (el) { const box = $('.ly-scroll'); $('#ly-list').style.transform = `translate3d(0,${Math.round(box.clientHeight * 0.38 - el.offsetTop - el.offsetHeight / 2)}px,0)`; }
  }
  function karaoke(now) {
    requestAnimationFrame(karaoke);
    const dt = Math.min(0.1, (now - (lastRaf || now)) / 1000); lastRaf = now;
    if (!P.cur || !lines.length || document.hidden || !$('#np').classList.contains('open') || !$('#lyrics').classList.contains('on')) return;
    if (P.playing) smooth += dt;
    if (Math.abs(smooth - P.time) > 0.3 || !P.playing) smooth = P.time;
    const t = smooth * ratio() + offset() + 0.15;
    const save = P.time; P.time = smooth; tickLyrics(); P.time = save;
    const l = lines[lastLine]; if (!l || !l.words) return;
    if (!wordEls) { const el = $('.ly-line.on', $('#ly-list')); wordEls = el ? [...el.querySelectorAll('.w')] : []; }
    let sig = '';
    for (let k = 0; k < wordEls.length; k++) {
      const w = l.words[k]; if (!w) break;
      const p = t >= w.e ? 100 : t <= w.s ? 0 : Math.round((t - w.s) / (w.e - w.s) * 50) * 2;
      sig += p + ',';
      const el = wordEls[k];
      if (el._p !== p) { el._p = p; el.style.setProperty('--p', p + '%'); el.classList.toggle('cur', p > 0 && p < 100); el.classList.toggle('sung', p === 100); }
    }
    lastP = sig;
  }
  requestAnimationFrame(karaoke);
  $('#ly-list').addEventListener('click', (e) => { const l = e.target.closest('[data-l]'); if (l && lines[+l.dataset.l]) { P.seek(Math.max(0, (lines[+l.dataset.l].t - offset()) / ratio())); lastLine = -2; } });
  const paintOffset = () => { const o = offset(); $('#ly-off').textContent = o ? (o > 0 ? '+' : '') + o.toFixed(1).replace('.', ',') + ' с' : 'синхр.'; };
  const nudge = (d) => { if (!P.cur) return; const k = key(P.cur); S.offsets[k] = d === 0 ? 0 : Math.round(((S.offsets[k] || 0) + d) * 10) / 10; save(); paintOffset(); lastLine = -2; };
  $('#ly-minus').onclick = () => nudge(-0.5); $('#ly-plus').onclick = () => nudge(0.5); $('#ly-off').onclick = () => nudge(0);

  // ───────── sleep timer ─────────
  let sleepAt = 0, sleepEnd = false; const STEPS = [15, 30, 60, 'end', 0]; let sleepStep = STEPS.length - 1;
  $('#np-sleep').onclick = () => {
    sleepStep = (sleepStep + 1) % STEPS.length; const v = STEPS[sleepStep];
    sleepEnd = v === 'end'; sleepAt = typeof v === 'number' && v ? Date.now() + v * 60000 : 0;
    $('#np-sleep').classList.toggle('on', !!(sleepAt || sleepEnd));
    $('#np-sleep-label').hidden = !(sleepAt || sleepEnd);
    toast(v === 0 ? 'Таймер сна выключен' : v === 'end' ? 'Пауза после этого трека' : 'Пауза через ' + v + ' мин');
  };
  function sleepTick() {
    const lab = $('#np-sleep-label');
    if (sleepAt) { lab.textContent = '☾ ' + Math.max(1, Math.ceil((sleepAt - Date.now()) / 60000)) + ' мин'; if (Date.now() >= sleepAt) stopSleep(); }
    if (sleepEnd) { lab.textContent = '☾ до конца трека'; if (P.dur && P.dur - P.time < 0.8 && P.time > 1) stopSleep(); }
  }
  function stopSleep() { sleepAt = 0; sleepEnd = false; sleepStep = STEPS.length - 1; $('#np-sleep').classList.remove('on'); $('#np-sleep-label').hidden = true; P.pause(); toast('Спокойной ночи — музыка на паузе'); }

  // ───────── accounts / settings ─────────
  async function scStatus() { const r = await ask({ t: 'sc', op: 'status', arg: '' }, 30000); if (r && typeof r.login === 'boolean') S.sc = { login: r.login, user: r.user }; refreshAccounts(); likesCache.at = 0; }
  function refreshAccounts() { if (!$('#modal').hidden && $('#acc-grid')) $('#acc-grid').innerHTML = accountsHTML(); }
  function accountsHTML() {
    const yt = S.account, sc = S.sc;
    return `<div class="acc yt"><span class="lg">${IC('yt', 22)}</span><div><b>YouTube Music</b><small class="${yt && yt.signedIn ? 'ok' : ''}">${!engineReady ? 'Подключаюсь…' : yt && yt.signedIn ? '✓ Вход выполнен' : 'Не выполнен вход'}</small></div>${yt && yt.signedIn ? '<button class="btn ghost" data-acc="yt-out">Сменить</button>' : '<button class="btn" data-acc="yt-in">Войти</button>'}</div>
      <div class="acc sc"><span class="lg">${IC('cloud', 22)}</span><div><b>SoundCloud</b><small class="${sc && sc.login ? 'ok' : ''}">${!sc ? 'Проверяю…' : sc.login ? '✓ ' + (sc.user || 'Подключён') : 'Не выполнен вход'}</small></div>${sc && sc.login ? '<button class="btn ghost" data-acc="sc-out">Выйти</button>' : '<button class="btn" data-acc="sc-in">Войти</button>'}</div>`;
  }
  function openModal(html, cls) {
    const m = $('#modal'); m.innerHTML = `<div class="sheet ${cls || ''}">${html}</div>`; m.hidden = false;
    requestAnimationFrame(() => m.classList.add('open'));
    m.onclick = (e) => { if (e.target === m) closeModal(); };
  }
  function closeModal() { const m = $('#modal'); m.classList.remove('open'); setTimeout(() => { m.hidden = true; m.innerHTML = ''; }, 250); }
  const THEMES = [['studio', 'Studio', ['#ff5a36', '#3a1d14', '#120d0b']], ['glass', 'Liquid Glass', ['#ff3d77', '#8b3dff', '#22d3ee']], ['material', 'Material', ['#d0bcff', '#381e72', '#1c1b1f']], ['holo', 'Android Holo', ['#33b5e5', '#000', '#0099cc']], ['aero', 'Windows 7 Aero', ['#8ec5f2', '#2b6cb5', '#dbeefd']]];
  const ACC = ['#ff5a36', '#ff3d77', '#ffc23d', '#3ddc84', '#22d3ee', '#3d8bff', '#8b3dff', '#e03dff'];
  const opt = (k, title, desc) => `<div class="opt" data-opt="${k}"><span><b>${title}</b><small>${desc}</small></span><span class="tg${S[k] ? ' on' : ''}"></span></div>`;
  function openSettings() {
    if (!S.sc) scStatus();
    openModal(`<div class="sheet-h"><span class="ic" style="color:var(--accent)">${IC('gear', 26)}</span><h2>Настройки</h2><span class="ver" id="ver">YouPlay</span><button class="ib" data-close>${IC('close')}</button></div>
      <div class="set-sec"><h3>Аккаунты</h3><div class="acc-grid" id="acc-grid">${accountsHTML()}</div></div>
      <div class="set-sec"><h3>Оформление</h3><div class="themes">${THEMES.map(([id, n, c]) => `<button class="th${S.theme === id ? ' on' : ''}" data-th="${id}"><div class="pv">${c.map((x) => `<i style="background:${x}"></i>`).join('')}</div><b>${n}</b></button>`).join('')}</div>
        <div class="accents">${ACC.map((c) => `<button style="background:${c}" class="${S.accent === c ? 'on' : ''}" data-ac="${c}"></button>`).join('')}</div></div>
      <div class="set-sec"><h3>Воспроизведение</h3>${opt('autoNP', 'Открывать «Сейчас играет» при запуске трека', 'Полноэкранный плеер с текстом и очередью')}${opt('audioOnly', 'Треки вместо клипов', 'YouTube Music всегда играет аудиоверсию')}${opt('adblock', 'Блокировка рекламы', 'Реклама в YouTube Music не показывается и не звучит')}</div>
      <div class="sheet-f"><span id="upd-st">Версия —</span><button class="btn" id="upd-check">${IC('update', 18)}Проверить обновления</button></div>`);
    host.send({ t: 'update', op: 'status' });
    const m = $('#modal');
    m.querySelector('[data-close]').onclick = closeModal;
    m.addEventListener('click', (e) => {
      const th = e.target.closest('[data-th]'); if (th) { S.theme = th.dataset.th; save(); applyTheme(); $$('.th', m).forEach((x) => x.classList.toggle('on', x === th)); }
      const ac = e.target.closest('[data-ac]'); if (ac) { S.accent = ac.dataset.ac; save(); applyTheme(); $$('[data-ac]', m).forEach((x) => x.classList.toggle('on', x === ac)); }
      const o = e.target.closest('[data-opt]'); if (o) { const k = o.dataset.opt; S[k] = !S[k]; save(); o.querySelector('.tg').classList.toggle('on', S[k]); if (k === 'audioOnly') host.send({ t: 'eng', cmd: 'audioOnly', value: S[k], id: rid() }); if (k === 'adblock') host.send({ t: 'adblock', value: S[k] }); }
      const a = e.target.closest('[data-acc]');
      if (a) { const v = a.dataset.acc; if (v === 'yt-in' || v === 'yt-out') host.send({ t: 'login', service: 'google' }); if (v === 'sc-in') host.send({ t: 'login', service: 'sc' }); if (v === 'sc-out') { host.send({ t: 'logout', service: 'sc' }); S.sc = { login: false }; likesCache.sc = []; refreshAccounts(); } }
    });
    $('#upd-check').onclick = () => { $('#upd-st').textContent = 'Проверяю…'; updPrompted = false; host.send({ t: 'update', op: 'check' }); };
  }

  // ───────── updates ─────────
  let updPrompted = false;
  function onUpdate(u) {
    const txt = { checking: 'Проверяю обновления…', none: 'У вас последняя версия ✓', available: 'Вышла версия ' + u.version, downloading: 'Скачиваю… ' + (u.percent || 0) + '%', installing: 'Устанавливаю…', error: 'Не удалось проверить обновления', dev: 'Тестовая копия' }[u.state] || '';
    if ($('#upd-st')) $('#upd-st').textContent = txt || ('Версия ' + u.current);
    if ($('#ver') && u.current) $('#ver').textContent = 'YouPlay ' + u.current;
    if (u.state === 'available' && !updPrompted) {
      updPrompted = true;
      openModal(`<div class="upd"><div class="uic">${IC('update', 32)}</div><h2>Вышло обновление YouPlay</h2><p id="upd-line">Версия ${esc(u.version)} (у вас ${esc(u.current)}). Вход и настройки сохранятся.</p><div class="bar"><i id="upd-bar"></i></div><div class="btns"><button class="btn ghost" id="upd-later">Позже</button><button class="btn" id="upd-go">Обновить сейчас</button></div></div>`, 'upd-sheet');
      $('#upd-later').onclick = closeModal; $('#upd-go').onclick = () => host.send({ t: 'update', op: 'now' });
    }
    if ($('#upd-line') && (u.state === 'downloading' || u.state === 'installing' || u.state === 'error')) {
      $('#upd-line').textContent = u.state === 'downloading' ? 'Скачиваю… ' + (u.percent || 0) + '%' : u.state === 'installing' ? 'Устанавливаю — YouPlay сейчас перезапустится' : 'Не получилось скачать обновление';
      $('#upd-bar').style.width = (u.state === 'installing' ? 100 : u.percent || 0) + '%';
      $('#upd-go').disabled = u.state !== 'error';
    }
  }

  // ───────── online / offline ─────────
  let online = true;   // the app decides from real results / the host, not from the page's guess
  function setOnline(v) {
    const was = online; online = v;
    document.body.classList.toggle('offline', !v); $('#offline').hidden = v;
    if (!was && v) { toast('Интернет снова есть'); homeData = null; if (route.name === 'home') render(); }
    if (was && !v && route.name === 'home') render();
  }
  addEventListener('online', () => setOnline(true)); addEventListener('offline', () => setOnline(false));
  $('#pl-play').innerHTML = IC('play', 26); $('#np-play').innerHTML = IC('play', 32);

  // ───────── keyboard ─────────
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.code === 'Space') { e.preventDefault(); P.toggle(); }
    else if (e.key === 'Escape') back();
    else if (e.key === 'F11') { e.preventDefault(); host.send({ t: 'window', op: 'fullscreen' }); }
    else if (e.ctrlKey && e.code === 'KeyF') { e.preventDefault(); if (matchMedia('(max-width: 820px)').matches) document.body.classList.add('searching'); $('#q').focus(); }
    else if (e.ctrlKey && e.code === 'KeyL') { e.preventDefault(); openNP(); setSheet('lyrics'); }
    else if (e.altKey && e.key === 'ArrowLeft') back();
    else if (e.key === 'ArrowRight' && e.ctrlKey) P.next(); else if (e.key === 'ArrowLeft' && e.ctrlKey) P.prev();
  });
  if ('mediaSession' in navigator) for (const [a, f] of [['play', () => P.resume()], ['pause', () => P.pause()], ['nexttrack', () => P.next()], ['previoustrack', () => P.prev()]]) { try { navigator.mediaSession.setActionHandler(a, f); } catch (_) {} }

  // ───────── start ─────────
  paintNav();
  setOnline(online);
  render();
  host.send({ t: 'ui-ready' });
  setTimeout(() => host.send({ t: 'update', op: 'status' }), 4000);
  window.__ypBack = back;
})();
