// Compare the built masthead/hero/pillars against the reference wireframe ratios.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';

// Measured from reference/wireframe.png (489px wide) via tools/measure_reference.py
const REF = { hero: 111 / 489, pillars: 41 / 489, firstScreen: 185 / 489 };

const browser = await chromium.launch();

for (const vp of [{ width: 1440, height: 900 }, { width: 1512, height: 982 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport: vp });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });

  const m = await page.evaluate(() => {
    const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    return {
      header: Math.round(rect('.site-header')?.height ?? 0),
      hero: Math.round(rect('.hero')?.height ?? 0),
      pillars: Math.round(rect('.pillars-band')?.height ?? 0),
      used: Math.round(rect('.pillars-band')?.bottom ?? 0),
      vh: window.innerHeight,
      vw: window.innerWidth,
    };
  });

  const pct = (v) => `${Math.round((v / m.vw) * 1000) / 10}%`;
  console.log(
    `${vp.width}x${vp.height}\n` +
    `  header ${m.header}px\n` +
    `  hero    ${m.hero}px  = ${pct(m.hero)} of width   (reference ${Math.round(REF.hero * 1000) / 10}% -> ${Math.round(REF.hero * m.vw)}px)\n` +
    `  pillars ${m.pillars}px  = ${pct(m.pillars)} of width   (reference ${Math.round(REF.pillars * 1000) / 10}% -> ${Math.round(REF.pillars * m.vw)}px)\n` +
    `  first screen used ${m.used}px of ${m.vh}px  (${Math.round((m.used / m.vh) * 100)}%)\n`
  );
  await page.close();
}

await browser.close();
