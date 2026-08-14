import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const bad = [];
p.on('pageerror', e => bad.push(e.message));
p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
for (const [page, out] of [['index.html','home'],['edit.html','edit'],['note.html','note'],['story.html','story'],['product.html?saree=teal-linen','pdp']]) {
  await p.goto(`${BASE}/${page}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.screenshot({ path: `/tmp/c-${out}.png`, clip: { x: 0, y: 0, width: 1440, height: 1000 } });
}
console.log('problems:', bad.length ? bad : 'none');
await b.close();
