// app.js — Subtitle Timing Shifter UI (ES module). Everything runs on the device; no network requests.
import { toast, downloadBlob, formatBytes, wireDropzone } from './site.js';
import { decodeBytes, parseSubtitles, computeTiming, serialize, formatTime, parseTime, parseOffset, twoPoint, fpsValue } from './subtitles.js';

const $ = (id) => document.getElementById(id);
const zone = $('dropzone');
const input = $('file-input');
const paste = $('paste');
const results = $('results');
const output = $('output');
const empty = $('empty');
const tbody = $('preview').querySelector('tbody');
const offsetInput = $('offset');
const fromCue = $('from-cue');
const syncA = { num: $('sync-a-num'), time: $('sync-a-time'), hint: $('sync-a-hint') };
const syncB = { num: $('sync-b-num'), time: $('sync-b-time'), hint: $('sync-b-hint') };
const fpsFrom = $('fps-from');
const fpsTo = $('fps-to');
const downloadBtn = $('download');
const copyBtn = $('copy');
const showAllBtn = $('show-all');
const tabs = [...document.querySelectorAll('[role="tab"]')];

const PREVIEW_ROWS = 20;
const ACCEPT = /\.(srt|vtt)$/i;

// Fictional example used by the empty state (the same film as tests/fixtures/paper-moon-cafe.srt).
const EXAMPLE = `1
00:00:03,000 --> 00:00:05,200
Paper Moon Cafe

2
00:00:06,000 --> 00:00:08,500
<i>Rain taps on the window.</i>

3
00:00:09,000 --> 00:00:11,800
One moon latte, please.
Extra cinnamon.

4
00:00:12,500 --> 00:00:15,000
We close at midnight,
but the moon stays open.
`;

const state = {
  doc: null,       // parsed document from subtitles.js
  name: '',        // file name used for the download
  size: 0,
  encoding: 'UTF-8',
  bom: false,
  fromPaste: false,
  loadErrors: [],  // messages about rejected or unreadable files
  notes: [],       // informational notes about the load (e.g. only the first file was used)
  mode: 'offset',
  showAll: false,
  timing: null,    // latest computeTiming() result, null when the inputs are invalid
};

// ---------- Loading ----------

async function handleFiles(files) {
  const valid = files.filter((f) => ACCEPT.test(f.name) || f.type === 'text/vtt' || f.type === 'application/x-subrip');
  const rejected = files.filter((f) => !valid.includes(f));
  state.loadErrors = rejected.length
    ? [`${rejected.map((f) => `“${f.name}”`).join(', ')} ${rejected.length === 1 ? 'is not a subtitle file' : 'are not subtitle files'}. Choose an .srt or .vtt file.`]
    : [];
  state.notes = valid.length > 1 ? [`One file at a time: using “${valid[0].name}”.`] : [];
  if (!valid.length) { render(); return; }
  const file = valid[0];
  try {
    const decoded = decodeBytes(await file.arrayBuffer());
    load(decoded.text, { name: file.name, size: file.size, encoding: decoded.encoding, bom: decoded.bom });
  } catch (err) {
    state.loadErrors.push(`Could not read “${file.name}”: ${err.message || err}.`);
    render();
  }
}

function load(text, { name, size, encoding = 'UTF-8', bom = false, fromPaste = false }) {
  const doc = parseSubtitles(text, name);
  if (!doc.cues.length) {
    state.doc = null;
    if (!fromPaste || text.trim()) state.loadErrors.push(fromPaste
      ? 'No subtitle cues found in the pasted text. Each cue needs a line like 00:00:01,000 --> 00:00:03,500.'
      : `No subtitle cues found in “${name}”. Is it an SRT or WebVTT file?`);
    render();
    return;
  }
  if (!fromPaste && paste.value) paste.value = '';
  if (fromPaste) name = doc.format === 'vtt' ? 'subtitles.vtt' : 'subtitles.srt';
  Object.assign(state, { doc, name, size, encoding, bom, fromPaste, showAll: false });
  const n = doc.cues.length;
  for (const el of [syncA.num, syncB.num, fromCue]) el.max = String(n);
  if (+fromCue.value > n) fromCue.value = '1';
  syncA.num.value = '1';
  syncB.num.value = String(n);
  syncA.time.value = cueTime(0);
  syncB.time.value = cueTime(n - 1);
  render();
  results.firstElementChild?.scrollIntoView({ block: 'nearest' });
}

function clearDoc() {
  Object.assign(state, { doc: null, timing: null, loadErrors: [], notes: [] });
  paste.value = '';
  render();
}

const cueTime = (k) => formatTime(state.doc.cues[k].start, state.doc.format);

// ---------- Computing ----------

function readInt(el, label, n) {
  const v = Number(el.value);
  if (!Number.isInteger(v) || v < 1) return { error: `${label} must be a whole number of 1 or more.` };
  if (v > n) return { error: `${label} is ${v}, but the file only has ${n} cue${n === 1 ? '' : 's'}.` };
  return { value: v };
}

/** Read the active mode's inputs → { scale, offset, fromCue, desc } or { error }. */
function readParams() {
  const n = state.doc.cues.length;
  const from = readInt(fromCue, 'Apply from cue number', n);
  if (from.error) return from;
  if (state.mode === 'offset') {
    const ms = parseOffset(offsetInput.value);
    if (Number.isNaN(ms)) return { error: 'Type the shift in seconds, for example 2.5 or -1,2.', field: offsetInput };
    return { scale: 1, offset: ms, fromCue: from.value, desc: `shift ${fmtOffset(ms)} s` };
  }
  if (state.mode === 'sync') {
    const a = readInt(syncA.num, 'First cue number', n);
    if (a.error) return a;
    const b = readInt(syncB.num, 'Later cue number', n);
    if (b.error) return b;
    if (b.value <= a.value) return { error: 'The later cue number must be bigger than the first cue number.', field: syncB.num };
    const na = parseTime(syncA.time.value);
    if (Number.isNaN(na)) return { error: 'Type the first cue’s correct start time like 00:01:02,500.', field: syncA.time };
    const nb = parseTime(syncB.time.value);
    if (Number.isNaN(nb)) return { error: 'Type the later cue’s correct start time like 00:41:10,500.', field: syncB.time };
    const r = twoPoint(state.doc.cues[a.value - 1].start, na, state.doc.cues[b.value - 1].start, nb);
    if (r.error) return r;
    return { ...r, fromCue: from.value, desc: `scale ×${r.scale.toFixed(6)}, then ${fmtOffset(Math.round(r.offset))} s` };
  }
  const src = fpsFrom.value, dst = fpsTo.value;
  const scale = fpsValue(src) / fpsValue(dst);
  return { scale, offset: 0, fromCue: from.value, desc: `${src} → ${dst} fps, scale ×${scale.toFixed(6)}` };
}

function fmtOffset(ms) {
  const s = (Math.abs(ms) / 1000).toFixed(3).replace(/(\.\d)0+$/, '$1').replace(/(\.\d*?[1-9])0+$/, '$1');
  return `${ms < 0 ? '−' : '+'}${s}`;
}

/** Offset value for the text field (ASCII minus so it can be typed back). */
function offsetFieldValue(ms) {
  return fmtOffset(ms).replace('+', '').replace('−', '-');
}

// ---------- Rendering ----------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function render() {
  const { doc } = state;
  results.replaceChildren();
  for (const msg of state.loadErrors) results.append(el('div', 'alert alert--error', msg));
  for (const field of document.querySelectorAll('[aria-invalid="true"]')) field.removeAttribute('aria-invalid');

  $('loaded').hidden = !doc;
  output.hidden = !doc;
  empty.hidden = Boolean(doc);
  if (!doc) { state.timing = null; return; }

  const n = doc.cues.length;
  $('loaded-name').textContent = state.fromPaste ? 'Pasted text' : state.name;
  $('loaded-info').textContent = [
    doc.format === 'vtt' ? 'WebVTT' : 'SRT',
    `${n} cue${n === 1 ? '' : 's'}`,
    state.fromPaste ? null : formatBytes(state.size),
    state.fromPaste ? null : state.encoding,
  ].filter(Boolean).join(' · ');
  syncA.hint.textContent = cueHint(syncA.num.value);
  syncB.hint.textContent = cueHint(syncB.num.value);

  const params = readParams();
  if (params.error) {
    state.timing = null;
    results.append(el('div', 'alert alert--error', params.error));
    params.field?.setAttribute('aria-invalid', 'true');
    downloadBtn.disabled = copyBtn.disabled = true;
    renderTable(null);
    return;
  }
  const timing = computeTiming(doc, params);
  state.timing = timing;
  downloadBtn.disabled = copyBtn.disabled = false;
  downloadBtn.textContent = `Download ${syncedName()}`;

  const card = el('div', 'result sts-summary');
  const meta = el('div', 'result__meta');
  const range = params.fromCue > 1 ? `cues ${params.fromCue}–${n} changed, 1–${params.fromCue - 1} kept` : 'all cues changed';
  meta.append(el('div', 'sts-summary__line stat', `${n} cue${n === 1 ? '' : 's'} · ${params.desc} · ${range}`));
  meta.id = 'summary';

  const warnings = [];
  if (timing.clamped) {
    warnings.push(`${timing.clamped} cue${timing.clamped === 1 ? '' : 's'} would start before 00:00:00 and ${timing.clamped === 1 ? 'was' : 'were'} clamped to zero.`
      + (timing.invisible ? ` ${timing.invisible} of them now end${timing.invisible === 1 ? 's' : ''} at 00:00:00 and will not be shown.` : ''));
  }
  if (timing.fixedEnds) warnings.push(`${timing.fixedEnds} cue${timing.fixedEnds === 1 ? '' : 's'} ended before ${timing.fixedEnds === 1 ? 'it' : 'they'} started, so the end was set to the start.`);
  const lastEnd = doc.cues.reduce((m, c) => Math.max(m, c.end), 0);
  if (params.scale === 1 && Math.abs(params.offset) > lastEnd && lastEnd > 0) {
    warnings.push(`The shift (${fmtOffset(params.offset)} s) is longer than the whole subtitle file (${formatTime(lastEnd, doc.format)}). Check the value.`);
  }
  if (warnings.length) {
    const list = el('ul', 'sts-warnings');
    list.id = 'warnings';
    for (const w of warnings) list.append(el('li', 'stat--warn', w));
    meta.append(list);
  }
  const notes = [...state.notes];
  if (state.encoding !== 'UTF-8' && !state.fromPaste) notes.push(`The file was ${state.encoding}; the download is saved as UTF-8.`);
  for (const note of notes) meta.append(el('div', 'result__info sts-note', note));
  card.append(meta);
  results.append(card);
  renderTable(timing);
}

function cueHint(numValue) {
  const k = Number(numValue) - 1;
  const cue = state.doc?.cues[k];
  if (!cue) return '';
  const text = cue.text.replace(/<[^>]*>/g, '').replace(/\s*\n\s*/g, ' ').trim();
  return `Cue ${k + 1} now starts at ${formatTime(cue.start, state.doc.format)}${text ? `: “${text.length > 60 ? `${text.slice(0, 60)}…` : text}”` : ''}`;
}

function renderTable(timing) {
  const { doc } = state;
  const n = doc.cues.length;
  const count = state.showAll ? n : Math.min(n, PREVIEW_ROWS);
  const frag = document.createDocumentFragment();
  for (let k = 0; k < count; k++) {
    const cue = doc.cues[k];
    const tr = document.createElement('tr');
    const newStart = timing ? timing.starts[k] : NaN;
    const changed = timing && newStart !== cue.start;
    if (timing && k < timing.first) tr.className = 'is-kept';
    tr.append(
      el('td', 'stat', String(k + 1)),
      el('td', 'mono sts-old', formatTime(cue.start, doc.format)),
      el('td', `mono sts-new${changed ? ' is-changed' : ''}`, timing ? formatTime(newStart, doc.format) : '—'),
    );
    const td = el('td', `sts-text${cue.text ? '' : ' is-empty'}`, cue.text || '(empty cue)');
    td.dir = 'auto';
    tr.append(td);
    frag.append(tr);
  }
  tbody.replaceChildren(frag);
  showAllBtn.hidden = n <= PREVIEW_ROWS;
  showAllBtn.textContent = state.showAll ? `Show first ${PREVIEW_ROWS} cues` : `Show all ${n} cues`;
}

// ---------- Output ----------

function syncedName() {
  const m = /^(.*?)(\.[^.]+)?$/.exec(state.name);
  const ext = state.doc.format === 'vtt' ? '.vtt' : (m[2] && ACCEPT.test(m[2]) ? m[2] : '.srt');
  return `${m[1] || 'subtitles'}.synced${ext}`;
}

function outputText() {
  return state.timing ? serialize(state.doc, state.timing, { bom: state.bom }) : null;
}

downloadBtn.addEventListener('click', () => {
  const text = outputText();
  if (text == null) return;
  const type = state.doc.format === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8';
  downloadBlob(new Blob([text], { type }), syncedName());
  toast(`Saved ${syncedName()}`);
});

copyBtn.addEventListener('click', async () => {
  const text = outputText();
  if (text == null) return;
  try {
    await navigator.clipboard.writeText(text.replace(/^\uFEFF/, ''));
  } catch {
    const ta = el('textarea');
    ta.value = text;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Synced subtitles copied');
});

showAllBtn.addEventListener('click', () => { state.showAll = !state.showAll; renderTable(state.timing); });

// ---------- Inputs ----------

function setMode(mode, focus = false) {
  state.mode = mode;
  for (const tab of tabs) {
    const on = tab.id === `tab-${mode}`;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !on;
    if (on && focus) tab.focus();
  }
  if (state.doc) render();
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => setMode(tab.id.slice(4)));
  tab.addEventListener('keydown', (e) => {
    const delta = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    let next = delta != null ? (i + delta + tabs.length) % tabs.length : null;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next == null) return;
    e.preventDefault();
    setMode(tabs[next].id.slice(4), true);
  });
});

function stepOffset(delta) {
  const cur = parseOffset(offsetInput.value);
  offsetInput.value = offsetFieldValue((Number.isNaN(cur) ? 0 : cur) + delta);
  if (state.doc) render();
}

offsetInput.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  stepOffset((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1000 : 100));
});
document.querySelectorAll('[data-step]').forEach((btn) => btn.addEventListener('click', () => stepOffset(Number(btn.dataset.step))));

for (const field of [offsetInput, fromCue, syncA.num, syncA.time, syncB.num, syncB.time, fpsFrom, fpsTo]) {
  field.addEventListener('input', () => { if (state.doc) render(); });
}

let pasteTimer = 0;
paste.addEventListener('input', () => {
  clearTimeout(pasteTimer);
  pasteTimer = setTimeout(() => {
    state.loadErrors = [];
    state.notes = [];
    if (!paste.value.trim()) { if (state.fromPaste) clearDoc(); else render(); return; }
    load(paste.value, { name: 'subtitles.srt', size: paste.value.length, fromPaste: true });
  }, 200);
});

$('clear').addEventListener('click', clearDoc);
$('try-example').addEventListener('click', () => {
  state.loadErrors = [];
  state.notes = [];
  setMode('offset');
  offsetInput.value = '-2.0';
  load(EXAMPLE, { name: 'paper-moon-cafe-example.srt', size: EXAMPLE.length });
});

wireDropzone(zone, input, handleFiles);
render();

// Called by the factory's screenshot script to show the tool in a realistic, fictional state.
window.__demo = async () => {
  const res = await fetch('./tests/fixtures/paper-moon-cafe.srt');
  const file = new File([await res.blob()], 'paper-moon-cafe.srt', { type: 'application/x-subrip' });
  setMode('offset');
  offsetInput.value = '-2.0';
  await handleFiles([file]);
};

export { handleFiles };
