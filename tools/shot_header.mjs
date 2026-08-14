import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 3 });
await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.locator('.site-header').screenshot({ path: '/tmp/nav.png' });
const info = await p.$$eval('.site-nav a', els => els.map(e => {
  const s = getComputedStyle(e);
  return e.textContent.trim() + ' → ' + s.color + ' weight ' + s.fontWeight;
}));
console.log(info.join('\n'));
await b.close();
