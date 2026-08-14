// Click "Shop by moment" from the homepage and from a subpage, and confirm the
// moments panel lands clear of the sticky masthead.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const browser = await chromium.launch();

for (const from of ['index.html', 'note.html']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(`${BASE}/${from}`, { waitUntil: 'networkidle' });
  await page.click('.site-nav a[href="index.html#moments"]');
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => {
    const s = document.querySelector('#moments');
    const h = document.querySelector('.site-header');
    return {
      url: location.hash,
      sectionTop: Math.round(s.getBoundingClientRect().top),
      headerBottom: Math.round(h.getBoundingClientRect().bottom),
      titleTop: Math.round(s.querySelector('.section-title').getBoundingClientRect().top),
    };
  });

  console.log(
    `from ${from}: hash ${r.url}  section top ${r.sectionTop}px  ` +
    `masthead bottom ${r.headerBottom}px  heading at ${r.titleTop}px  ` +
    `${r.titleTop > r.headerBottom ? 'clear' : 'HIDDEN BEHIND HEADER'}  errors: ${errs.length || 'none'}`
  );
  await page.close();
}

await browser.close();
