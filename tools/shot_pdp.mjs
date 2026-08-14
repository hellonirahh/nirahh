/* Walks the buying flow end to end: card -> product page -> add to bag -> drawer,
   capturing each step and reporting any console error or failed request. */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

const problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('response', r => { if (r.status() >= 400) problems.push(r.status() + ' ' + r.url()); });

await page.goto(BASE + '/edit.html', { waitUntil: 'networkidle' });
const href = await page.locator('.product-media').first().getAttribute('href');
console.log('first card links to:', href);

await page.locator('.product-media').first().click();
await page.waitForLoadState('networkidle');
console.log('landed on:', page.url());
console.log('title:', await page.title());
await page.screenshot({ path: '/tmp/pdp-top.png', clip: { x: 0, y: 0, width: 1440, height: 1000 } });
await page.screenshot({ path: '/tmp/pdp-full.png', fullPage: true });

await page.locator('#addToBag').click();
await page.waitForTimeout(700);
console.log('button now reads:', await page.locator('#addToBag').textContent());
console.log('bag count:', await page.locator('.bag-count').first().textContent());
await page.screenshot({ path: '/tmp/pdp-added.png', clip: { x: 0, y: 0, width: 1440, height: 1000 } });

await page.locator('.icon-btn.bag').click();
await page.waitForTimeout(700);
await page.screenshot({ path: '/tmp/pdp-drawer.png', clip: { x: 0, y: 0, width: 1440, height: 1000 } });
console.log('drawer subtotal:', await page.locator('.bag-total').textContent());

// The bag must survive a page change.
await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
console.log('bag count on homepage:', await page.locator('.bag-count').first().textContent());

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(page.url().replace('index.html', 'product.html?saree=teal-linen'), { waitUntil: 'networkidle' });
await page.screenshot({ path: '/tmp/pdp-phone.png', fullPage: true });

console.log('problems:', problems.length ? problems : 'none');
await browser.close();
