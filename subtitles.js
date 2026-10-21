// subtitles.js — pure SRT / WebVTT timing logic: decode, parse, transform, serialize. No DOM.
// Times are integer milliseconds. Only timing lines (and VTT inline <timestamps>) are rewritten;
// every other line — numbers, identifiers, text, tags, headers, NOTE/STYLE blocks — is kept byte for byte.

const TIME = String.raw`(?:\d+:)?\d{1,2}:\d{1,2}[,.]\d{1,3}`;
const TIMING_LINE = new RegExp(String.raw`^(\s*)(${TIME})(\s*-->\s*)(${TIME})(.*)$`);
const INLINE_TS = /<((?:\d+:)?\d{2}:\d{2}\.\d{3})>/g;

/** Decode file bytes: honour a UTF-8 / UTF-16 BOM, else strict UTF-8, else Windows-1252. */
export function decodeBytes(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(b.subarray(3)), encoding: 'UTF-8', bom: true };
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16 LE', bom: true };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16 BE', bom: true };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'UTF-8', bom: false };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252', bom: false };
  }
}

/** "01:02:03,5" / "02:03.500" → ms. Returns NaN when malformed. */
export function parseTime(str) {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?\s*$/.exec(str);
  if (!m) return NaN;
  const [, h = '0', mi, s, frac = '0'] = m;
  return ((+h * 60 + +mi) * 60 + +s) * 1000 + +frac.padEnd(3, '0');
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** ms → "HH:MM:SS,mmm" (SRT) or "HH:MM:SS.mmm" / "MM:SS.mmm" (VTT). */
export function formatTime(ms, format = 'srt', withHours = true) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const sep = format === 'vtt' ? '.' : ',';
  const tail = `${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
  return format === 'vtt' && !withHours && h === 0 ? tail : `${pad(h)}:${tail}`;
}

/**
 * Parse a user-typed signed offset into ms. Accepts "2.5", "-2,5", "+1", "-1:30", "-00:01:02,500".
 * Comma decimals are accepted for locales that type them. Returns NaN when malformed.
 */
export function parseOffset(str) {
  const s = String(str).trim().replace(/^−/, '-').replace(/\s+/g, '');
  const m = /^([+-]?)(.+)$/.exec(s);
  if (!m || !m[2]) return NaN;
  const sign = m[1] === '-' ? -1 : 1;
  const body = m[2];
  if (/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(body)) return sign * Math.round(Number(body.replace(',', '.')) * 1000);
  const t = parseTime(body);
  return Number.isNaN(t) ? NaN : sign * t;
}

const isBlank = (line) => line.trim() === '';

/** Parse SRT or VTT text into a document model that remembers every original line. */
export function parseSubtitles(text, nameHint = '') {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const eolMatch = /\r\n|\r|\n/.exec(text);
  const eol = eolMatch ? eolMatch[0] : '\n';
  const lines = text.split(/\r\n|\r|\n/);
  const firstLine = lines.find((l) => !isBlank(l)) || '';
  const format = /^WEBVTT(?:[ \t]|$)/.test(firstLine.trimStart()) || (/\.vtt$/i.test(nameHint) && !/^\d+\s*$/.test(firstLine)) ? 'vtt' : 'srt';

  const cues = [];
  let skipBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) { skipBlock = false; continue; }
    const blockStart = i === 0 || isBlank(lines[i - 1]);
    if (format === 'vtt' && blockStart && /^(?:WEBVTT|NOTE|STYLE|REGION)(?:[ \t]|$)/.test(line)) { skipBlock = true; continue; }
    if (skipBlock) continue;
    const m = TIMING_LINE.exec(line);
    if (!m) continue;
    const textStart = i + 1;
    let j = textStart;
    while (j < lines.length && !isBlank(lines[j]) && !TIMING_LINE.test(lines[j])
      && !(/^\s*\d+\s*$/.test(lines[j]) && j + 1 < lines.length && TIMING_LINE.test(lines[j + 1]))) j++;
    cues.push({
      line: i,
      lead: m[1], arrow: m[3], rest: m[5],
      start: parseTime(m[2]), end: parseTime(m[4]),
      startHours: /^\d+:\d+:\d+/.test(m[2]), endHours: /^\d+:\d+:\d+/.test(m[4]),
      textStart, textEnd: j,
      text: lines.slice(textStart, j).join('\n'),
    });
    i = j - 1;
  }
  return { format, eol, lines, cues };
}

/** Linear map new = round(scale × old + offset), applied to cues numbered >= fromCue (1-based). */
export function computeTiming(doc, { scale = 1, offset = 0, fromCue = 1 }) {
  const n = doc.cues.length;
  const starts = new Array(n);
  const ends = new Array(n);
  let clamped = 0, fixedEnds = 0, affected = 0, invisible = 0;
  const first = Math.max(1, Math.floor(fromCue)) - 1;
  for (let k = 0; k < n; k++) {
    const c = doc.cues[k];
    if (k < first) { starts[k] = c.start; ends[k] = c.end; continue; }
    affected++;
    let s = Math.round(scale * c.start + offset);
    let e = Math.round(scale * c.end + offset);
    if (s < 0 || e < 0) { clamped++; s = Math.max(0, s); e = Math.max(0, e); if (e === 0) invisible++; }
    if (e < s) { fixedEnds++; e = s; }
    starts[k] = s; ends[k] = e;
  }
  return { starts, ends, clamped, fixedEnds, affected, invisible, scale, offset, first };
}

/** Rebuild the file text with new times; everything else is untouched. */
export function serialize(doc, timing, { bom = false } = {}) {
  const out = doc.lines.slice();
  const { format } = doc;
  const map = (ms) => Math.max(0, Math.round(timing.scale * ms + timing.offset));
  for (let k = timing.first; k < doc.cues.length; k++) {
    const c = doc.cues[k];
    out[c.line] = `${c.lead}${formatTime(timing.starts[k], format, c.startHours)}${c.arrow}${formatTime(timing.ends[k], format, c.endHours)}${c.rest}`;
    if (format === 'vtt') {
      for (let i = c.textStart; i < c.textEnd; i++) {
        if (out[i].includes('<')) out[i] = out[i].replace(INLINE_TS, (all, t) => `<${formatTime(map(parseTime(t)), 'vtt', /^\d+:\d+:\d+/.test(t))}>`);
      }
    }
  }
  return (bom ? '\uFEFF' : '') + out.join(doc.eol);
}

/** Two-point sync: map old start oa → na and ob → nb. Returns { scale, offset } or { error }. */
export function twoPoint(oa, na, ob, nb) {
  if (ob === oa) return { error: 'The two cues start at the same time, so pick cues further apart.' };
  const scale = (nb - na) / (ob - oa);
  if (!(scale > 0)) return { error: 'The later cue must get a later time than the first cue.' };
  return { scale, offset: na - scale * oa };
}

/** Exact NTSC rates so 23.976 ↔ 24 conversions do not accumulate rounding error. */
export function fpsValue(v) {
  return { '23.976': 24000 / 1001, '29.97': 30000 / 1001, '59.94': 60000 / 1001 }[v] ?? Number(v);
}
