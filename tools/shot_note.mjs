// Screenshot the Nirahh Note article list, desktop and phone.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const browser = await chromium.launch();

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${BASE}/note.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')));
await page.waitForTimeout(400);
await page.locator('.article-list').screenshot({ path: '/tmp/note-list.png' });

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
await phone.goto(`${BASE}/note.html`, { waitUntil: 'networkidle' });
await phone.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')));
await phone.waitForTimeout(400);
await phone.locator('.article-list').screenshot({ path: '/tmp/note-list-mobile.png' });

console.log('js errors:', errs.length ? errs : 'none');
await browser.close();
