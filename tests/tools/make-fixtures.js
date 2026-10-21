// make-fixtures.js — writes the small, fictional subtitle fixtures used by smoke.spec.js and window.__demo.
// Run with: node tests/tools/make-fixtures.js
const fs = require('fs');
const path = require('path');

const out = (name) => path.join(__dirname, '..', 'fixtures', name);

// "Paper Moon Cafe", a fictional short film. Every cue is exactly two seconds late.
const cues = [
  [1000, 3200, 'Paper Moon Cafe'],
  [4000, 6500, '<i>Rain taps on the window.</i>'],
  [7000, 9800, 'One moon latte, please.\nExtra cinnamon.'],
  [10500, 13000, 'We close at midnight,\nbut the moon stays open.'],
  [13800, 16000, '- Is this seat taken?\n- Only by the cat.'],
  [16500, 19200, 'He has been waiting here\nsince the first snow.'],
  [20000, 22500, '<b>Last order!</b>'],
  [23000, 26000, 'See you under the paper moon.'],
];
const LATE = 2000;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const t = (ms, sep) => `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${sep}${pad(ms % 1000, 3)}`;

const srt = cues.map(([s, e, text], i) => `${i + 1}\n${t(s + LATE, ',')} --> ${t(e + LATE, ',')}\n${text}\n`).join('\n');
fs.writeFileSync(out('paper-moon-cafe.srt'), srt);

const vtt = 'WEBVTT - Paper Moon Cafe\nKind: captions\n\nNOTE Fictional demo file, all cues are two seconds late.\n\n'
  + cues.map(([s, e, text], i) => `cue-${i + 1}\n${t(s + LATE, '.')} --> ${t(e + LATE, '.')} line:85% align:center\n${text}\n`).join('\n');
fs.writeFileSync(out('paper-moon-cafe.vtt'), vtt);

// Windows line endings + Windows-1252 bytes (é = 0xE9) and no BOM, to test the encoding fallback.
const cp = '1\r\n00:00:01,000 --> 00:00:02,000\r\nCafé au lait\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nCrème brûlée\r\n';
fs.writeFileSync(out('cafe-cp1252.srt'), Buffer.from(cp, 'latin1'));

console.log('fixtures written');
