// Generates build/icon.png (512) and build/icon.ico (16..256) + src/assets/icon.png
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a221e"/>
      <stop offset="1" stop-color="#110d0b"/>
    </linearGradient>
    <linearGradient id="or" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff7448"/>
      <stop offset="1" stop-color="#f03c1c"/>
    </linearGradient>
    <mask id="tri" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
      <path d="M190 150 L190 362 L374 256 Z" fill="#fff" stroke="#fff" stroke-width="44" stroke-linejoin="round"/>
    </mask>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#bg)"/>
  <rect x="2" y="2" width="508" height="508" rx="114" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="4"/>
  <g mask="url(#tri)" fill="url(#or)">
    <rect x="150" y="124" width="260" height="38"/>
    <rect x="150" y="176" width="260" height="38"/>
    <rect x="150" y="228" width="260" height="56"/>
    <rect x="150" y="298" width="260" height="38"/>
    <rect x="150" y="350" width="260" height="38"/>
  </g>
</svg>`;

const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

mkdirSync('build', { recursive: true });
mkdirSync('extension/icons', { recursive: true });
writeFileSync('build/icon.png', render(512));
writeFileSync('app/logo.svg', svg);
for (const n of [16, 32, 48, 128]) writeFileSync(`extension/icons/${n}.png`, render(n));

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
console.log('icons generated');
