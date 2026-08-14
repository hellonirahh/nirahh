import { chromium } from 'playwright';
const U = 'https://outcomes-compromise-expand-facts.trycloudflare.com/';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const r = await p.goto(U, { waitUntil: 'networkidle', timeout: 45000 });
console.log('status:', r.status(), '| title:', await p.title());
await p.screenshot({ path: '/tmp/live-proof.png', clip: { x: 0, y: 0, width: 1440, height: 900 } });
await b.close();
