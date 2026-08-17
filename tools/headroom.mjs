// Measure, at many viewport widths, how much clear space sits above the
// subject's head in every cropped image on the page.
//
// Eyeballing screenshots misses the widths you did not happen to shoot. This
// reads the real box, the real object-position, and reports the headroom as a
// percentage of the visible box, so a negative number means the head is cut.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const WIDTHS = [1920, 1700, 1600, 1440, 1366, 1280, 1180, 1100, 1024, 980, 900, 820, 768, 600, 430, 390, 360];

// Hairline position as a fraction of the source image height, measured with
// tools/crop_positions.py.
const HEAD = {
  'hero.png': 0.156,
  'moment-monday.png': 0.209,
  'moment-important-room.png': 0.111,
  'moment-evening.png': 0.031,
  'moment-work-trip.png': 0.039,
  'moment-celebration.png': 0.011,
};

const browser = await chromium.launch();
const rows = [];

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')));
  await page.waitForTimeout(150);

  const measured = await page.evaluate((HEAD) => {
    const out = [];
    for (const img of document.querySelectorAll('img')) {
      const file = (img.currentSrc || img.src).split('/').pop().split('?')[0];
      const head = HEAD[file];
      if (head === undefined) continue;
      const bw = img.clientWidth;
      const bh = img.clientHeight;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!bw || !bh || !nw) continue;

      // object-fit: cover — the image scales so neither axis leaves a gap.
      const scale = Math.max(bw / nw, bh / nh);
      const sh = nh * scale;
      const overflowY = sh - bh;

      // object-position accepts percentages and lengths, and the computed
      // value reports "0" as "0px". Treating a length as a percentage was
      // wrong by the whole overflow, so handle both.
      const raw = (getComputedStyle(img).objectPosition.split(' ')[1] ?? '50%').trim();
      let top; // where the image's top edge sits, in box coordinates
      if (raw.endsWith('%')) top = -(parseFloat(raw) / 100) * overflowY;
      else top = parseFloat(raw) || 0;

      // Distance from the top of the visible box down to the hairline.
      const headroom = (head * sh + top) / bh;
      out.push({ file, box: `${Math.round(bw)}x${Math.round(bh)}`, headroom });
    }
    return out;
  }, HEAD);

  for (const m of measured) rows.push({ width, ...m });
  await page.close();
}

await browser.close();

const files = [...new Set(rows.map((r) => r.file))].sort();
process.stdout.write('width  ' + files.map((f) => f.replace('.png', '').padStart(22)).join('') + '\n');
process.stdout.write('-'.repeat(6 + files.length * 22) + '\n');

let worst = { headroom: 99 };
for (const width of WIDTHS) {
  let line = String(width).padEnd(7);
  for (const f of files) {
    const r = rows.find((x) => x.width === width && x.file === f);
    if (!r) { line += ''.padStart(22); continue; }
    if (r.headroom < worst.headroom) worst = { ...r, width };
    const flag = r.headroom < 0 ? ' CUT' : r.headroom < 0.02 ? ' tight' : '';
    line += `${(r.headroom * 100).toFixed(1)}%${flag}`.padStart(22);
  }
  process.stdout.write(line + '\n');
}

console.log(
  `\nWorst case: ${worst.file} at ${worst.width}px — ${(worst.headroom * 100).toFixed(1)}% ` +
  `headroom in a ${worst.box} box.`
);
console.log(worst.headroom < 0 ? 'FAIL — a head is cropped.' : 'PASS — every head is inside its box.');
