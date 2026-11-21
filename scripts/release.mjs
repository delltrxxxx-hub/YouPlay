// Publishes dist/ to a GitHub release v<version> (needs the GitHub CLI, logged in).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const v = JSON.parse(readFileSync('package.json', 'utf8')).version;
const notes = process.argv[2] || `YouPlay ${v}`;
execFileSync('gh', ['release', 'create', `v${v}`, `dist/YouPlay-Setup-${v}.exe`, 'dist/latest.yml', '--title', `YouPlay ${v}`, '--notes', notes], { stdio: 'inherit' });
