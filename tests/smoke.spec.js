// smoke.spec.js — tool-specific checks for Subtitle Timing Shifter, on fictional fixtures in tests/fixtures/.
// Extra fixtures (paper-moon-cafe.srt/.vtt, cafe-cp1252.srt) come from tests/tools/make-fixtures.js.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const fixture = (name) => path.join(__dirname, 'fixtures', name);
const rows = (page) => page.locator('#preview tbody tr');
const cell = (page, row, col) => rows(page).nth(row).locator('td').nth(col);

async function loadFile(page, name) {
  await page.goto('./');
  await page.setInputFiles('#file-input', fixture(name));
  await expect(page.locator('#summary')).toBeVisible();
}

async function download(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const text = fs.readFileSync(await dl.path(), 'utf8');
  return { name: dl.suggestedFilename(), text, size: Buffer.byteLength(text) };
}

test.describe('Subtitle Timing Shifter', () => {
  test('empty state shows an example and the example button loads it', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('#empty')).toContainText('00:00:05,000');
    await expect(page.locator('#output')).toBeHidden();
    await page.click('#try-example');
    await expect(cell(page, 0, 1)).toHaveText('00:00:03,000');
    await expect(cell(page, 0, 2)).toHaveText('00:00:01,000');
  });

  test('sample.srt shifted by +2.5 s moves cue 1 from 00:00:01,000 to 00:00:03,500 and downloads', async ({ page }) => {
    await loadFile(page, 'sample.srt');
    await page.fill('#offset', '2.5');
    await expect(cell(page, 0, 1)).toHaveText('00:00:01,000');
    await expect(cell(page, 0, 2)).toHaveText('00:00:03,500');
    await expect(page.locator('#summary')).toContainText('3 cues');
    await expect(page.locator('#summary')).toContainText('+2.5 s');
    const out = await download(page);
    expect(out.name).toBe('sample.synced.srt');
    expect(out.text).toContain('1\n00:00:03,500 --> 00:00:06,000\nHello and welcome.');
    expect(out.text).toContain('00:00:09,750 --> 00:00:11,500\nGoodbye!');
  });

  test('a negative shift below zero clamps to 00:00:00 and shows a warning', async ({ page }) => {
    await loadFile(page, 'sample.srt');
    await page.fill('#offset', '-2');
    await expect(cell(page, 0, 2)).toHaveText('00:00:00,000');
    await expect(cell(page, 1, 2)).toHaveText('00:00:02,000');
    const warn = page.locator('#warnings');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('1 cue would start before 00:00:00 and was clamped to zero');
    const out = await download(page);
    expect(out.text).toContain('00:00:00,000 --> 00:00:01,500');
    expect(out.text).not.toMatch(/-\d/);
  });

  test('two-point sync of the first and last cue rescales the middle cue', async ({ page }) => {
    await loadFile(page, 'sample.srt');
    await page.click('#tab-sync');
    await expect(page.locator('#sync-a-num')).toHaveValue('1');
    await expect(page.locator('#sync-b-num')).toHaveValue('3');
    await page.fill('#sync-a-time', '00:00:02,000');
    await page.fill('#sync-b-time', '00:00:13.500'); // dot milliseconds are accepted too
    // scale = (13500 - 2000) / (7250 - 1000) = 1.84, offset = 2000 - 1.84 * 1000 = 160
    await expect(cell(page, 0, 2)).toHaveText('00:00:02,000');
    await expect(cell(page, 1, 2)).toHaveText('00:00:07,520'); // 1.84 * 4000 + 160
    await expect(cell(page, 2, 2)).toHaveText('00:00:13,500');
    await expect(page.locator('#summary')).toContainText('×1.840000');
    const out = await download(page);
    expect(out.text).toContain('00:00:07,520 --> 00:00:11,200'); // end 1.84 * 6000 + 160
  });

  test('preview table shows index, old start, new start and text side by side', async ({ page }) => {
    await loadFile(page, 'paper-moon-cafe.srt');
    await expect(page.locator('#preview thead th')).toHaveText(['#', 'Old start', 'New start', 'Text']);
    await page.fill('#offset', '-2.0');
    await expect(rows(page)).toHaveCount(8);
    const first = await rows(page).first().locator('td').allTextContents();
    expect(first).toEqual(['1', '00:00:03,000', '00:00:01,000', 'Paper Moon Cafe']);
    const old = await cell(page, 4, 1).boundingBox();
    const neu = await cell(page, 4, 2).boundingBox();
    expect(Math.abs(old.y - neu.y)).toBeLessThan(2);
    expect(neu.x).toBeGreaterThan(old.x);
    await expect(cell(page, 4, 3)).toContainText('Only by the cat.');
  });

  test('VTT download keeps the format, header, notes, identifiers and cue settings', async ({ page }) => {
    await loadFile(page, 'paper-moon-cafe.vtt');
    await expect(page.locator('#loaded-info')).toContainText('WebVTT');
    await page.fill('#offset', '-2');
    await expect(cell(page, 0, 2)).toHaveText('00:00:01.000');
    const out = await download(page);
    expect(out.name).toBe('paper-moon-cafe.synced.vtt');
    expect(out.size).toBeGreaterThan(300);
    const original = fs.readFileSync(fixture('paper-moon-cafe.vtt'), 'utf8');
    expect(out.text.startsWith('WEBVTT - Paper Moon Cafe\nKind: captions\n\nNOTE Fictional demo file')).toBe(true);
    expect(out.text).toContain('cue-1\n00:00:01.000 --> 00:00:03.200 line:85% align:center\nPaper Moon Cafe');
    expect(out.text).toContain('<b>Last order!</b>');
    expect(out.text.split('\n').length).toBe(original.split('\n').length);
  });

  test('SRT download keeps .srt and sample.vtt keeps .vtt', async ({ page }) => {
    await loadFile(page, 'sample.vtt');
    await page.fill('#offset', '1');
    const vtt = await download(page);
    expect(vtt.name).toBe('sample.synced.vtt');
    expect(vtt.text).toMatch(/^WEBVTT\n\n00:00:02\.000 --> 00:00:04\.500\n/);
    await page.setInputFiles('#file-input', fixture('sample.srt'));
    await expect(page.locator('#loaded-name')).toHaveText('sample.srt');
    const srt = await download(page);
    expect(srt.name).toBe('sample.synced.srt');
    expect(srt.text).toMatch(/^1\n00:00:02,000 --> 00:00:04,500\n/);
  });

  test('arrow keys step the offset by 0.1 s, Shift by 1 s, and buttons step too', async ({ page }) => {
    await loadFile(page, 'sample.srt');
    const field = page.locator('#offset');
    await field.fill('0');
    await field.press('ArrowUp');
    await field.press('ArrowUp');
    await expect(field).toHaveValue('0.2');
    await field.press('Shift+ArrowUp');
    await expect(field).toHaveValue('1.2');
    await field.press('Shift+ArrowDown');
    await field.press('ArrowDown');
    await expect(field).toHaveValue('0.1');
    await page.getByRole('button', { name: 'Plus 1 second' }).click();
    await expect(field).toHaveValue('1.1');
    await expect(cell(page, 0, 2)).toHaveText('00:00:02,100');
    await field.fill('-0,5'); // comma decimal separator
    await expect(cell(page, 0, 2)).toHaveText('00:00:00,500');
  });

  test('frame rate conversion scales by the ratio and only from the chosen cue', async ({ page }) => {
    await loadFile(page, 'sample.srt');
    await page.click('#tab-fps');
    await page.selectOption('#fps-from', '25');
    await page.selectOption('#fps-to', '24');
    await expect(cell(page, 2, 2)).toHaveText('00:00:07,552'); // 7250 * 25 / 24 = 7552.08
    await page.fill('#from-cue', '3');
    await expect(cell(page, 1, 2)).toHaveText('00:00:04,000');
    await expect(page.locator('#summary')).toContainText('cues 3–3 changed');
  });

  test('wrong file types are rejected, also when mixed with a valid file', async ({ page }) => {
    await page.goto('./');
    await page.setInputFiles('#file-input', fixture('sample.png'));
    await expect(page.locator('#results .alert--error')).toContainText('sample.png');
    await expect(page.locator('#output')).toBeHidden();
    // Drop a mix: the PNG is rejected, the SRT still loads.
    await page.evaluate(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' }));
      dt.items.add(new File(['1\n00:00:01,000 --> 00:00:02,000\nHi\n'], 'mixed.srt'));
      document.getElementById('dropzone').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    });
    await expect(page.locator('#results .alert--error')).toContainText('photo.png');
    await expect(page.locator('#loaded-name')).toHaveText('mixed.srt');
    await expect(rows(page)).toHaveCount(1);
  });

  test('Windows-1252 file with CRLF is decoded, saved as UTF-8 and keeps CRLF', async ({ page }) => {
    await loadFile(page, 'cafe-cp1252.srt');
    await expect(page.locator('#summary')).toContainText('saved as UTF-8');
    await expect(cell(page, 0, 3)).toHaveText('Café au lait');
    await page.fill('#offset', '0.5');
    const out = await download(page);
    expect(out.text).toBe('1\r\n00:00:01,500 --> 00:00:02,500\r\nCafé au lait\r\n\r\n2\r\n00:00:03,500 --> 00:00:04,500\r\nCrème brûlée\r\n');
  });

  test('pasted text works and Copy text puts the result on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('./');
    await page.fill('#paste', 'WEBVTT\n\n01:00.000 --> 01:02.500\n<v Narrator>Hello\n');
    await expect(page.locator('#loaded-name')).toHaveText('Pasted text');
    await page.fill('#offset', '-0.5');
    await expect(cell(page, 0, 2)).toHaveText('00:00:59.500');
    await page.click('#copy');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('WEBVTT\n\n00:59.500 --> 01:02.000\n<v Narrator>Hello\n');
  });

  test('invalid input shows an inline error instead of a broken file', async ({ page }) => {
    await loadFile(page, 'sample.srt');
    await page.fill('#offset', 'two seconds');
    await expect(page.locator('#results .alert--error')).toBeVisible();
    await expect(page.locator('#download')).toBeDisabled();
    await page.fill('#offset', '1');
    await expect(page.locator('#download')).toBeEnabled();
  });

  test('works at 390px wide without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadFile(page, 'paper-moon-cafe.vtt');
    await page.fill('#offset', '-2.0');
    for (const tab of ['#tab-offset', '#tab-sync', '#tab-fps']) {
      await page.click(tab);
      const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
      expect(w.doc).toBeLessThanOrEqual(w.win + 1);
    }
    await expect(page.locator('#download')).toBeVisible();
    const box = await page.locator('#download').boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const out = await download(page);
    expect(out.name).toBe('paper-moon-cafe.synced.vtt');
  });

  test('window.__demo shows the Paper Moon Cafe file fixed with a -2.0 s shift', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => window.__demo());
    await expect(page.locator('#loaded-name')).toHaveText('paper-moon-cafe.srt');
    await expect(cell(page, 0, 2)).toHaveText('00:00:01,000');
    await expect(page.locator('#summary')).toContainText('8 cues');
  });
});
