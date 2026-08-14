// Capture the masthead with The Edit's submenu open, plus the mobile menu.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const browser = await chromium.launch();

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.hover('.nav-item.has-menu');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/nav-open.png', clip: { x: 0, y: 0, width: 1440, height: 320 } });

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await phone.click('#navToggle');
await phone.waitForTimeout(600);
await phone.screenshot({ path: '/tmp/nav-mobile.png' });

const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
console.log('js errors:', errs.length ? errs : 'none');

await browser.close();
console.log('wrote /tmp/nav-open.png and /tmp/nav-mobile.png');
