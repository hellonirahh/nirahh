// Capture full-page screenshots of the storefront for visual review.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const pages = [
  ['index.html', 'home'],
  ['edit.html', 'edit'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

for (const [path, name] of pages) {
  await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle' });
  // Trigger every scroll-reveal before capturing.
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `/tmp/nirahh-${name}.png`, fullPage: true });
  console.log('shot', name);
}

// Header close-up so the logo and wordmark can be checked.
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/nirahh-header.png', clip: { x: 0, y: 0, width: 1440, height: 560 } });
console.log('shot header');

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await phone.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')));
await phone.waitForTimeout(400);
await phone.screenshot({ path: '/tmp/nirahh-mobile.png', fullPage: true });
console.log('shot mobile');

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.reload({ waitUntil: 'networkidle' });
console.log('js errors:', errors.length ? errors : 'none');

await browser.close();
