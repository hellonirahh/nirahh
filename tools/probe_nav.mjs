import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.goto('http://127.0.0.1:4321/index.html', { waitUntil: 'networkidle' });
const info = await p.$$eval('.site-nav a', els => els.map(e => {
  const s = getComputedStyle(e);
  return { text: e.textContent.trim(), color: s.color, weight: s.fontWeight, size: s.fontSize };
}));
console.log(info);
await b.close();
