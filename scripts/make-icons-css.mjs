// Generates extension/icons.css — the YouPlay icon set that replaces YouTube Music's icons.
// Icons are SVG masks painted with currentColor, so every theme recolours them.
import { writeFileSync } from 'node:fs';

const S = (d) => `<path d="${d}" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const F = (d) => `<path d="${d}" fill="#000"/>`;
const ICONS = {
  prev:    F('M6.5 5.5a1 1 0 0 1 1 1v11a1 1 0 1 1-2 0v-11a1 1 0 0 1 1-1z') + F('M18.4 6.1a1 1 0 0 1 .6.9v10a1 1 0 0 1-1.6.8l-7-5a1 1 0 0 1 0-1.6l7-5a1 1 0 0 1 1-.1z'),
  next:    F('M17.5 5.5a1 1 0 0 1 1 1v11a1 1 0 1 1-2 0v-11a1 1 0 0 1 1-1z') + F('M5.6 6.1a1 1 0 0 0-.6.9v10a1 1 0 0 0 1.6.8l7-5a1 1 0 0 0 0-1.6l-7-5a1 1 0 0 0-1-.1z'),
  play:    F('M8 5.7c0-.8.9-1.3 1.6-.9l9.6 6.3c.6.4.6 1.4 0 1.8l-9.6 6.3c-.7.4-1.6-.1-1.6-.9z'),
  pause:   F('M7.5 5h1.8c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5H7.5C6.7 19 6 18.3 6 17.5v-11C6 5.7 6.7 5 7.5 5zm7.2 0h1.8c.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5h-1.8c-.8 0-1.5-.7-1.5-1.5v-11c0-.8.7-1.5 1.5-1.5z'),
  volume:  F('M4 9.5h3l4.3-3.6c.6-.5 1.7-.1 1.7.8v10.6c0 .9-1.1 1.3-1.7.8L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z') + S('M16 9a4.5 4.5 0 0 1 0 6') + S('M18.8 6.3a8.5 8.5 0 0 1 0 11.4'),
  muted:   F('M4 9.5h3l4.3-3.6c.6-.5 1.7-.1 1.7.8v10.6c0 .9-1.1 1.3-1.7.8L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z') + S('M16.5 9.5l5 5') + S('M21.5 9.5l-5 5'),
  repeat:  S('M17 3l3 3-3 3') + S('M4 12v-1.5A4.5 4.5 0 0 1 8.5 6H20') + S('M7 21l-3-3 3-3') + S('M20 12v1.5a4.5 4.5 0 0 1-4.5 4.5H4'),
  repeat1: S('M17 3l3 3-3 3') + S('M4 12v-1.5A4.5 4.5 0 0 1 8.5 6H20') + S('M7 21l-3-3 3-3') + S('M20 12v1.5a4.5 4.5 0 0 1-4.5 4.5H4') + S('M11 10.5l1.2-.8V14.5'),
  shuffle: S('M16 4h4v4') + S('M4 19L20 4') + S('M20 16v4h-4') + S('M14.5 14.5L20 20') + S('M4 5l5 5'),
  heart:   S('M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10-7.5 10z'),
  heartOn: F('M12 20.6c-.2 0-.3 0-.5-.1C11.2 20.3 3.5 15.7 3.5 9.5a5.3 5.3 0 0 1 8.5-4.2 5.3 5.3 0 0 1 8.5 4.2c0 6.2-7.7 10.8-8 11-.2.1-.3.1-.5.1z'),
  broken:  S('M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10-7.5 10z') + S('M12 6.8l-1.6 3.6 3 1.8-1.6 3.4'),
  brokenOn: F('M12 20.6c-.2 0-.3 0-.5-.1C11.2 20.3 3.5 15.7 3.5 9.5a5.3 5.3 0 0 1 8.5-4.2 5.3 5.3 0 0 1 8.5 4.2c0 6.2-7.7 10.8-8 11-.2.1-.3.1-.5.1z'),
  dots:    F('M12 4.5a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zm0 5.7a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zm0 5.7a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z'),
  up:      S('M6 15l6-6 6 6'),
  down:    S('M6 9l6 6 6-6'),
  menu:    S('M4 7h16') + S('M4 12h10') + S('M4 17h16'),
  home:    S('M4 10.2L12 4l8 6.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z'),
  explore: S('M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z') + F('M15.9 8.1l-2 5.3-5.8 2.5 2-5.3z'),
  library: S('M5 4v16') + S('M9.5 4v16') + S('M14 5l5 14.5'),
  search:  S('M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z') + S('M15.5 15.5L20 20'),
};
const uri = (name) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${ICONS[name]}</svg>`)}")`;

// [selector, icon]
const MAP = [
  ['ytmusic-player-bar .previous-button yt-icon', 'prev'],
  ['ytmusic-player-bar .next-button yt-icon', 'next'],
  ['ytmusic-player-bar #play-pause-button yt-icon', 'play'],
  ['html[data-yp-playing="1"] ytmusic-player-bar #play-pause-button yt-icon', 'pause'],
  ['ytmusic-player-bar :is(.volume, .expand-volume) yt-icon', 'volume'],
  ['ytmusic-player-bar :is(.volume, .expand-volume):is([title*="Включить"], [title*="Unmute"]) yt-icon', 'muted'],
  ['ytmusic-player-bar .repeat yt-icon', 'repeat'],
  ['ytmusic-player-bar .repeat:is([title*="один"], [title*="одну"], [title*="One"], [title*="one"]) yt-icon', 'repeat1'],
  ['ytmusic-player-bar :is(.shuffle, .expand-shuffle) yt-icon', 'shuffle'],
  ['ytmusic-player-bar .expand-button yt-icon', 'up'],
  ['ytmusic-player-bar .toggle-player-page-button yt-icon', 'down'],
  ['ytmusic-like-button-renderer button:is([aria-label="Нравится"], [aria-label="Like"]) .ytSpecButtonShapeNextIcon', 'heart'],
  ['ytmusic-like-button-renderer button:is([aria-label="Нравится"], [aria-label="Like"])[aria-pressed="true"] .ytSpecButtonShapeNextIcon', 'heartOn'],
  ['ytmusic-like-button-renderer button:is([aria-label="Не нравится"], [aria-label="Dislike"]) .ytSpecButtonShapeNextIcon', 'broken'],
  ['ytmusic-like-button-renderer button:is([aria-label="Не нравится"], [aria-label="Dislike"])[aria-pressed="true"] .ytSpecButtonShapeNextIcon', 'brokenOn'],
  ['ytmusic-player-bar button:is([aria-label="Меню действий"], [aria-label="Action menu"]) .ytSpecButtonShapeNextIcon', 'dots'],
  ['ytmusic-nav-bar #guide-button yt-icon', 'menu'],
  ['ytmusic-search-box .search-icon yt-icon, ytmusic-search-box .search-button yt-icon', 'search'],
  [':is(#guide, #mini-guide) ytmusic-guide-section-renderer:first-of-type ytmusic-guide-entry-renderer:nth-of-type(1) yt-icon.guide-icon', 'home'],
  [':is(#guide, #mini-guide) ytmusic-guide-section-renderer:first-of-type ytmusic-guide-entry-renderer:nth-of-type(2) yt-icon.guide-icon', 'explore'],
  [':is(#guide, #mini-guide) ytmusic-guide-section-renderer:first-of-type ytmusic-guide-entry-renderer:nth-of-type(3) yt-icon.guide-icon', 'library'],
];

let css = `/* YouPlay icon set (generated by scripts/make-icons-css.mjs) */
html:not([data-yp-theme="classic"]) :is(${MAP.map(([s]) => s).join(',\n  ')}) {
  -webkit-mask: var(--yp-ic) center / 24px 24px no-repeat; mask: var(--yp-ic) center / 24px 24px no-repeat;
  background-color: currentColor !important; display: inline-block;
}
html:not([data-yp-theme="classic"]) :is(${MAP.map(([s]) => s).join(',\n  ')}) > * { opacity: 0 !important; }
html:not([data-yp-theme="classic"]) ytmusic-player-bar .repeat:is([title*="отключ"], [title*="off"]) yt-icon { opacity: .45; }
html:not([data-yp-theme="classic"]) ytmusic-like-button-renderer button[aria-pressed="true"] .ytSpecButtonShapeNextIcon { color: var(--yp-accent); background-color: var(--yp-accent) !important; }
html:not([data-yp-theme="classic"]) ytmusic-player-bar #play-pause-button yt-icon { -webkit-mask-size: 28px 28px; mask-size: 28px 28px; }
`;
const scope = (x) => x.startsWith('html') ? x.replace(/^html/, 'html:not([data-yp-theme="classic"])') : 'html:not([data-yp-theme="classic"]) ' + x;
for (const [sel, name] of MAP) css += sel.split(', ').map(scope).join(', ') + ` { --yp-ic: ${uri(name)}; }\n`;
writeFileSync('extension/icons.css', css);
console.log('icons.css', (css.length / 1024).toFixed(1) + ' KB');
