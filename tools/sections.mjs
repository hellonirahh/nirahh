// Report the rendered height of every homepage section, as px and as a share of the viewport.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')));

const rows = await page.evaluate(() =>
  [...document.querySelectorAll('main > section, .site-header, .site-footer')].map((el) => ({
    name: el.className.split(' ').filter((c) => c !== 'section' && c !== 'reveal').join('.') || el.tagName.toLowerCase(),
    h: Math.round(el.getBoundingClientRect().height),
  }))
);

for (const r of rows) console.log(`${r.name.padEnd(22)} ${String(r.h).padStart(5)}px   ${(r.h / 900).toFixed(2)} screens`);

await browser.close();
