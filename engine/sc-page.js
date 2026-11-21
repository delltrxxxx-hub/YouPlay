'use strict';
/* YouPlay — soundcloud.com in YouPlay's hidden window. The window opens a page with #yp=<op>:<id>:
   search → the site's own search results; likes → your likes (with like dates); like → presses ♥ on a track.
   The answer goes back to YouPlay as scdata:{json} through bridge.js. */
(function () {
  // not signed in: SoundCloud redirects to /signin and keeps our task only inside redirect_url
  const task = /#yp=(search|likes|like|unlike|status):([A-Za-z0-9_-]+)/.exec(location.hash) || /#yp=(search|likes|like|unlike|status):([A-Za-z0-9_-]+)/.exec(decodeURIComponent(location.search));
  if (!task) return;
  if (/^\/signin/.test(location.pathname) && task[1] !== 'search') {
    const answer = () => { document.documentElement.dataset.ypMsg = JSON.stringify({ t: Date.now(), m: 'scdata:' + JSON.stringify({ id: task[2], op: task[1], login: false }) }); };
    if (document.documentElement) answer(); else document.addEventListener('DOMContentLoaded', answer, { once: true });
    return;
  }
  const [, op, id] = task;
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

  const run = () => { (op === 'search' ? doSearch : op === 'likes' ? doLikes : op === 'status' ? doStatus : doLike)().catch((e) => finish({ error: String(e) })); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
})();
