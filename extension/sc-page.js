'use strict';
/* YouPlay — runs on soundcloud.com inside the YouPlay search panel.
   Adds "Play in YouPlay" / "Add to queue" to every search result; SoundCloud's own play button
   also sends the track to YouPlay's shared queue instead of playing in this panel. */
(function () {
  if (!(window.chrome && chrome.runtime)) return;
  const inPanel = () => !!document.documentElement && navigator.userAgent.includes('Edg');
  const send = (m) => { document.documentElement.dataset.ypMsg = JSON.stringify({ t: Date.now() + Math.random(), m }); };
  const abs = (href) => { try { const u = new URL(href, location.origin); u.search = ''; u.hash = ''; return u.href; } catch { return ''; } };

  function trackUrl(root) {
    const a = root.querySelector('a.soundTitle__title[href]') || [...root.querySelectorAll('a.sc-link-primary[href], .soundTitle__titleContainer a[href]')].find((x) => (x.getAttribute('href') || '').split('/').filter(Boolean).length >= 2);
    return a && a.getAttribute('href') ? abs(a.getAttribute('href')) : '';
  }
  function mkBtn(text, cls, title, onClick) {
    const b = document.createElement('button');
    b.className = 'yp-scp-btn ' + cls; b.type = 'button'; b.title = title; b.textContent = text;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); }, true);
    return b;
  }
  function flash(b, text) { const t = b.textContent; b.textContent = text; b.classList.add('done'); setTimeout(() => { b.textContent = t; b.classList.remove('done'); }, 1400); }

  // cookie banner: choose the most private option (reject non-essential) so it stops covering the panel
  function cookies() {
    const r = document.getElementById('onetrust-reject-all-handler') || document.querySelector('.ot-pc-refuse-all-handler, #onetrust-pc-sdk .ot-pc-refuse-all-handler');
    if (r && r.offsetParent !== null) r.click();
  }
  function decorate() {
    cookies();
    for (const item of document.querySelectorAll('.searchList__item, .soundList__item, .trackList__item, .systemPlaylistTrackList__item')) {
      if (item.dataset.ypDone) continue;
      const url = trackUrl(item);
      if (!url || !/soundcloud\.com\/[^/]+\/[^/]+/.test(url)) continue;
      item.dataset.ypDone = '1';
      const bar = document.createElement('div');
      bar.className = 'yp-scp-bar';
      bar.append(
        mkBtn('▶  Играть в YouPlay', 'play', 'Включить сейчас в YouPlay', (b) => { send('scadd:now:' + url); flash(b, '✓ Играет'); }),
        mkBtn('+  В очередь', 'queue', 'Добавить в общую очередь YouPlay', (b) => { send('scadd:queue:' + url); flash(b, '✓ В очереди'); }));
      const host = item.querySelector('.soundTitle, .sound__header, .soundTitle__titleContainer') || item;
      host.after(bar);
    }
  }

  // SoundCloud's own play buttons in the list → play in YouPlay
  document.addEventListener('click', (e) => {
    const p = e.target.closest && e.target.closest('.sc-button-play, .playButton');
    if (!p) return;
    const item = p.closest('.searchList__item, .soundList__item, .trackList__item, .sound');
    const url = item ? trackUrl(item) : '';
    if (!url) return;
    e.preventDefault(); e.stopPropagation();
    send('scadd:now:' + url);
  }, true);

  function closeButton() {
    if (document.getElementById('yp-scp-close')) return;
    const c = document.createElement('button');
    c.id = 'yp-scp-close'; c.type = 'button'; c.title = 'Закрыть панель SoundCloud'; c.textContent = '×';
    c.addEventListener('click', () => send('search-close'));
    const tag = document.createElement('div');
    tag.id = 'yp-scp-tag'; tag.textContent = 'SoundCloud';
    document.documentElement.append(c, tag);
  }

  const start = () => {
    if (!inPanel()) return;
    document.documentElement.classList.add('yp-scp');
    closeButton(); decorate();
    new MutationObserver(() => { if (!start._t) start._t = setTimeout(() => { start._t = 0; decorate(); }, 200); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
