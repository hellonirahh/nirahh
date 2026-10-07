import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('storefront browser regressions', async (t) => {
  const executablePath = process.env.CHROME_PATH || (fs.existsSync(chrome) ? chrome : undefined);
  const browser = await chromium.launch({ executablePath });
  t.after(() => browser.close());

  async function newPage() {
    const context = await browser.newContext();
    t.after(() => context.close());
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'nirahh.test') return route.abort();
      const file = path.join(root, decodeURIComponent(url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(file)];
      await route.fulfill({ body: fs.readFileSync(file), contentType: type || 'application/octet-stream' });
    });
    return context.newPage();
  }

  await t.test('pages load on desktop and mobile without runtime errors or overflow', async () => {
    const page = await newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith('http://nirahh.test/') && response.status() >= 400) errors.push(response.url());
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const file of ['index.html', 'edit.html', 'note.html', 'story.html', 'product.html?saree=peacock-ombre', 'shipping-policy.html', 'return-damage-policy.html', 'privacy-policy.html']) {
        await page.goto('http://nirahh.test/' + file);
        await page.evaluate(async () => {
          await Promise.all(Array.from(document.images, image => {
            image.loading = 'eager';
            return image.decode();
          }));
        });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, file);
      }
    }
    assert.deepEqual(errors, []);
  });

  await t.test('cart persists, deduplicates and removes products', async () => {
    const page = await newPage();
    await page.goto('http://nirahh.test/product.html?saree=peacock-ombre');
    await page.locator('#addToBag').click();
    await page.reload();
    assert.match(await page.locator('#addToBag').textContent(), /In your bag/);
    assert.equal(await page.evaluate(() => NirahhBag.add('peacock-ombre')), false);
    await page.locator('#addToBag').click();
    await page.locator('.bag-remove').click();
    assert.equal(await page.evaluate(() => NirahhBag.items().length), 0);
    assert.equal(await page.evaluate(() => document.activeElement.matches('.bag-empty a')), true);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { NirahhBag.add('peacock-ombre'); NirahhBag.add('midnight-bloom'); NirahhBag.open(); });
    await page.locator('.bag-remove').first().click();
    assert.equal(await page.evaluate(() => document.activeElement.matches('.bag-remove')), true);
  });

  await t.test('cart survives denied storage access for the current page', async () => {
    for (const method of ['getItem', 'setItem']) {
      const page = await newPage();
      await page.addInitScript(method => { Storage.prototype[method] = () => { throw new Error('denied'); }; }, method);
      await page.goto('http://nirahh.test/product.html?saree=peacock-ombre');
      await page.locator('#addToBag').click();
      assert.equal(await page.evaluate(() => NirahhBag.items().length), 1);
      await page.evaluate(() => NirahhBag.remove('peacock-ombre'));
      assert.equal(await page.evaluate(() => NirahhBag.items().length), 0);
    }
  });

  await t.test('dialogs trap focus, restore it and close on navigation', async () => {
    const page = await newPage();
    await page.goto('http://nirahh.test/index.html');
    await page.locator('#tryOnBtn').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'modalClose');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.closest('.modal-actions') !== null), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'modalClose');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tryOnBtn');
    await page.locator('#tryOnBtn').click();
    await page.locator('#tryOnModal a').click();
    assert.equal(await page.locator('#tryOnModal').isVisible(), false);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    await page.locator('.icon-btn.bag').click();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.closest('#cartDrawer') !== null), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('bag')), true);
  });

  await t.test('mobile navigation closes on Escape and desktop resize', async () => {
    const page = await newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://nirahh.test/index.html');
    assert.equal(await page.locator('#siteNav').isVisible(), false);
    await page.locator('#navToggle').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#navToggle').getAttribute('aria-expanded'), 'false');
    await page.locator('#navToggle').click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => document.body.style.overflow !== 'hidden');
  });

  await t.test('Shopify try-on closes on its homepage anchor link', async () => {
    const page = await newPage();
    const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const modal = source.slice(source.indexOf('<!-- Try-on modal -->'), source.indexOf('<script src='));
    await page.route('http://nirahh.test/theme-modal.html', route => route.fulfill({
      contentType: 'text/html',
      body: `<button id="tryOnBtn">Try on</button>${modal}<script src="/shopify-theme/assets/dialog.js"></script><script src="/shopify-theme/assets/theme.js"></script>`
    }));
    await page.goto('http://nirahh.test/theme-modal.html');
    await page.locator('#tryOnBtn').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'modalClose');
    await page.locator('#tryOnModal a').click();
    assert.equal(await page.locator('#tryOnModal').isVisible(), false);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  });

  await t.test('prototype signup never claims to save an email', async () => {
    const page = await newPage();
    await page.goto('http://nirahh.test/index.html');
    await page.locator('#signupForm input').fill('audit@example.com');
    await page.locator('#signupForm button').click();
    assert.equal(await page.locator('#signupMsg').isVisible(), true);
    assert.match(await page.locator('#signupMsg').textContent(), /has not been saved/);
    assert.equal(new URL(page.url()).search, '');
  });

  await t.test('variant changes update price, sale price, availability and image', async () => {
    const page = await newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Shopify-rendered DOM contract; Liquid rendering itself requires a store preview.
    await page.setContent(`<div class="pdp-grid"><img id="pdpMain"><div class="pdp-info">
      <span data-variant-price></span><s data-variant-compare></s><p data-variant-stock></p>
      <form class="pdp-form"><select name="id">
        <option value="1" data-price="₹100" data-compare="₹120" data-stock="One piece only" data-available="true" data-image="/assets/images/product-1.png" data-alt="First">First</option>
        <option value="2" data-price="₹200" data-compare="" data-stock="in stock" data-available="true" data-image="/assets/images/product-2.png" data-alt="Second">Second</option>
        <option value="3" data-price="₹300" data-compare="" data-stock="Taken" data-available="false">Taken</option>
      </select><button name="add" data-add-label="Add to bag" data-sold-label="Taken"></button></form></div></div>`);
    await page.evaluate(() => { window.NirahhNavigation = function () {}; });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/theme.js') });
    assert.equal(await page.locator('[data-variant-price]').textContent(), '₹100');
    assert.equal(await page.locator('[data-variant-compare]').isVisible(), true);
    await page.locator('select').selectOption('2');
    assert.equal(await page.locator('[data-variant-price]').textContent(), '₹200');
    assert.equal(await page.locator('[data-variant-compare]').isVisible(), false);
    assert.equal(await page.locator('#pdpMain').getAttribute('alt'), 'Second');
    await page.locator('select').selectOption('3');
    assert.equal(await page.locator('[name=add]').isDisabled(), true);
    assert.equal(await page.locator('[data-variant-stock]').textContent(), 'Taken');
    await page.locator('select').selectOption('1');
    assert.equal(await page.locator('[name=add]').isEnabled(), true);
    assert.deepEqual(errors, []);
  });
});

test('shared dialog code and theme schemas stay valid', () => {
  assert.equal(fs.readFileSync(path.join(root, 'assets/js/dialog.js'), 'utf8'), fs.readFileSync(path.join(root, 'shopify-theme/assets/dialog.js'), 'utf8'));
  for (const file of fs.readdirSync(path.join(root, 'shopify-theme'), { recursive: true })) {
    const full = path.join(root, 'shopify-theme', file);
    if (file.endsWith('.json')) JSON.parse(fs.readFileSync(full, 'utf8'));
    if (file.endsWith('.liquid')) {
      for (const match of fs.readFileSync(full, 'utf8').matchAll(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/g)) JSON.parse(match[1]);
    }
  }
});

test('static asset references exist and cache hashes match', async () => {
  const { createHash } = await import('node:crypto');
  for (const file of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
    for (const match of fs.readFileSync(path.join(root, file), 'utf8').matchAll(/(?:src|href)="(assets\/[^"?]+)\?v=([0-9a-f]+)"/g)) {
      const hash = createHash('sha256').update(fs.readFileSync(path.join(root, match[1]))).digest('hex').slice(0, 8);
      assert.equal(match[2], hash, `${file}: ${match[1]}`);
    }
  }
});
