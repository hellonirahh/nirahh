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

  // Shopify-rendered DOM contract for the enabled fitting-room dialog
  // (snippets/tryon-dialog.liquid's settings.tryon_enabled branch). Hand-built
  // to match its ids/structure, following the same synthetic-contract
  // pattern already used below for the variant-sync test, since there is no
  // Shopify Liquid renderer available in CI.
  function tryonDialogFixture(signedIn, previewThemeId) {
    const config = JSON.stringify({ proxyPath: '/apps/nirahh-tryon', signedIn, loginUrl: '/account/login', previewThemeId: previewThemeId || '', locale: 'en', cartRoot: '/', cartUrl: '/cart' });
    return `
      <div class="modal" id="tryOnModal" hidden><div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="tryOnTitle">
        <button class="modal-close" id="modalClose" aria-label="Close" type="button">&times;</button>
        <div class="modal-body">
          <script type="application/json" id="tryonConfig">${config}</script>
          <h3 id="tryOnTitle" class="display">Fitting room</h3>
          <div class="tryon-saree" id="tryonSaree">
            <img class="tryon-saree-image" id="tryonSareeImage" alt="" hidden>
            <div class="tryon-saree-info"><p class="eyebrow">See yourself in it</p><p class="lead" id="tryonSareeTitle"></p></div>
            <button type="button" class="btn btn-ghost" id="tryonChangeSaree">Change saree</button>
          </div>
          <div class="tryon-panel" id="tryonSignin" hidden>
            <p class="lead">Sign in to try this on — 2 attempts per session, 5 per day.</p>
            <a class="btn btn-solid" id="tryonSigninBtn" href="/account/login">Sign in</a>
          </div>
          <div class="tryon-panel" id="tryonPhoto" hidden>
            <div class="tryon-reuse" id="tryonReuse" hidden>
              <p class="lead">Using your photo from this session.</p>
              <button type="button" class="btn btn-ghost" id="tryonUseDifferentPhoto">Use a different photo</button>
            </div>
            <div id="tryonUploadFields">
              <ul class="fineprint tryon-guidance"><li>guidance</li></ul>
              <img class="tryon-preview" id="tryonPreview" alt="Your photo preview" hidden>
              <p class="lead" id="tryonPreviewCaption" hidden>Preview</p>
              <label class="tryon-file-label" for="tryonFile">Choose a photo</label>
              <input type="file" id="tryonFile" accept="image/jpeg,image/png,image/webp">
              <label class="tryon-consent"><input type="checkbox" id="tryonConsent"> I consent</label>
              <progress class="tryon-progress" id="tryonProgress" value="0" max="100" hidden></progress>
              <p class="fineprint" id="tryonStage" aria-live="polite" hidden></p>
            </div>
            <div class="tryon-photo-actions">
              <button type="button" class="btn btn-ghost" id="tryonChangePhoto" hidden>Choose another photo</button>
              <button type="button" class="btn btn-solid" id="tryonGenerate" disabled>Generate</button>
            </div>
          </div>
          <div class="tryon-panel" id="tryonCreate" hidden>
            <p class="fineprint" id="tryonCreateStage" aria-live="polite"></p>
            <div class="tryon-photo-actions">
              <button type="button" class="btn btn-ghost" id="tryonCancelJob">Cancel</button>
              <button type="button" class="btn btn-ghost" id="tryonContinueShopping">Continue shopping</button>
              <button type="button" class="btn btn-solid" id="tryonTryAgain" hidden>Try again</button>
            </div>
          </div>
          <div class="tryon-panel" id="tryonReady" hidden>
            <p class="lead">Here's your AI styling preview.</p>
            <img class="tryon-preview tryon-result" id="tryonResultImg" alt="">
            <div class="tryon-compare" role="group" aria-label="Compare your photo and the preview">
              <button type="button" class="btn btn-ghost" id="tryonToggleOriginal" aria-pressed="false">Original</button>
              <button type="button" class="btn btn-ghost" id="tryonTogglePreview" aria-pressed="true">Preview</button>
              <a class="tryon-detail-link" id="tryonProductLink" href="#" hidden>View the real product photos and description</a>
            </div>
            <p class="fineprint" id="tryonBlouseNote">Blouse note</p>
            <div class="tryon-photo-actions">
              <button type="button" class="btn btn-ghost" id="tryonTryAnother">Try another saree</button>
              <button type="button" class="btn btn-ghost" id="tryonDownload">Download</button>
              <button type="button" class="btn btn-ghost" id="tryonDelete">Delete</button>
              <button type="button" class="btn btn-solid" id="tryonAddToBag" disabled>Add to bag</button>
            </div>
          </div>
          <div class="tryon-panel" id="tryonExpired" hidden>
            <p class="lead">This session has ended.</p>
            <button type="button" class="btn btn-solid" id="tryonStartNew">Start a new session</button>
          </div>
          <p class="fineprint" id="tryonCounters" aria-live="polite" hidden></p>
          <p class="fineprint tryon-notice" id="tryonNotice" aria-live="polite" hidden></p>
        </div>
      </div></div>`;
  }

  // Intercepts every call under the configured app-proxy path and replies
  // from `handlers`, keyed by the operation name after /v1/ (e.g.
  // 'session/start'). Also stubs the signed upload URL used for the actual
  // file POST. Returns the ordered list of {op, body} calls actually made.
  async function mockProxy(page, handlers) {
    const calls = [];
    await page.route('http://nirahh.test/apps/nirahh-tryon/v1/**', async (route) => {
      const req = route.request();
      const op = new URL(req.url()).pathname.split('/v1/')[1];
      const body = JSON.parse(req.postData() || '{}');
      calls.push({ op, body });
      const handler = handlers[op];
      if (!handler) {
        await route.fulfill({
          status: 404, contentType: 'application/json',
          body: JSON.stringify({ data: null, error: { code: 'NOT_FOUND', message: 'Not found.', retryable: false }, meta: { request_id: 'r' } })
        });
        return;
      }
      const result = await handler(body, calls.length);
      await route.fulfill({
        status: result.status || 200,
        contentType: 'application/json',
        body: JSON.stringify(result.error
          ? { data: null, error: result.error, meta: { request_id: 'r' } }
          : { data: result.data, error: null, meta: { request_id: 'r' } })
      });
    });
    await page.route('http://nirahh.test/upload-sink', (route) => route.fulfill({ status: 201, body: '' }));
    return calls;
  }

  // page.setContent() leaves the page on an opaque about:blank-derived
  // origin where sessionStorage (and so addInitScript's pre-seeded values)
  // throws SecurityError. Navigating to a served same-origin URL first, the
  // same pattern the disabled-dialog test above already uses for
  // theme-modal.html, gives the fixture a real http://nirahh.test origin.
  let fixtureCount = 0;
  async function gotoFixture(page, html) {
    const url = `http://nirahh.test/tryon-fixture-${fixtureCount++}.html`;
    await page.route(url, (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto(url);
  }

  const baseLimits = {
    max_upload_bytes: 10485760, max_image_pixels: 40000000, allowed_content_types: ['image/jpeg', 'image/png', 'image/webp'],
    max_active_jobs: 1, max_job_seconds: 180, max_generations_per_session: 2, max_paid_attempts_per_job: 1,
    generations_reserved: 0, generations_consumed: 0, remaining_generations: 2,
    max_generations_per_account_per_day: 5, account_generations_reserved_today: 0, account_generations_consumed_today: 0,
    account_generations_remaining_today: 5, account_quota_resets_at: '2026-11-02T18:30:00Z', account_quota_timezone: 'Asia/Kolkata',
    effective_remaining_generations: 2
  };

  await t.test('Shopify try-on entry point opens the shared dialog (disabled) and closes via its action link', async () => {
    const page = await newPage();
    const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const modal = source.slice(source.indexOf('<!-- Try-on modal -->'), source.indexOf('<script src='));
    await page.route('http://nirahh.test/theme-modal.html', route => route.fulfill({
      contentType: 'text/html',
      body: `<button id="tryOnBtn" data-tryon-open data-tryon-product-gid="gid://shopify/Product/1" data-tryon-title="Test saree">Try on</button>${modal}<script src="/shopify-theme/assets/dialog.js"></script><script src="/shopify-theme/assets/theme.js"></script><script src="/shopify-theme/assets/tryon-api.js"></script><script src="/shopify-theme/assets/tryon.js"></script>`
    }));
    await page.goto('http://nirahh.test/theme-modal.html');
    await page.locator('#tryOnBtn').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'modalClose');
    await page.locator('#tryOnModal a').click();
    assert.equal(await page.locator('#tryOnModal').isVisible(), false);
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  });

  await t.test('signed-out try-on shows the sign-in panel, preserves the saree across the login redirect, and binds once', async () => {
    const page = await newPage();
    await gotoFixture(page, `${tryonDialogFixture(false)}
      <div id="card">
        <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
                data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>
      </div>`);
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    assert.equal(await page.locator('#tryonSignin').isVisible(), true);
    assert.equal(await page.locator('#tryonPhoto').isVisible(), false);
    assert.equal(await page.locator('#tryonSareeTitle').textContent(), 'Rani saree');

    // No duplicate click binding across repeated theme-editor section
    // reloads. Done before the sign-in click below, since that one is a
    // real <a href> and clicking it navigates the page away.
    await page.evaluate(() => {
      const dialog = document.getElementById('tryOnModal');
      window.__opens = 0;
      const original = dialog._nirahhSetOpen;
      dialog._nirahhSetOpen = function (open) { window.__opens++; return original(open); };
      document.getElementById('card').dispatchEvent(new CustomEvent('shopify:section:load', { bubbles: true }));
      document.getElementById('card').dispatchEvent(new CustomEvent('shopify:section:load', { bubbles: true }));
    });
    await page.locator('#modalClose').click();
    await page.locator('[data-tryon-open]').click();
    assert.equal(await page.evaluate(() => window.__opens), 1);

    // The sign-in link is a real <a href>, so clicking it navigates the page
    // away once its default action runs; capture both the rewritten href and
    // the storage write from inside the very click handler that sets them,
    // before that navigation can tear down this document.
    await page.route('http://nirahh.test/account/login*', (route) => route.fulfill({ contentType: 'text/html', body: '<p>login stub</p>' }));
    const [href, pending] = await page.evaluate(() => new Promise((resolve) => {
      const btn = document.getElementById('tryonSigninBtn');
      btn.addEventListener('click', () => {
        resolve([btn.getAttribute('href'), sessionStorage.getItem('nirahh_tryon_pending_product')]);
      }, { once: true });
      btn.click();
    }));
    // Shopify's new customer accounts take return_to, not return_url. The
    // old param was silently dropped, landing the shopper on the account
    // page instead of back on the saree.
    assert.match(href, /return_to=/);
    assert.doesNotMatch(href, /return_url=/);
    assert.match(pending, /Rani saree/);
  });

  // The reported bug: signing in from the unpublished preview returned the
  // shopper to the primary domain, which serves the published theme, and
  // try-on reported itself unavailable. return_to only accepts a relative
  // path, so the draft can only be re-entered by carrying preview_theme_id.
  await t.test('signing in from an unpublished theme returns into that same theme', async () => {
    const page = await newPage();
    await gotoFixture(page, `${tryonDialogFixture(false, '165759222017')}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
        data-tryon-variant-gid="gid://shopify/ProductVariant/1"
        data-tryon-title="Rani saree" data-tryon-url="/products/rani">Try it on</button>`);
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });
    await page.click('[data-tryon-open]');

    await page.route('http://nirahh.test/account/login*', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>login stub</p>' }));
    const href = await page.evaluate(() => new Promise((resolve) => {
      const btn = document.getElementById('tryonSigninBtn');
      btn.addEventListener('click', () => resolve(btn.getAttribute('href')), { once: true });
      btn.click();
    }));

    const returnTo = decodeURIComponent(new URL(href, 'http://nirahh.test').searchParams.get('return_to'));
    assert.match(returnTo, /preview_theme_id=165759222017/,
      `return_to must re-enter the draft theme, got ${returnTo}`);
    assert.ok(returnTo.startsWith('/'), `return_to must be a relative path, got ${returnTo}`);
  });

  // On the published theme the parameter would be noise, and worse, would
  // pin shoppers to a theme id that may later be replaced.
  await t.test('signing in from the published theme adds no preview parameter', async () => {
    const page = await newPage();
    await gotoFixture(page, `${tryonDialogFixture(false, '')}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
        data-tryon-variant-gid="gid://shopify/ProductVariant/1"
        data-tryon-title="Rani saree" data-tryon-url="/products/rani">Try it on</button>`);
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });
    await page.click('[data-tryon-open]');

    await page.route('http://nirahh.test/account/login*', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>login stub</p>' }));
    const href = await page.evaluate(() => new Promise((resolve) => {
      const btn = document.getElementById('tryonSigninBtn');
      btn.addEventListener('click', () => resolve(btn.getAttribute('href')), { once: true });
      btn.click();
    }));

    assert.doesNotMatch(href, /preview_theme_id/);
  });

  // Reopening the dialog re-runs the handler against an href it already
  // rewrote; stacked return_to params would send the shopper somewhere odd.
  await t.test('reopening the dialog does not stack return_to parameters', async () => {
    const page = await newPage();
    await gotoFixture(page, `${tryonDialogFixture(false, '165759222017')}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
        data-tryon-variant-gid="gid://shopify/ProductVariant/1"
        data-tryon-title="Rani saree" data-tryon-url="/products/rani">Try it on</button>`);
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });
    await page.click('[data-tryon-open]');

    const href = await page.evaluate(() => {
      const btn = document.getElementById('tryonSigninBtn');
      // The href is real, so letting the default action run would navigate
      // away mid-test. Suppress it and still exercise the click handler.
      btn.addEventListener('click', (e) => e.preventDefault(), true);
      btn.click();
      btn.click();
      btn.click();
      return btn.getAttribute('href');
    });

    assert.equal((href.match(/return_to=/g) || []).length, 1, `href stacked parameters: ${href}`);
  });

  await t.test('returning signed-in after the login redirect auto-reopens the dialog for the preserved saree', async () => {
    const page = await newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem('nirahh_tryon_pending_product', JSON.stringify({
        productGid: 'gid://shopify/Product/1', variantGid: 'gid://shopify/ProductVariant/1', title: 'Rani saree', image: ''
      }));
    });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    await mockProxy(page, {
      'session/start': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, session_token: '1'.repeat(43) } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.waitForFunction(() => document.getElementById('tryOnModal') && !document.getElementById('tryOnModal').hidden);
    assert.equal(await page.locator('#tryonSareeTitle').textContent(), 'Rani saree');
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('nirahh_tryon_pending_product')), null);
  });

  await t.test('signed-in try-on resumes an existing session, never uploads before consent, and surfaces allowance counters', async () => {
    const page = await newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem('nirahh_tryon_session_token', '2'.repeat(43));
    });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    const calls = await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    assert.equal(calls[0].op, 'session/resume');
    assert.equal(calls[0].body.session_token, '2'.repeat(43));
    assert.equal(await page.locator('#tryonCounters').textContent(), '2 attempts left this session · 5 left today');

    // Choosing a file alone, without checking consent, must not enable
    // Generate or reach the server: a photo never reaches the server before
    // consent is explicitly given.
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3, 4]) });
    assert.equal(await page.locator('#tryonGenerate').isDisabled(), true);
    assert.equal(calls.some((c) => c.op === 'uploads/prepare'), false);

    await page.locator('#tryonConsent').check();
    assert.equal(await page.locator('#tryonGenerate').isDisabled(), false);
  });

  await t.test('generate uploads only after consent, polls validation, and reports a rejection with the exact PRD wording', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', '3'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    let statusCalls = 0;
    const calls = await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'uploads/prepare': () => ({ data: { upload_id: 'u1', method: 'POST', upload_url: 'http://nirahh.test/upload-sink', fields: { key: 'k', policy: 'p', signature: 'sig' }, expires_at: '2026-11-01T01:05:00Z', max_bytes: 10485760 } }),
      'uploads/complete': () => ({ data: { upload_id: 'u1', status: 'validating', poll_after_ms: 1000 } }),
      'uploads/status': () => {
        statusCalls++;
        if (statusCalls < 2) return { data: { upload_id: 'u1', status: 'validating', poll_after_ms: 50 } };
        return { data: { upload_id: 'u1', status: 'rejected', reason: 'PHOTO_UNSUITABLE' } };
      }
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3, 4]) });
    await page.locator('#tryonConsent').check();
    await page.locator('#tryonGenerate').click();

    await page.waitForFunction(() => !document.getElementById('tryonNotice').hidden, null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonNotice').textContent(), "We couldn't use that photo. Make sure your face and full body are clearly visible in good light.");
    // The prepare call only happens once consent was checked, and carries
    // the session's own consent_version rather than a client-invented one.
    const prepareCall = calls.find((c) => c.op === 'uploads/prepare');
    assert.equal(prepareCall.body.consent_version, 'v1');
    assert.equal(prepareCall.body.accepted_self_adult_processing, true);
    // A rejection clears the file input and preview rather than leaving a
    // stale selection the shopper could resubmit unchanged.
    assert.equal(await page.locator('#tryonPreview').isVisible(), false);
  });

  await t.test('a photo that passes validation proceeds straight into job creation (step 26) instead of stopping at a stub', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', '4'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    const calls = await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'uploads/prepare': () => ({ data: { upload_id: 'u2', method: 'POST', upload_url: 'http://nirahh.test/upload-sink', fields: { key: 'k' }, expires_at: '2026-11-01T01:05:00Z', max_bytes: 10485760 } }),
      'uploads/complete': () => ({ data: { upload_id: 'u2', status: 'validating', poll_after_ms: 1000 } }),
      'uploads/status': () => ({ data: { upload_id: 'u2', status: 'ready', photo_id: 'p1' } }),
      'jobs': () => ({ data: { job_id: 'j2', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': () => ({ data: { job_id: 'j2', status: 'processing', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', deadline_at: '2026-11-01T01:03:00Z', stage: 'creating', retry_allowed: false, poll_after_ms: 60000, limits: baseLimits } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3, 4]) });
    await page.locator('#tryonConsent').check();
    await page.locator('#tryonGenerate').click();

    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });
    assert.equal(calls.find((c) => c.op === 'jobs').body.photo_id, 'p1');
    await page.waitForFunction(() => document.getElementById('tryonCreateStage').textContent === 'Creating your preview\u2026', null, { timeout: 5000 });
  });

  await t.test('a network failure during upload shows the generic safe notice and lets the shopper retry', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', '5'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'uploads/prepare': () => ({ status: 503, error: { code: 'SERVICE_UNAVAILABLE', message: 'Something went wrong. Please try again.', retryable: true } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3, 4]) });
    await page.locator('#tryonConsent').check();
    await page.locator('#tryonGenerate').click();

    await page.waitForFunction(() => !document.getElementById('tryonNotice').hidden, null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonNotice').textContent(), 'Something went wrong. Please try again.');
    assert.equal(await page.locator('#tryonGenerate').isDisabled(), false);
  });

  await t.test('an ineligible product stays open and explains why try-on is not offered', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', '6'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/9"
              data-tryon-variant-gid="gid://shopify/ProductVariant/9" data-tryon-title="Unavailable saree">Try on</button>`);
    await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/9', variant_gid: 'gid://shopify/ProductVariant/9', eligible: false, reason: 'not_in_rollout' }] } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryOnModal').hidden && !document.getElementById('tryonNotice').hidden, null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonNotice').textContent(), "This saree isn't in the try-on preview yet.");
    assert.equal(await page.locator('#tryonPhoto').isHidden(), true);
  });

  await t.test('resume rejecting a stale or foreign session token starts fresh rather than showing a previous account', async () => {
    const page = await newPage();
    await page.addInitScript(() => {
      sessionStorage.setItem('nirahh_tryon_session_token', '7'.repeat(43));
      sessionStorage.setItem('nirahh_tryon_session_id', 'stale-session');
    });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    const calls = await mockProxy(page, {
      'session/resume': () => ({ status: 401, error: { code: 'SESSION_INVALID', message: 'Invalid session.', retryable: false } }),
      'session/start': () => ({ data: { session_id: 'fresh-session', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, session_token: '8'.repeat(43) } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    assert.deepEqual(calls.map((c) => c.op), ['session/resume', 'session/start', 'session/activity', 'products/eligibility']);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('nirahh_tryon_session_token')), '8'.repeat(43));
    assert.equal(await page.evaluate(() => sessionStorage.getItem('nirahh_tryon_session_id')), 'fresh-session');
  });

  await t.test('sessionStorage never holds anything beyond the opaque session token and id', async () => {
    const page = await newPage();
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    await mockProxy(page, {
      'session/start': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, session_token: '9'.repeat(43) } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    const stored = await page.evaluate(() => Object.assign({}, sessionStorage));
    assert.deepEqual(Object.keys(stored).sort(), ['nirahh_tryon_session_id', 'nirahh_tryon_session_token']);
    assert.equal(stored.nirahh_tryon_session_token, '9'.repeat(43));
    assert.doesNotMatch(JSON.stringify(stored), /base64|data:image/);
  });

  await t.test('double-clicking Generate creates exactly one job', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'a'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    const calls = await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'uploads/prepare': () => ({ data: { upload_id: 'u1', method: 'POST', upload_url: 'http://nirahh.test/upload-sink', fields: { key: 'k' }, expires_at: '2026-11-01T01:05:00Z', max_bytes: 10485760 } }),
      'uploads/complete': () => ({ data: { upload_id: 'u1', status: 'validating', poll_after_ms: 1000 } }),
      'uploads/status': () => ({ data: { upload_id: 'u1', status: 'ready', photo_id: 'p1' } }),
      'jobs': () => ({ data: { job_id: 'j1', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': () => ({
        data: {
          job_id: 'j1', status: 'ready', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1',
          deadline_at: '2026-11-01T01:03:00Z', stage: 'complete', retry_allowed: false, limits: baseLimits,
          original: { url: 'http://nirahh.test/original.jpg', url_expires_at: '2026-11-01T01:01:00Z', width: 10, height: 10, content_type: 'image/jpeg' },
          result: { result_url: 'http://nirahh.test/result.jpg', url_expires_at: '2026-11-01T01:01:00Z', width: 10, height: 10, content_type: 'image/jpeg', label: 'AI styling preview' }
        }
      })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3, 4]) });
    await page.locator('#tryonConsent').check();

    // Two click() calls on the same tick: the handler disables the button
    // synchronously on its very first line, so a real double-click (or a
    // slow first response) cannot submit the job twice.
    await page.evaluate(() => { const btn = document.getElementById('tryonGenerate'); btn.click(); btn.click(); });

    await page.waitForFunction(() => !document.getElementById('tryonReady').hidden, null, { timeout: 5000 });
    assert.equal(calls.filter((c) => c.op === 'jobs').length, 1);
    assert.equal(await page.locator('#tryonResultImg').getAttribute('src'), 'http://nirahh.test/result.jpg');
  });

  await t.test('dismissing the dialog keeps the job recoverable without re-uploading or re-creating it', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'b'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    let resumeCalls = 0;
    const calls = await mockProxy(page, {
      'session/resume': () => {
        resumeCalls++;
        const jobs = resumeCalls === 1 ? [] : [{ job_id: 'j1', status: 'processing', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', deadline_at: '2026-11-01T01:03:00Z' }];
        return { data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [], jobs } };
      },
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'uploads/prepare': () => ({ data: { upload_id: 'u1', method: 'POST', upload_url: 'http://nirahh.test/upload-sink', fields: { key: 'k' }, expires_at: '2026-11-01T01:05:00Z', max_bytes: 10485760 } }),
      'uploads/complete': () => ({ data: { upload_id: 'u1', status: 'validating', poll_after_ms: 1000 } }),
      'uploads/status': () => ({ data: { upload_id: 'u1', status: 'ready', photo_id: 'p1' } }),
      'jobs': () => ({ data: { job_id: 'j1', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': () => ({
        data: {
          job_id: 'j1', status: 'processing', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1',
          deadline_at: '2026-11-01T01:03:00Z', stage: 'creating', retry_allowed: false, poll_after_ms: 60000, limits: baseLimits
        }
      })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([1, 2, 3, 4]) });
    await page.locator('#tryonConsent').check();
    await page.locator('#tryonGenerate').click();
    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });
    assert.equal(calls.filter((c) => c.op === 'jobs').length, 1);

    // Escape pauses client polling only; it must not cancel the server job.
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#tryOnModal').isVisible(), false);
    assert.equal(calls.some((c) => c.op === 'jobs/cancel'), false);

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });
    assert.equal(calls.filter((c) => c.op === 'uploads/prepare').length, 1);
    assert.equal(calls.filter((c) => c.op === 'jobs').length, 1);
    assert.ok(calls.filter((c) => c.op === 'jobs/status').length >= 2);
  });

  await t.test('selecting a second saree reuses the already-validated photo without a new upload', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'c'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button id="btnA" data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on A</button>
      <button id="btnB" data-tryon-open data-tryon-product-gid="gid://shopify/Product/2"
              data-tryon-variant-gid="gid://shopify/ProductVariant/2" data-tryon-title="Peacock saree">Try on B</button>`);
    const calls = await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [{ photo_id: 'p1', width: 10, height: 10, expires_at: '2026-11-01T03:00:00Z' }], jobs: [] } }),
      'products/eligibility': (body) => ({ data: { items: body.items.map((i) => ({ product_gid: i.product_gid, variant_gid: i.variant_gid, eligible: true, reason: 'approved' })) } }),
      'session/activity': () => ({ data: {} }),
      'jobs': (body) => ({ data: { job_id: 'job-for-' + body.product_gid, status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': (body) => ({
        data: {
          job_id: body.job_id, status: 'processing',
          product_gid: body.job_id.replace('job-for-', ''), variant_gid: body.job_id.indexOf('Product/1') !== -1 ? 'gid://shopify/ProductVariant/1' : 'gid://shopify/ProductVariant/2',
          deadline_at: '2026-11-01T01:03:00Z', stage: 'creating', retry_allowed: false, poll_after_ms: 60000, limits: baseLimits
        }
      })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('#btnA').click();
    await page.waitForFunction(() => !document.getElementById('tryonReuse').hidden, null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonGenerate').isDisabled(), false);
    await page.locator('#tryonGenerate').click();
    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });

    await page.keyboard.press('Escape');
    await page.locator('#btnB').click();
    await page.waitForFunction(() => !document.getElementById('tryonReuse').hidden, null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonGenerate').isDisabled(), false);
    await page.locator('#tryonGenerate').click();
    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });

    assert.equal(calls.some((c) => c.op === 'uploads/prepare'), false);
    const jobCalls = calls.filter((c) => c.op === 'jobs');
    assert.equal(jobCalls.length, 2);
    assert.equal(jobCalls[0].body.photo_id, 'p1');
    assert.equal(jobCalls[1].body.photo_id, 'p1');
    assert.equal(jobCalls[0].body.product_gid, 'gid://shopify/Product/1');
    assert.equal(jobCalls[1].body.product_gid, 'gid://shopify/Product/2');
  });

  await t.test('a ready result supports Original/Preview comparison, a freshly authorized Download, and Delete ends the session', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'd'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    let statusCalls = 0;
    const calls = await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [{ photo_id: 'p1', width: 10, height: 10, expires_at: '2026-11-01T03:00:00Z' }], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'jobs': () => ({ data: { job_id: 'j1', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': () => {
        statusCalls++;
        return {
          data: {
            job_id: 'j1', status: 'ready', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1',
            deadline_at: '2026-11-01T01:03:00Z', stage: 'complete', retry_allowed: false, limits: baseLimits,
            original: { url: 'http://nirahh.test/original-' + statusCalls + '.jpg', url_expires_at: '2026-11-01T01:01:00Z', width: 10, height: 10, content_type: 'image/jpeg' },
            result: { result_url: 'http://nirahh.test/result-' + statusCalls + '.jpg', url_expires_at: '2026-11-01T01:01:00Z', width: 10, height: 10, content_type: 'image/jpeg', label: 'AI styling preview' }
          }
        };
      },
      'session/delete': () => ({ data: { deletion_id: 'del1', status: 'revoked', receipt_expires_at: '2026-11-02T01:00:00Z' } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonReuse').hidden, null, { timeout: 5000 });
    await page.locator('#tryonGenerate').click();
    await page.waitForFunction(() => !document.getElementById('tryonReady').hidden, null, { timeout: 5000 });

    assert.equal(await page.locator('#tryonResultImg').getAttribute('src'), 'http://nirahh.test/result-1.jpg');
    await page.locator('#tryonToggleOriginal').click();
    assert.equal(await page.locator('#tryonResultImg').getAttribute('src'), 'http://nirahh.test/original-1.jpg');
    assert.equal(await page.locator('#tryonToggleOriginal').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#tryonTogglePreview').getAttribute('aria-pressed'), 'false');
    await page.locator('#tryonTogglePreview').click();
    assert.equal(await page.locator('#tryonResultImg').getAttribute('src'), 'http://nirahh.test/result-1.jpg');

    // Download re-reads status for a fresh signed URL through an authorized
    // read rather than reusing the one already on screen, since signed
    // links are valid only 60 seconds.
    const downloadHref = await page.evaluate(() => new Promise((resolve) => {
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        HTMLAnchorElement.prototype.click = original;
        resolve(this.href);
      };
      document.getElementById('tryonDownload').click();
    }));
    assert.equal(downloadHref, 'http://nirahh.test/result-2.jpg');

    await page.locator('#tryonDelete').click();
    await page.waitForFunction(() => !document.getElementById('tryonExpired').hidden, null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonResultImg').getAttribute('src'), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('nirahh_tryon_session_token')), null);
  });

  await t.test('Cancel releases the reservation for a fresh attempt; Continue shopping leaves the job running server-side', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'e'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    let resumeCalls = 0;
    const reservedLimits = Object.assign({}, baseLimits, { generations_reserved: 1, remaining_generations: 1 });
    const calls = await mockProxy(page, {
      'session/resume': () => {
        resumeCalls++;
        const jobs = resumeCalls === 1 ? [] : [{ job_id: 'j1', status: 'processing', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', deadline_at: '2026-11-01T01:03:00Z' }];
        return { data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [{ photo_id: 'p1', width: 10, height: 10, expires_at: '2026-11-01T03:00:00Z' }], jobs } };
      },
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'jobs': () => ({ data: { job_id: 'j1', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: reservedLimits } }),
      'jobs/status': () => ({ data: { job_id: 'j1', status: 'processing', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', deadline_at: '2026-11-01T01:03:00Z', stage: 'creating', retry_allowed: false, poll_after_ms: 60000, limits: reservedLimits } }),
      'jobs/cancel': () => ({ data: { job_id: 'j1', status: 'cancelled', limits: baseLimits } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonReuse').hidden, null, { timeout: 5000 });
    await page.locator('#tryonGenerate').click();
    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });
    // Wait for the createJob/jobStatus round trip (not just the panel swap,
    // which happens synchronously before the response arrives) before
    // reading server-refreshed counters.
    await page.waitForFunction(() => document.getElementById('tryonCreateStage').textContent === 'Creating your preview\u2026', null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonCounters').textContent(), '1 attempt left this session \u00b7 5 left today');

    await page.locator('#tryonContinueShopping').click();
    assert.equal(await page.locator('#tryOnModal').isVisible(), false);
    assert.equal(calls.some((c) => c.op === 'jobs/cancel'), false);

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });
    await page.locator('#tryonCancelJob').click();
    await page.waitForFunction(() => !document.getElementById('tryonPhoto').hidden, null, { timeout: 5000 });
    assert.equal(calls.filter((c) => c.op === 'jobs/cancel').length, 1);
    assert.equal(calls.filter((c) => c.op === 'jobs').length, 1);
    assert.equal(await page.locator('#tryonCounters').textContent(), '2 attempts left this session \u00b7 5 left today');
  });

  await t.test('a failed job shows the exact PRD wording and only offers Try again when a retry is allowed', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'f'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [{ photo_id: 'p1', width: 10, height: 10, expires_at: '2026-11-01T03:00:00Z' }], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'jobs': () => ({ data: { job_id: 'j1', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': () => ({ data: { job_id: 'j1', status: 'failed', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', deadline_at: '2026-11-01T01:03:00Z', stage: 'stopped', retry_allowed: true, error_code: 'GENERATION_FAILED', limits: baseLimits } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonReuse').hidden, null, { timeout: 5000 });
    await page.locator('#tryonGenerate').click();
    await page.waitForFunction(() => !document.getElementById('tryonNotice').hidden, null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonNotice').textContent(), "We couldn't create your preview. Try again.");
    assert.equal(await page.locator('#tryonTryAgain').isHidden(), false);
    await page.locator('#tryonTryAgain').click();
    assert.equal(await page.locator('#tryonPhoto').isVisible(), true);
  });

  await t.test('Add to bag adds the exact job\'s product/variant through Shopify\'s own Ajax cart endpoint, with no private data in the request, and the toggle never changes which variant it targets', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'g'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/42" data-tryon-title="Rani saree"
              data-tryon-url="/products/rani-saree">Try on</button>`);
    await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [{ photo_id: 'p1', width: 10, height: 10, expires_at: '2026-11-01T03:00:00Z' }], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/42', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'jobs': () => ({ data: { job_id: 'j1', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': () => ({
        data: {
          job_id: 'j1', status: 'ready', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/42',
          deadline_at: '2026-11-01T01:03:00Z', stage: 'complete', retry_allowed: false, limits: baseLimits,
          original: { url: 'http://nirahh.test/original.jpg', url_expires_at: '2026-11-01T01:01:00Z', width: 10, height: 10, content_type: 'image/jpeg' },
          result: { result_url: 'http://nirahh.test/result.jpg', url_expires_at: '2026-11-01T01:01:00Z', width: 10, height: 10, content_type: 'image/jpeg', label: 'AI styling preview' }
        }
      })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    const cartCalls = [];
    await page.route('http://nirahh.test/cart/add.js', async (route) => {
      cartCalls.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 999999, quantity: 1, variant_id: 42 }) });
    });
    await page.route('http://nirahh.test/cart', (route) => route.fulfill({ contentType: 'text/html', body: '<p>cart</p>' }));

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonReuse').hidden, null, { timeout: 5000 });
    await page.locator('#tryonGenerate').click();
    await page.waitForFunction(() => !document.getElementById('tryonReady').hidden, null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonAddToBag').isDisabled(), false);
    assert.equal(await page.locator('#tryonProductLink').getAttribute('href'), '/products/rani-saree');

    // Comparing Original/Preview must not change which variant a later Add
    // to bag targets.
    await page.locator('#tryonToggleOriginal').click();
    await page.locator('#tryonTogglePreview').click();

    await page.locator('#tryonAddToBag').click();
    await page.waitForURL('http://nirahh.test/cart');
    assert.deepEqual(cartCalls, [{ id: '42', quantity: 1 }]);
  });

  await t.test('a sold-out variant is routed to the product page instead of being silently added', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'h'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/42" data-tryon-title="Rani saree"
              data-tryon-url="/products/rani-saree">Try on</button>`);
    await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [{ photo_id: 'p1', width: 10, height: 10, expires_at: '2026-11-01T03:00:00Z' }], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/42', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'jobs': () => ({ data: { job_id: 'j1', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': () => ({
        data: {
          job_id: 'j1', status: 'ready', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/42',
          deadline_at: '2026-11-01T01:03:00Z', stage: 'complete', retry_allowed: false, limits: baseLimits,
          original: { url: 'http://nirahh.test/original.jpg', url_expires_at: '2026-11-01T01:01:00Z', width: 10, height: 10, content_type: 'image/jpeg' },
          result: { result_url: 'http://nirahh.test/result.jpg', url_expires_at: '2026-11-01T01:01:00Z', width: 10, height: 10, content_type: 'image/jpeg', label: 'AI styling preview' }
        }
      })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.route('http://nirahh.test/cart/add.js', (route) => route.fulfill({
      status: 422, contentType: 'application/json',
      body: JSON.stringify({ status: 422, message: 'Sold out', description: 'That variant is sold out.' })
    }));
    await page.route('http://nirahh.test/products/rani-saree', (route) => route.fulfill({ contentType: 'text/html', body: '<p>sold out on the real product page</p>' }));

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonReuse').hidden, null, { timeout: 5000 });
    await page.locator('#tryonGenerate').click();
    await page.waitForFunction(() => !document.getElementById('tryonReady').hidden, null, { timeout: 5000 });

    await page.locator('#tryonAddToBag').click();
    await page.waitForURL('http://nirahh.test/products/rani-saree');
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
