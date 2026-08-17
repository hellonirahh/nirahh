// Screenshot a single section:
//   node tools/shot_section.mjs .pov /tmp/pov.png [width] [page]
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const [selector, out, width = '1440', pageName = 'index.html'] = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 } });
await page.goto(`${BASE}/${pageName}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in')));
await page.waitForTimeout(300);
await page.locator(selector).screenshot({ path: out });
await browser.close();
console.log('wrote', out);
