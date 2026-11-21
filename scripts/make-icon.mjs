// Generates build/icon.png (512) and build/icon.ico (16..256) + src/assets/icon.png
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff3d77"/>
      <stop offset="0.5" stop-color="#8b3dff"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".55"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".06"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glow" cx=".5" cy=".55" r=".5">
      <stop offset="0" stop-color="#fff" stop-opacity=".35"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="120" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="120" fill="url(#glow)"/>
  <circle cx="256" cy="264" r="150" fill="#fff" fill-opacity=".16" stroke="#fff" stroke-opacity=".6" stroke-width="10"/>
  <path d="M218 190 L338 264 L218 338 Z" fill="#fff" stroke="#fff" stroke-width="18" stroke-linejoin="round"/>
  <path d="M40 150 Q40 40 150 40 H362 Q472 40 472 150 V200 Q256 120 40 220 Z" fill="url(#gloss)"/>
  <rect x="17.5" y="17.5" width="477" height="477" rx="118.5" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3"/>
</svg>`;

const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

mkdirSync('build', { recursive: true });
mkdirSync('src/assets', { recursive: true });
writeFileSync('build/icon.png', render(512));
writeFileSync('src/assets/icon.png', render(256));

// ICO with embedded PNG images
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map(render);
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const o = 6 + i * 16;
  header.writeUInt8(s >= 256 ? 0 : s, o);
  header.writeUInt8(s >= 256 ? 0 : s, o + 1);
  header.writeUInt8(0, o + 2); header.writeUInt8(0, o + 3);
  header.writeUInt16LE(1, o + 4); header.writeUInt16LE(32, o + 6);
  header.writeUInt32LE(pngs[i].length, o + 8); header.writeUInt32LE(offset, o + 12);
  offset += pngs[i].length;
});
const ico = Buffer.concat([header, ...pngs]);
writeFileSync('build/icon.ico', ico);
writeFileSync('src/assets/icon.ico', ico);
// taskbar thumbnail toolbar icons
const thumbs = {
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6zm8-14v14h4V5z',
  next: 'M6 18l8.5-6L6 6zm9-12h2v12h-2z',
};
for (const [n, d] of Object.entries(thumbs)) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="${d}"/></svg>`;
  writeFileSync(`src/assets/thumb-${n}.png`, new Resvg(s, { fitTo: { mode: 'width', value: 32 } }).render().asPng());
}
console.log('icons generated');
