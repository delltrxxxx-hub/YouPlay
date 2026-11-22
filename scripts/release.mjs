// Publishes dist/ to a GitHub release v<version> (needs the GitHub CLI, logged in).
// Every release carries both the Windows installer and the Android APK, so every installed copy
// (including older Android versions that only look at the latest release) can update.
// Releases are titled "Beta" but stay normal releases: installed copies update from "latest".
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const v = JSON.parse(readFileSync('package.json', 'utf8')).version;
const notes = process.argv[2] || `YouPlay ${v} Beta`;
const files = [`dist/YouPlay-Setup-${v}.exe`, 'dist/latest.yml', `dist/YouPlay-Android-${v}.apk`];
for (const f of files) if (!existsSync(f)) throw new Error('missing ' + f + ' — run npm run build and npm run build:android first');
execFileSync('gh', ['release', 'create', `v${v}`, ...files, '--title', `YouPlay ${v} Beta`, '--notes', notes], { stdio: 'inherit' });
