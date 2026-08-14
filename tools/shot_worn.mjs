import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.locator('.worn').scrollIntoViewIfNeeded();
await p.waitForTimeout(1000);
await p.locator('.worn').screenshot({ path: '/tmp/c-worn.png' });
await b.close();
