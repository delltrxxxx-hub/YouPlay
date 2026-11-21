// YouPlay — YouTube Music main world helper: in-app navigation (no page reloads) and the current video id.
(function () {
  if (window.__ypYt) return; window.__ypYt = true;
  const app = () => document.querySelector('ytmusic-app');
  const nav = (endpoint) => { const a = app(); if (a) a.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } })); };
  addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.ypYt) return;
    const d = e.data;
    if (d.ypYt === 'nav' && /^[\w-]{6,20}$/.test(d.videoId || '')) nav({ watchEndpoint: d.playlistId ? { videoId: d.videoId, playlistId: d.playlistId } : { videoId: d.videoId } });
    if (d.ypYt === 'browse' && /^[\w-]{2,60}$/.test(d.browseId || '')) nav({ browseEndpoint: { browseId: d.browseId } });
  });
  let last = '';
  setInterval(() => {
    const p = document.getElementById('movie_player');
    let id = '';
    try { id = (p && p.getVideoData && p.getVideoData().video_id) || ''; } catch {}
    if (id && id !== last) { last = id; window.postMessage({ ypYtNow: id }, location.origin); }
  }, 700);
})();
