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

// 2. extension version
const mf = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
mf.version = version;
writeFileSync('extension/manifest.json', JSON.stringify(mf, null, 2) + '\n');

// 3. launcher (C#, .NET Framework 4 — present on every Windows 10/11)
mkdirSync('out', { recursive: true });
writeFileSync('out/Launcher.cs', readFileSync('launcher/Launcher.cs', 'utf8').replaceAll('__VERSION__', version));
const csc = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(csc, ['/nologo', '/target:winexe', '/optimize+', '/win32icon:build\\icon.ico', '/r:System.Windows.Forms.dll', '/out:out\\YouPlay.exe', 'out\\Launcher.cs'], { stdio: 'inherit' });

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
