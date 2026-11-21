'use strict';
/* YouPlay — soundcloud.com in YouPlay's hidden window. The window opens a page with #yp=<op>:<id>:
   search → the site's own search results; likes → your likes (with like dates); like → presses ♥ on a track.
   The answer goes back to YouPlay as scdata:{json} through bridge.js. */
(function () {
  // not signed in: SoundCloud redirects to /signin and keeps our task only inside redirect_url
  const task = /#yp=(search|likes|like|unlike|status|sets|set|addto|create):([A-Za-z0-9_-]+)(?::([^&#]*))?/.exec(location.hash) || /#yp=(search|likes|like|unlike|status|sets|set|addto|create):([A-Za-z0-9_-]+)(?::([^&#]*))?/.exec(decodeURIComponent(location.search));
  if (!task) return;
  if (/^\/signin/.test(location.pathname) && task[1] !== 'search' && task[1] !== 'set') {
    const answer = () => { document.documentElement.dataset.ypMsg = JSON.stringify({ t: Date.now(), m: 'scdata:' + JSON.stringify({ id: task[2], op: task[1], login: false }) }); };
    if (document.documentElement) answer(); else document.addEventListener('DOMContentLoaded', answer, { once: true });
    return;
  }
  const [, op, id] = task; const arg = task[3] ? decodeURIComponent(task[3]) : '';
  const send = (obj) => { document.documentElement.dataset.ypMsg = JSON.stringify({ t: Date.now() + Math.random(), m: 'scdata:' + JSON.stringify({ id, op, ...obj }) }); };
  const big = (a) => (a ? a.replace(/-(large|t\d+x\d+|small|badge|tiny|mini|crop)\./, '-t500x500.') : '');
  const track = (t) => t && t.kind === 'track' && t.permalink_url ? {
    url: t.permalink_url, title: t.title || '', artist: (t.user && t.user.username) || '', art: big(t.artwork_url || (t.user && t.user.avatar_url)),
    duration: (t.full_duration || t.duration || 0) / 1000, created: t.created_at || null, plays: t.playback_count || 0,
    blocked: t.policy === 'BLOCK',
  } : null;
  const loggedIn = () => /(^|;\s*)oauth_token=/.test(document.cookie);

  const caps = [];
  addEventListener('message', (e) => { if (e.source === window && e.data && e.data.ypScCap) caps.push(e.data.ypScCap); });

  // cookie banner: choose the most private option (reject non-essential)
  const cookies = () => { const r = document.getElementById('onetrust-reject-all-handler'); if (r && r.offsetParent !== null) r.click(); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let done = false;
  const finish = (obj) => { if (done) return; done = true; send(obj); };

  async function doSearch() {
    for (let i = 0; i < 40 && !caps.some((c) => /\/search/.test(c.url)); i++) { cookies(); await wait(250); }
    const items = []; const seen = new Set();
    for (const c of caps) if (/\/search/.test(c.url)) for (const x of (c.json.collection || [])) { const t = track(x); if (t && !seen.has(t.url)) { seen.add(t.url); items.push(t); } }
    finish({ items: items.filter((t) => !t.blocked).slice(0, 30) });
  }

  async function doLikes() {
    await wait(1500);
    if (!loggedIn() || /\/signin/.test(location.pathname)) { finish({ login: false }); return; }
    const isLikes = (c) => /likes/.test(c.url);
    let last = -1;
    for (let i = 0; i < 60; i++) {   // scroll so the site keeps loading more likes, up to ~600 tracks
      cookies();
      const n = caps.filter(isLikes).reduce((a, c) => a + (c.json.collection || []).length, 0);
      const lastCap = caps.filter(isLikes).slice(-1)[0];
      if (n >= 600 || (lastCap && !lastCap.json.next_href && n > 0)) break;
      if (n === last && i > 10 && n > 0) break;
      last = n;
      scrollTo(0, document.documentElement.scrollHeight);
      await wait(700);
    }
    const items = []; const seen = new Set();
    for (const c of caps.filter(isLikes)) for (const x of (c.json.collection || [])) {
      const t = track(x.track || x);
      if (t && !seen.has(t.url)) { seen.add(t.url); t.likedAt = x.created_at || null; items.push(t); }
    }
    const me = caps.find((c) => /\/me(\?|$)/.test(c.url));
    finish({ login: true, user: (me && me.json && me.json.username) || '', items });
  }

  async function doStatus() {
    for (let i = 0; i < 16 && !caps.some((c) => /\/me(\?|$)/.test(c.url)); i++) await wait(250);
    const me = caps.find((c) => /\/me(\?|$)/.test(c.url));
    finish({ login: loggedIn(), user: (me && me.json && me.json.username) || '' });
  }
  async function doLike() {
    const want = op !== 'unlike';
    await wait(1200);
    if (!loggedIn()) { finish({ login: false }); return; }
    for (let i = 0; i < 30; i++) {
      cookies();
      const b = document.querySelector('.listenEngagement .sc-button-like, .soundActions .sc-button-like, .sc-button-like');
      if (b) {
        if (b.classList.contains('sc-button-selected') !== want) b.click();
        await wait(900);
        const now = b.classList.contains('sc-button-selected');
        finish({ ok: now === want, liked: now });
        return;
      }
      await wait(300);
    }
    finish({ ok: false });
  }

  // ── playlists ──
  const meId = () => { const me = caps.find((c) => /\/me(\?|$)/.test(c.url)); return me && me.json ? me.json.id : null; };
  const setOf = (p) => p && p.permalink_url ? { url: p.permalink_url, title: p.title || '', count: p.track_count || 0, art: big(p.artwork_url || (p.tracks && p.tracks[0] && p.tracks[0].artwork_url) || ''), owner: p.user && p.user.id, isAlbum: !!p.is_album } : null;
  async function doSets() {
    await wait(1200);
    if (!loggedIn() || /\/signin/.test(location.pathname)) { finish({ login: false }); return; }
    for (let i = 0; i < 30 && !caps.some((c) => /playlist/.test(c.url)); i++) { cookies(); await wait(300); }
    await wait(800);
    const items = [], seen = new Set(), me = meId();
    for (const c of caps) if (/playlist|library/.test(c.url)) for (const x of (c.json.collection || [])) {
      const p = setOf(x.playlist || x.system_playlist || x);
      if (p && !seen.has(p.url) && !p.isAlbum) { seen.add(p.url); p.mine = !me || p.owner === me; items.push(p); }
    }
    finish({ login: true, items });
  }
  async function doSet() {
    for (let i = 0; i < 40 && !caps.some((c) => /\/playlists\/\d+/.test(c.url) || /\/resolve/.test(c.url)); i++) { cookies(); await wait(250); }
    await wait(1500);
    const pc = caps.find((c) => c.json && c.json.kind === 'playlist') || caps.find((c) => c.json && c.json.tracks);
    if (!pc) { finish({ items: [] }); return; }
    const full = new Map();
    for (const c of caps) { const arr = Array.isArray(c.json) ? c.json : c.json.collection || c.json.tracks || []; for (const t of arr) if (t && t.kind === 'track' && t.title) full.set(t.id, t); }
    const items = [];
    for (const t of pc.json.tracks || []) { const tt = track(full.get(t.id) || t); if (tt && !tt.blocked) items.push(tt); }
    finish({ title: pc.json.title || '', art: big(pc.json.artwork_url || ''), items });
  }
  async function openAddModal() {
    await wait(1200);
    if (!loggedIn()) return null;
    for (let i = 0; i < 30; i++) {
      cookies();
      const more = document.querySelector('.listenEngagement .sc-button-more, .soundActions .sc-button-more');
      if (more) { more.click(); break; }
      await wait(300);
    }
    for (let i = 0; i < 20; i++) {
      const b = document.querySelector('.moreActions .sc-button-addtoset, .sc-button-addtoset, button[title*="playlist" i]');
      if (b) { b.click(); break; }
      await wait(250);
    }
    for (let i = 0; i < 30; i++) { const m = document.querySelector('.modal .addToPlaylistList, .modal .addToPlaylistModal, .addToPlaylist'); if (m) return document.querySelector('.modal') || m; await wait(250); }
    return null;
  }
  const t = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  async function doAddTo() {
    const m = await openAddModal();
    if (!m) { finish({ ok: false, login: loggedIn() }); return; }
    const want = arg.trim().toLowerCase();
    for (let i = 0; i < 20; i++) {
      const item = [...m.querySelectorAll('.addToPlaylistList__item, .addToPlaylistItem, li')].find((li) => t(li.querySelector('.addToPlaylistItem__titleLink, .addToPlaylistItem__title, a')).toLowerCase() === want);
      if (item) {
        const b = item.querySelector('.addToPlaylistButton, button');
        if (b && !b.classList.contains('sc-button-selected')) b.click();
        await wait(1000);
        finish({ ok: true });
        return;
      }
      await wait(300);
    }
    finish({ ok: false, error: 'not-found' });
  }
  async function doCreate() {
    const m = await openAddModal();
    if (!m) { finish({ ok: false, login: loggedIn() }); return; }
    const tab = [...m.querySelectorAll('.tabs__tab, a, button')].find((x) => /create a playlist|создать плейлист/i.test(t(x)));
    if (tab) tab.click();
    await wait(600);
    const input = m.querySelector('.createPlaylist input[type=text], input.textfield__input, input[type=text]');
    if (!input) { finish({ ok: false }); return; }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus(); setter.call(input, arg); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(400);
    const save = [...m.querySelectorAll('button')].find((b) => /^(save|сохранить)$/i.test(t(b)) && !b.disabled) || m.querySelector('.createPlaylist__saveButton, button[type=submit]');
    if (!save) { finish({ ok: false }); return; }
    save.click();
    await wait(1800);
    finish({ ok: true });
  }

  const ops = { search: () => doSearch(), likes: () => doLikes(), status: () => doStatus(), sets: () => doSets(), set: () => doSet(), addto: () => doAddTo(), create: () => doCreate() };
  const run = () => { (ops[op] || doLike)().catch((e) => finish({ error: String(e) })); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
})();
