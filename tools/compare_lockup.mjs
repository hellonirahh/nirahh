// Screenshot the site's brand lockup at high resolution for comparison with the card.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 4 });
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('.brand').screenshot({ path: '/tmp/site-lockup.png' });
await browser.close();
console.log('wrote /tmp/site-lockup.png');
