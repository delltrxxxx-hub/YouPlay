// Builds dist/YouPlay-Setup-<version>.exe and dist/latest.yml
//   node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import os from 'node:os';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
console.log('YouPlay', version);

// 1. icons
execFileSync(process.execPath, ['scripts/make-icon.mjs'], { stdio: 'inherit' });

// 2. syntax check of the app and engine scripts
for (const f of ['app/app.js', 'app/icons.js', 'engine/engine.js', 'engine/shield.js', 'engine/sc-bridge.js', 'engine/sc-main.js', 'engine/sc-page.js'])
  execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });

// 3. app window (C#, .NET Framework 4.8 + WebView2 SDK from nuget.org)
mkdirSync('out', { recursive: true });
const WV2 = '1.0.4370.26';
const wv2 = join('out', 'wv2-' + WV2);
if (!existsSync(join(wv2, 'lib', 'net462', 'Microsoft.Web.WebView2.Core.dll'))) {
  mkdirSync(wv2, { recursive: true });
  const res = await fetch(`https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WV2}/microsoft.web.webview2.${WV2}.nupkg`);
  if (!res.ok) throw new Error('nuget download failed: ' + res.status);
  writeFileSync(join(wv2, 'pkg.zip'), Buffer.from(await res.arrayBuffer()));
  execFileSync(join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', 'pkg.zip'], { cwd: wv2, stdio: 'inherit' });
}
mkdirSync('out/app', { recursive: true });
for (const f of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll'])
  writeFileSync(join('out/app', f), readFileSync(join(wv2, 'lib', 'net462', f)));
writeFileSync('out/app/WebView2Loader.dll', readFileSync(join(wv2, 'runtimes', 'win-x64', 'native', 'WebView2Loader.dll')));
writeFileSync('out/Launcher.cs', readFileSync('launcher/Launcher.cs', 'utf8').replaceAll('__VERSION__', version));
const csc = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(csc, ['/nologo', '/target:winexe', '/optimize+', '/platform:x64', '/win32icon:build\\icon.ico',
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Net.dll', '/r:System.Web.Extensions.dll',
  '/r:out\\app\\Microsoft.Web.WebView2.Core.dll', '/r:out\\app\\Microsoft.Web.WebView2.WinForms.dll',
  '/out:out\\app\\YouPlay.exe', 'out\\Launcher.cs'], { stdio: 'inherit' });

// 4. installer (NSIS from the electron-builder cache)
function findMakensis() {
  const roots = [join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'nsis')];
  const stack = [...roots];
  while (stack.length) {
    const d = stack.pop();
    if (!existsSync(d)) continue;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (n.toLowerCase() === 'makensis.exe' && d.toLowerCase().endsWith('bin')) return p;
      if (statSync(p).isDirectory()) stack.push(p);
    }
  }
  throw new Error('makensis not found');
}
// uninstall-key GUID that electron-builder used for YouPlay 1.0.0 (UUID v5 of the appId)
function uuidv5(name, ns) {
  const nsBytes = Buffer.from(ns.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(Buffer.concat([nsBytes, Buffer.from(name)])).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const oldGuid = uuidv5('com.youplay.desktop', '50e065bc-3134-11e6-9bab-38c9862bdaf3');
mkdirSync('dist', { recursive: true });
const setup = `YouPlay-Setup-${version}.exe`;
if (existsSync(join('dist', setup))) rmSync(join('dist', setup));
execFileSync(findMakensis(), ['/V2', `/DVERSION=${version}`, `/DOLDGUID=${oldGuid}`, 'installer.nsi'], { cwd: 'installer', stdio: 'inherit' });

// 5. latest.yml — lets YouPlay 1.0.0 (Electron auto-updater) migrate to this version
const buf = readFileSync(join('dist', setup));
const sha512 = createHash('sha512').update(buf).digest('base64');
writeFileSync('dist/latest.yml', `version: ${version}
files:
  - url: ${setup}
    sha512: ${sha512}
    size: ${buf.length}
path: ${setup}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'
`);
console.log(`built dist/${setup} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
