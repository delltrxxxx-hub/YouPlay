// YouPlay background service worker: lyrics lookup, update check, ad-rule toggle.
const REPO = 'delltrxxxx-hub/YouPlay';
const VERSION = chrome.runtime.getManifest().version;

// ───────── settings-driven ad rules ─────────
async function syncAdRules() {
  const { adblock = true } = await chrome.storage.local.get('adblock');
  await chrome.declarativeNetRequest.updateEnabledRulesets(adblock ? { enableRulesetIds: ['ads'] } : { disableRulesetIds: ['ads'] });
}
chrome.runtime.onStartup.addListener(() => { syncAdRules(); checkUpdate(); });
chrome.runtime.onInstalled.addListener(() => { syncAdRules(); checkUpdate(); });

// ───────── updates (the YouPlay launcher installs them; here we only report) ─────────
const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
  return false;
};
async function checkUpdate() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const latest = String(j.tag_name || '').replace(/^v/, '');
    const u = latest && newer(latest, VERSION) ? { state: 'available', version: latest } : { state: 'none' };
    await chrome.storage.session.set({ update: u });
    return u;
  } catch { return { state: 'error' }; }
}

// ───────── lyrics (LRCLIB) ─────────
const cache = new Map();
const TEMPO_RE = /\s*[\(\[][^\)\]]*(slowed|sped|speed|reverb|nightcore|daycore|8d|bass boost)[^\)\]]*[\)\]]/gi;
function cleanTitle(t) {
  return t.replace(TEMPO_RE, '')
    .replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|lyrics|mv|m\/v|visualizer|remaster|hd|hq|клип|премьера)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(official|lyric).*$/i, '')
    .replace(/\s+/g, ' ').trim();
}
async function lrc(path) {
  const r = await fetch('https://lrclib.net' + path);
  if (!r.ok) return null;
  return r.json();
}
async function findLyrics({ title, artist, album, duration }) {
  const key = `${title}|${artist}|${Math.round(duration || 0)}`;
  if (cache.has(key)) return cache.get(key);
  const tempo = /(slowed|sped|speed|nightcore|daycore)/i.test(title);
  const t = cleanTitle(title || '');
  const a = (artist || '').split(/,| и | & | feat\.| ft\.| x /i)[0].trim();
  let res = null;
  try {
    if (!tempo) {
      const q = new URLSearchParams({ track_name: t, artist_name: a });
      if (album) q.set('album_name', album);
      if (duration) q.set('duration', String(Math.round(duration)));
      res = await lrc('/api/get?' + q);
    }
    if (!res || !res.syncedLyrics) {
      let list = await lrc('/api/search?' + new URLSearchParams({ track_name: t, artist_name: a }));
      if (!Array.isArray(list) || !list.length) list = await lrc('/api/search?' + new URLSearchParams({ q: `${t} ${a}` }));
      if (Array.isArray(list) && list.length) {
        // prefer synced lyrics with the closest length (for slowed/sped edits any length is fine — we rescale)
        // slowed/sped edits: take the most common length among results — that is the original recording
        let common = 0;
        if (tempo) { const n = {}; for (const x of list) if (x.syncedLyrics && x.duration) { const k = Math.round(x.duration); n[k] = (n[k] || 0) + 1; } common = +(Object.entries(n).sort((p, q) => q[1] - p[1])[0] || [0])[0]; }
        const target = tempo ? common : duration;
        const score = (x) => (x.syncedLyrics ? 1000 : 0) - (target ? Math.abs((x.duration || 0) - target) : 0);
        list.sort((p, q) => score(q) - score(p));
        res = list[0];
      }
    }
  } catch { res = null; }
  const out = res ? { synced: res.syncedLyrics || null, plain: res.plainLyrics || null, instrumental: !!res.instrumental, duration: res.duration || 0, tempo } : null;
  if (cache.size > 300) cache.clear();
  cache.set(key, out);
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'lyrics') { findLyrics(msg).then(reply, () => reply(null)); return true; }
  if (msg.type === 'sc-oembed') {
    fetch('https://soundcloud.com/oembed?format=json&url=' + encodeURIComponent(msg.url)).then((r) => (r.ok ? r.json() : null)).then(reply, () => reply(null));
    return true;
  }
  if (msg.type === 'check-update') { checkUpdate().then(reply); return true; }
  if (msg.type === 'update-status') { chrome.storage.session.get('update').then((s) => reply(s.update || null)); return true; }
  if (msg.type === 'adblock') { chrome.storage.local.set({ adblock: msg.on }).then(syncAdRules); return false; }
  return false;
});
