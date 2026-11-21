'use strict';
const { app, BrowserWindow, session, ipcMain, shell, nativeTheme, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const START_URL = 'https://music.youtube.com/';
const PARTITION = 'persist:youplay';

// ───────────────────────── Performance flags ─────────────────────────
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.setAppUserModelId('com.youplay.desktop');
Menu.setApplicationMenu(null);

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ───────────────────────── Settings store ─────────────────────────
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  theme: 'glass',          // glass | material | holo | aero | classic
  accent: '#ff3d77',
  visualizer: 'bars',      // bars | wave | glow | off
  subtitles: true,
  nowPlayingToast: true,
  adblock: true,
  bounds: { width: 1360, height: 860 },
  maximized: false,
};
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2)).catch(() => {});
  }, 300);
}

// Titlebar symbol colors per theme
const OVERLAY = {
  glass:    { color: '#00000000', symbolColor: '#ffffff' },
  material: { color: '#00000000', symbolColor: '#e6e1e5' },
  holo:     { color: '#00000000', symbolColor: '#33b5e5' },
  aero:     { color: '#00000000', symbolColor: '#ffffff' },
  classic:  { color: '#00000000', symbolColor: '#ffffff' },
};

// ───────────────────────── User agent (Google sign‑in friendly) ─────────────────────────
const chromeVer = process.versions.chrome;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer.split('.')[0]}.0.0.0 Safari/537.36`;
app.userAgentFallback = UA;

let win = null;
let themeCss = '';

function isAllowedHost(url) {
  try {
    const h = new URL(url).hostname;
    return /(^|\.)(youtube\.com|google\.com|google\.[a-z.]+|gstatic\.com|googleusercontent\.com|youtube-nocookie\.com|accounts\.youtube\.com)$/.test(h);
  } catch { return false; }
}

async function setupAdblock(ses) {
  if (!settings.adblock) return;
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const cache = path.join(app.getPath('userData'), 'adblock-engine.bin');
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cache,
      read: fs.promises.readFile,
      write: fs.promises.writeFile,
    });
    blocker.enableBlockingInSession(ses);
  } catch (e) {
    console.error('[YouPlay] adblock init failed:', e.message);
  }
}

function createWindow() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(UA);
  // strip Electron hints that make Google refuse sign‑in
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://accounts.google.com/*', 'https://*.google.com/*'] }, (d, cb) => {
    const h = d.requestHeaders;
    for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k) && /Electron/i.test(h[k])) delete h[k];
    cb({ requestHeaders: h });
  });
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'fullscreen', 'notifications', 'clipboard-sanitized-write', 'speaker-selection'].includes(perm)));

  const adblockReady = setupAdblock(ses);

  const { width, height, x, y } = settings.bounds;
  win = new BrowserWindow({
    width, height, x, y,
    minWidth: 960, minHeight: 600,
    show: false,
    title: 'YouPlay',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#07060b',
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...OVERLAY[settings.theme] || OVERLAY.glass, height: 40 },
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true,
      autoplayPolicy: 'no-user-gesture-required',
      v8CacheOptions: 'bypassHeatCheck',
    },
  });
  if (settings.maximized) win.maximize();

  themeCss = fs.readFileSync(path.join(__dirname, 'renderer', 'themes.css'), 'utf8');
  const wc = win.webContents;
  wc.setUserAgent(UA);

  wc.on('dom-ready', () => {
    if (!app.isPackaged) themeCss = fs.readFileSync(path.join(__dirname, 'renderer', 'themes.css'), 'utf8');
    wc.insertCSS(themeCss, { cssOrigin: 'author' }).catch(() => {});
  });
  win.once('ready-to-show', () => { win.show(); checkUpdates(); });
  // safety: show anyway after 4s
  setTimeout(() => { if (win && !win.isVisible()) win.show(); }, 4000);

  // navigation policy
  wc.setWindowOpenHandler(({ url }) => {
    if (/accounts\.google\.com/.test(url)) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isAllowedHost(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  // after sign in Google may land on youtube.com — bring back to YT Music
  wc.on('did-navigate', (_e, url) => {
    try {
      const u = new URL(url);
      if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') && (u.pathname === '/' || u.pathname.startsWith('/feed'))) wc.loadURL(START_URL);
    } catch {}
  });

  // persist bounds
  const persist = () => {
    if (!win || win.isDestroyed()) return;
    settings.maximized = win.isMaximized();
    if (!settings.maximized && !win.isMinimized()) settings.bounds = win.getBounds();
    saveSettings();
  };
  win.on('resize', persist); win.on('move', persist);
  win.on('maximize', persist); win.on('unmaximize', persist);

  // keyboard: F11 fullscreen, Ctrl+R reload, F12 devtools
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) { wc.reload(); e.preventDefault(); }
    else if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) { wc.toggleDevTools(); e.preventDefault(); }
    else if (input.alt && input.key === 'ArrowLeft') { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
  });

  adblockReady.finally(() => wc.loadURL(START_URL));
  win.on('closed', () => { win = null; });
  setupThumbar();
}

// ───────────────────────── Taskbar thumbnail buttons ─────────────────────────
let thumbIcons = null;
function pngIcon(n) { return nativeImage.createFromPath(path.join(__dirname, 'assets', 'thumb-' + n + '.png')); }
function setupThumbar(playing = false) {
  if (!win || process.platform !== 'win32') return;
  try {
    if (!thumbIcons) thumbIcons = {
      prev: pngIcon('prev'),
      play: pngIcon('play'),
      pause: pngIcon('pause'),
      next: pngIcon('next'),
    };
    if (thumbIcons.play.isEmpty()) return; 
    const send = (a) => () => win && win.webContents.send('yp:media', a);
    win.setThumbarButtons([
      { tooltip: 'Назад', icon: thumbIcons.prev, click: send('prev') },
      { tooltip: playing ? 'Пауза' : 'Играть', icon: playing ? thumbIcons.pause : thumbIcons.play, click: send('toggle') },
      { tooltip: 'Далее', icon: thumbIcons.next, click: send('next') },
    ]);
  } catch {}
}

// ───────────────────────── Auto update (GitHub Releases) ─────────────────────────
let updater = null;
function checkUpdates(manual = false) {
  if (!app.isPackaged) { if (manual) sendUpdate({ state: 'none', dev: true }); return; }
  try {
    if (!updater) {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = true;
      updater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
      updater.on('update-available', (i) => sendUpdate({ state: 'available', version: i.version }));
      updater.on('update-not-available', () => sendUpdate({ state: 'none' }));
      updater.on('download-progress', (p) => sendUpdate({ state: 'progress', percent: Math.round(p.percent) }));
      updater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', version: i.version }));
      updater.on('error', (e) => sendUpdate({ state: 'error', message: String(e && e.message || e).slice(0, 200) }));
    }
    updater.checkForUpdates().catch(() => {});
  } catch (e) { sendUpdate({ state: 'error', message: e.message }); }
}
let lastUpdate = null;
function sendUpdate(u) { lastUpdate = u; if (win && !win.isDestroyed()) win.webContents.send('yp:update', u); }

// ───────────────────────── Lyrics (LRCLIB) ─────────────────────────
const lyricsCache = new Map();
function cleanTitle(t) {
  return t.replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|lyrics|mv|m\/v|visualizer|remaster|hd|hq|live|клип|премьера)[^\)\]]*[\)\]]/gi, '')
          .replace(/\s*-\s*(official|lyric).*$/i, '')
          .replace(/\s+/g, ' ').trim();
}
async function lrc(urlPath) {
  const r = await fetch('https://lrclib.net' + urlPath, { headers: { 'User-Agent': 'YouPlay/' + app.getVersion() } });
  if (!r.ok) return null;
  return r.json();
}
ipcMain.handle('yp:lyrics', async (_e, { title, artist, album, duration }) => {
  const key = `${title}|${artist}`;
  if (lyricsCache.has(key)) return lyricsCache.get(key);
  const t = cleanTitle(title || '');
  const a = (artist || '').split(/,|&| feat\.| ft\.| x /i)[0].trim();
  let res = null;
  try {
    const q = new URLSearchParams({ track_name: t, artist_name: a });
    if (album) q.set('album_name', album);
    if (duration) q.set('duration', String(Math.round(duration)));
    res = await lrc('/api/get?' + q);
    if (!res || (!res.syncedLyrics && !res.plainLyrics)) {
      const list = await lrc('/api/search?' + new URLSearchParams({ track_name: t, artist_name: a }));
      let best = null;
      if (Array.isArray(list) && list.length) {
        const scored = list.map(x => ({ x, s: (x.syncedLyrics ? 10 : 0) - (duration ? Math.abs((x.duration || 0) - duration) : 0) }));
        scored.sort((p, q2) => q2.s - p.s);
        best = scored[0].x;
      }
      if (!best) {
        const list2 = await lrc('/api/search?' + new URLSearchParams({ q: `${t} ${a}` }));
        if (Array.isArray(list2)) best = list2.find(x => x.syncedLyrics) || list2[0] || null;
      }
      res = best;
    }
  } catch { res = null; }
  const out = res ? { synced: res.syncedLyrics || null, plain: res.plainLyrics || null, instrumental: !!res.instrumental } : null;
  if (lyricsCache.size > 200) lyricsCache.clear();
  lyricsCache.set(key, out);
  return out;
});

// ───────────────────────── IPC ─────────────────────────
ipcMain.handle('yp:get-settings', () => ({ ...settings, version: app.getVersion(), update: lastUpdate }));
ipcMain.handle('yp:set-settings', (_e, patch) => {
  const needReload = 'adblock' in patch && patch.adblock !== settings.adblock;
  Object.assign(settings, patch);
  saveSettings();
  if (patch.theme && win) {
    try { win.setTitleBarOverlay({ ...(OVERLAY[patch.theme] || OVERLAY.glass), height: 40 }); } catch {}
  }
  if (needReload) { app.relaunch(); app.exit(0); }
  return settings;
});
ipcMain.on('yp:playing', (_e, playing) => setupThumbar(!!playing));
ipcMain.on('yp:check-update', () => checkUpdates(true));
ipcMain.on('yp:install-update', () => { if (updater) updater.quitAndInstall(true, true); });
ipcMain.on('yp:open-external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});
app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  createWindow();
});
app.on('window-all-closed', () => app.quit());
