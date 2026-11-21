// Publishes dist/ to a GitHub release v<version> (needs the GitHub CLI, logged in).
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const v = JSON.parse(readFileSync('package.json', 'utf8')).version;
const notes = process.argv[2] || `YouPlay ${v}`;
const files = [`dist/YouPlay-Setup-${v}.exe`, 'dist/latest.yml'];
if (existsSync(`dist/YouPlay-Android-${v}.apk`)) files.push(`dist/YouPlay-Android-${v}.apk`);
execFileSync('gh', ['release', 'create', `v${v}`, ...files, '--title', `YouPlay ${v}`, '--notes', notes], { stdio: 'inherit' });
