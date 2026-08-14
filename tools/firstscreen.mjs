// Capture just the first screen (no scroll) to check how much it fills.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const browser = await chromium.launch();

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')));
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/nirahh-first.png' });

await browser.close();
console.log('wrote /tmp/nirahh-first.png');
