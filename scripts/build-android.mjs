// Builds dist/YouPlay-Android-<version>.apk without Gradle: javac + d8 + aapt2 + zipalign + apksigner.
//   node scripts/build-android.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const [maj, min, pat] = version.split('.').map(Number);
const versionCode = maj * 10000 + min * 100 + pat;
const SDK = join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
const BT = join(SDK, 'build-tools', readdirSync(join(SDK, 'build-tools')).sort().pop());
const PLATFORM = join(SDK, 'platforms', readdirSync(join(SDK, 'platforms')).sort().pop(), 'android.jar');
const JBR = 'C:\\Program Files\\Android\\Android Studio\\jbr\\bin';
const OUT = join('out', 'android');
const run = (exe, args, opts = {}) => execFileSync(exe, args, { stdio: 'inherit', ...opts });
const bat = (name, args) => run('cmd.exe', ['/c', join(BT, name), ...args], { env: { ...process.env, JAVA_HOME: join(JBR, '..'), PATH: JBR + ';' + process.env.PATH } });
console.log('YouPlay Android', version, '(' + versionCode + ')');

rmSync(OUT, { recursive: true, force: true });
for (const d of ['res/mipmap-mdpi', 'res/mipmap-hdpi', 'res/mipmap-xhdpi', 'res/mipmap-xxhdpi', 'res/mipmap-xxxhdpi', 'res/drawable', 'assets', 'gen', 'classes', 'dex'])
  mkdirSync(join(OUT, d), { recursive: true });

// 1. icons
const iconSvg = readFileSync('scripts/make-icon.mjs', 'utf8').match(/const svg = `([\s\S]*?)`;/)[1];
const png = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
for (const [d, s] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) writeFileSync(join(OUT, 'res', 'mipmap-' + d, 'ic_launcher.png'), png(iconSvg, s));
const glyph = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="${d}"/></svg>`;
const G = {
  ic_stat: 'M12 3v10.6A4 4 0 1 0 14 17V7h4V3z',
  ic_play: 'M8 5.7c0-.8.9-1.3 1.6-.9l9.6 6.3c.6.4.6 1.4 0 1.8l-9.6 6.3c-.7.4-1.6-.1-1.6-.9z',
  ic_pause: 'M7.5 5h1.8c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5H7.5C6.7 19 6 18.3 6 17.5v-11C6 5.7 6.7 5 7.5 5zm7.2 0h1.8c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5h-1.8c-.8 0-1.5-.7-1.5-1.5v-11c0-.8.7-1.5 1.5-1.5z',
  ic_next: 'M17.5 5.5a1 1 0 0 1 1 1v11a1 1 0 1 1-2 0v-11a1 1 0 0 1 1-1zM5.6 6.1a1 1 0 0 0-.6.9v10a1 1 0 0 0 1.6.8l7-5a1 1 0 0 0 0-1.6l-7-5a1 1 0 0 0-1-.1z',
  ic_prev: 'M6.5 5.5a1 1 0 0 1 1 1v11a1 1 0 1 1-2 0v-11a1 1 0 0 1 1-1zM18.4 6.1a1 1 0 0 1 .6.9v10a1 1 0 0 1-1.6.8l-7-5a1 1 0 0 1 0-1.6l7-5a1 1 0 0 1 1-.1z',
};
for (const [n, d] of Object.entries(G)) writeFileSync(join(OUT, 'res', 'drawable', n + '.png'), png(glyph(d), 72));

// 2. YouPlay's own interface (same app/ as Windows) + the hidden YouTube Music engine + SoundCloud helper
const NL = String.fromCharCode(10);
const E = (f) => readFileSync(join('engine', f), 'utf8');
const once = (flag, body) => `(function () {
const run = function () {
if (window.${flag}) return; window.${flag} = true;
${body}
};
if (document.documentElement) run(); else new MutationObserver(function (m, o) { if (document.documentElement) { o.disconnect(); run(); } }).observe(document, { childList: true });
})();`;
const keepAwake = `try {
  Object.defineProperty(Document.prototype, 'hidden', { get: () => false, configurable: true });
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible', configurable: true });
  document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
  window.addEventListener('pagehide', (e) => e.stopImmediatePropagation(), true);
} catch (e) {}`;
writeFileSync(join(OUT, 'assets', 'engine.js'), once('__ypEngLoaded', [keepAwake, E('shield.js'), E('engine.js')].join(NL)));
writeFileSync(join(OUT, 'assets', 'sc.js'), once('__ypScLoaded', ['window.chrome = window.chrome || {}; window.chrome.webview = { postMessage: (m) => window.YouPlayNative.postHost(String(m)) };', E('sc-bridge.js'), E('sc-main.js'), E('sc-page.js')].join(NL)));
mkdirSync(join(OUT, 'assets', 'app'), { recursive: true });
for (const f of readdirSync('app')) copyFileSync(join('app', f), join(OUT, 'assets', 'app', f));
for (const f of ['engine.js', 'sc.js']) run(process.execPath, ['--check', join(OUT, 'assets', f)]);
run(process.execPath, ['--check', join('app', 'app.js')]);

// 3. resources + manifest → base apk (+ R.java)
run(join(BT, 'aapt2.exe'), ['compile', '--dir', join(OUT, 'res'), '-o', join(OUT, 'res.zip')]);
run(join(BT, 'aapt2.exe'), ['link', '-o', join(OUT, 'base.apk'), '-I', PLATFORM, '--manifest', 'android/AndroidManifest.xml', join(OUT, 'res.zip'),
  '--java', join(OUT, 'gen'), '--min-sdk-version', '26', '--target-sdk-version', '35', '--version-code', String(versionCode), '--version-name', version,
  '-A', join(OUT, 'assets'), '--auto-add-overlay']);

// 4. Java → dex
mkdirSync(join(OUT, 'gen', 'com', 'youplay', 'app'), { recursive: true });
writeFileSync(join(OUT, 'gen', 'com', 'youplay', 'app', 'BuildConfig.java'), `package com.youplay.app;\npublic final class BuildConfig { public static final String VERSION = "${version}"; }\n`);
const sources = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.java')) sources.push(p); } };
walk('android/src'); walk(join(OUT, 'gen'));
run(join(JBR, 'javac.exe'), ['-encoding', 'UTF-8', '-source', '11', '-target', '11', '-nowarn', '-Xlint:-options', '-classpath', PLATFORM, '-d', join(OUT, 'classes'), ...sources]);
const classes = []; const walkc = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walkc(p); else if (p.endsWith('.class')) classes.push(p); } };
walkc(join(OUT, 'classes'));
bat('d8.bat', ['--release', '--min-api', '26', '--lib', PLATFORM, '--output', join(OUT, 'dex'), ...classes]);

// 5. add dex, align, sign (the signing key lives outside the repo and must stay the same for updates)
run(join(JBR, 'jar.exe'), ['uf', join(OUT, 'base.apk'), '-C', join(OUT, 'dex'), 'classes.dex']);
const keyDir = join(os.homedir(), '.youplay'); mkdirSync(keyDir, { recursive: true });
const ks = join(keyDir, 'youplay-android.jks'), passFile = join(keyDir, 'youplay-android-pass.txt');
if (!existsSync(ks)) {
  const pass = randomBytes(18).toString('base64url');
  writeFileSync(passFile, pass);
  run(join(JBR, 'keytool.exe'), ['-genkeypair', '-keystore', ks, '-alias', 'youplay', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '18250', '-storepass', pass, '-keypass', pass, '-dname', 'CN=YouPlay']);
}
const pass = readFileSync(passFile, 'utf8').trim();
const aligned = join(OUT, 'aligned.apk');
run(join(BT, 'zipalign.exe'), ['-f', '-p', '4', join(OUT, 'base.apk'), aligned]);
mkdirSync('dist', { recursive: true });
const final = join('dist', `YouPlay-Android-${version}.apk`);
bat('apksigner.bat', ['sign', '--ks', ks, '--ks-key-alias', 'youplay', '--ks-pass', 'pass:' + pass, '--key-pass', 'pass:' + pass, '--out', final, aligned]);
bat('apksigner.bat', ['verify', final]);
console.log('built', final, (statSync(final).size / 1024).toFixed(0) + ' KB');
