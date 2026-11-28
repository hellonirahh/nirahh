import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const sampleJPEG = fs.readFileSync(path.join(root, 'assets/images/logo.jpg'));
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
    // Ready is plain HTML in the Liquid snippet, so exercise the actual
    // controls, focus order and allowance confirmation in the browser.
    const snippet = fs.readFileSync(path.join(root, 'shopify-theme/snippets/tryon-dialog.liquid'), 'utf8');
    const readyPanel = snippet.slice(snippet.indexOf('<div class="tryon-panel" id="tryonReady"'), snippet.indexOf('<div class="tryon-panel" id="tryonExpired"'));
    return `
      <div class="modal" id="tryOnModal" hidden><div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="tryOnTitle">
        <button class="modal-close" id="modalClose" aria-label="Close" type="button">&times;</button>
        <div class="modal-body">
          <script type="application/json" id="tryonConfig">${config}</script>
          <h3 id="tryOnTitle" class="display">Fitting room</h3>
          <div class="tryon-saree" id="tryonSaree">
            <img class="tryon-saree-image" id="tryonSareeImage" alt="" hidden>
            <div class="tryon-saree-info"><p class="eyebrow">See yourself in it</p><p class="lead" id="tryonSareeTitle"></p></div>
          </div>
          <div class="tryon-panel" id="tryonSignin" hidden>
            <p class="lead">Sign in to your Nirahh account to see this saree on you.</p>
            <a class="btn btn-solid" id="tryonSigninBtn" href="/account/login">Sign in</a>
          </div>
          <div class="tryon-panel" id="tryonPhoto" hidden>
            <div class="tryon-reuse" id="tryonReuse" hidden>
              <p class="lead">Using your photo from this session.</p>
              <button type="button" class="btn btn-ghost" id="tryonUseDifferentPhoto">Use a different photo</button>
            </div>
            <div id="tryonUploadFields">
              <ul class="fineprint tryon-guidance"><li>guidance</li></ul>
              <div class="tryon-hero" id="tryonPhotoHero">
                <label class="tryon-file-label" for="tryonFile">Choose a photo</label>
                <input type="file" id="tryonFile" accept="image/jpeg,image/png,image/webp">
                <img class="tryon-preview" id="tryonPreview" alt="Your photo preview" hidden>
                <button type="button" class="tryon-chip" id="tryonChangePhoto" hidden>Change photo</button>
                <span class="tryon-chip" id="tryonCounterChip" aria-hidden="true" hidden></span>
                <progress class="tryon-progress" id="tryonProgress" value="0" max="100" hidden></progress>
                <p class="fineprint" id="tryonStage" aria-live="polite" hidden></p>
              </div>
              <p class="lead" id="tryonPreviewCaption" hidden>Preview</p>
              <label class="tryon-consent"><input type="checkbox" id="tryonConsent"> I consent</label>
            </div>
            <div class="tryon-primary">
              <button type="button" class="btn btn-solid" id="tryonGenerate" disabled>Try it on</button>
            </div>
          </div>
          <div class="tryon-panel" id="tryonCreate" hidden>
            <div class="tryon-hero">
              <img id="tryonCreateImg" alt="" hidden>
              <p class="tryon-hero-stage" id="tryonCreateStage" aria-live="polite"></p>
              <p class="tryon-elapsed" id="tryonElapsed" aria-hidden="true"></p>
            </div>
            <ol class="tryon-steps" id="tryonSteps">
              <li class="tryon-step" data-stage="photo">Checking your photo</li>
              <li class="tryon-step" data-stage="creating">Creating your preview</li>
              <li class="tryon-step" data-stage="ready">Ready</li>
            </ol>
            <div class="tryon-bar" id="tryonBar" aria-hidden="true"><span></span></div>
            <div class="tryon-photo-actions">
              <button type="button" class="btn btn-ghost" id="tryonCancelJob">Cancel</button>
              <button type="button" id="tryonRetryPhoto" hidden>Use a different photo</button>
              <button type="button" id="tryonEarlierPreview" hidden>View earlier preview</button>
              <button type="button" class="btn btn-ghost" id="tryonContinueShopping">Continue shopping</button>
              <button type="button" class="btn btn-solid" id="tryonTryAgain" hidden>Try again</button>
            </div>
          </div>
          ${readyPanel}
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
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-photo.js') });
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

  // The reported contradiction: a fresh session against a spent
  // account-day showed "2 attempts left this session \u00b7 0 left today",
  // offering attempts that could not be spent.
  await t.test('a spent account-day never advertises session attempts', async () => {
    const page = await newPage();
    const spent = Object.assign({}, baseLimits, {
      remaining_generations: 2,
      account_generations_remaining_today: 0,
      account_generations_consumed_today: 6,
      max_generations_per_account_per_day: 6,
      effective_remaining_generations: 0,
    });
    await mockProxy(page, {
      'session/start': () => ({ data: { session_token: 't1', session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: spent, consent_version: 'v1', feature_enabled: true, photos: [], jobs: [] } }),
      'session/activity': () => ({ data: { ok: true } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true }] } }),
    });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
        data-tryon-variant-gid="gid://shopify/ProductVariant/1"
        data-tryon-title="Rani saree" data-tryon-url="/products/rani">Try it on</button>`);
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });
    await page.click('[data-tryon-open]');
    await page.waitForFunction(() => document.getElementById('tryonCounters').textContent.length > 0, null, { timeout: 5000 });

    const text = await page.locator('#tryonCounters').textContent();
    assert.equal(text, 'No previews left today');
    assert.doesNotMatch(text, /2/, `counter offered attempts that cannot be spent: ${text}`);
    assert.equal(await page.locator('#tryonCounterChip').textContent(), 'No previews left today');
    // The daily allowance in the notice is the server's number. It was a
    // hard-coded 5 after the allowance had moved to 6.
    const notice = await page.locator('#tryonNotice').textContent();
    assert.match(notice, /today's 6 previews/);
  });

  // An exempt owner account should not be shown a counter at all.
  await t.test('an exempt account is told it has no limit', async () => {
    const page = await newPage();
    const exempt = Object.assign({}, baseLimits, { exempt_from_limits: true });
    await mockProxy(page, {
      'session/start': () => ({ data: { session_token: 't1', session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: exempt, consent_version: 'v1', feature_enabled: true, photos: [], jobs: [] } }),
      'session/activity': () => ({ data: { ok: true } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true }] } }),
    });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
        data-tryon-variant-gid="gid://shopify/ProductVariant/1"
        data-tryon-title="Rani saree" data-tryon-url="/products/rani">Try it on</button>`);
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });
    await page.click('[data-tryon-open]');
    await page.waitForFunction(() => document.getElementById('tryonCounters').textContent.length > 0, null, { timeout: 5000 });

    assert.equal(await page.locator('#tryonCounters').textContent(), 'Unlimited previews on this account');
    assert.equal(await page.locator('#tryonCounterChip').textContent(), 'Unlimited previews');
    assert.equal(await page.locator('#tryonCounterChip').isHidden(), false);
  });

  // routes.storefront_login_url ships its own query string -- the live
  // theme renders locale, ui_hint and region_country. Rebuilding the href
  // from its path alone silently dropped them.
  await t.test('rewriting the sign-in link keeps the route own parameters', async () => {
    const page = await newPage();
    const routeUrl = '/customer_authentication/login?return_to=%2Fproducts%2Ff-1&amp;locale=en&amp;ui_hint=full&amp;region_country=IN';
    await gotoFixture(page, `${tryonDialogFixture(false, '165759222017')}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
        data-tryon-variant-gid="gid://shopify/ProductVariant/1"
        data-tryon-title="Rani saree" data-tryon-url="/products/rani">Try it on</button>`);
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });
    await page.evaluate((u) => {
      document.getElementById('tryonSigninBtn').setAttribute('href', u);
    }, routeUrl.replace(/&amp;/g, '&'));
    await page.click('[data-tryon-open]');

    const href = await page.evaluate(() => {
      const btn = document.getElementById('tryonSigninBtn');
      btn.addEventListener('click', (e) => e.preventDefault(), true);
      btn.click();
      return btn.getAttribute('href');
    });

    const params = new URL(href, 'http://nirahh.test').searchParams;
    assert.equal(params.get('locale'), 'en', `locale was dropped: ${href}`);
    assert.equal(params.get('ui_hint'), 'full', `ui_hint was dropped: ${href}`);
    assert.equal(params.get('region_country'), 'IN', `region_country was dropped: ${href}`);
    assert.match(params.get('return_to'), /preview_theme_id=165759222017/);
    assert.equal((href.match(/return_to=/g) || []).length, 1, `return_to stacked: ${href}`);
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
    assert.equal(await page.locator('#tryonCounters').textContent(), '2 previews left in this session · 5 left today');

    // Choosing a file alone, without checking consent, must not enable
    // Generate or reach the server: a photo never reaches the server before
    // consent is explicitly given.
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: sampleJPEG });
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
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: sampleJPEG });
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

  await t.test('oversized phone photos keep their orientation and aspect ratio, and unsupported HEIC gives export guidance', async () => {
    const page = await newPage();
    await gotoFixture(page, '<main></main>');
    const results = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 400;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 300, 400);
      ctx.fillStyle = 'blue';
      ctx.fillRect(300, 0, 300, 400);
      const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
      // EXIF orientation 6 displays this landscape raster as a portrait.
      const exif = Uint8Array.from([0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0, 77, 77, 0, 42,
        0, 0, 0, 8, 0, 1, 1, 18, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
      const file = new File([jpeg.slice(0, 2), exif, jpeg.slice(2)], 'camera.jpg', { type: 'image/jpeg' });
      const prepare = window.NirahhTryOnPhoto.prepare;
      const converted = await prepare(file, { max_image_pixels: 120000 });
      const bitmap = await createImageBitmap(converted);
      ctx.drawImage(bitmap, 0, 0, 2, 2);
      const top = Array.from(ctx.getImageData(0, 0, 1, 1).data);
      const bottom = Array.from(ctx.getImageData(0, 1, 1, 1).data);
      // Taking the byte-limit path alone must preserve all native dimensions.
      const padded = new File([file, new Uint8Array(200000)], 'large.jpg', { type: 'image/jpeg' });
      const byteBound = await prepare(padded, { max_upload_bytes: 100000 });
      const native = await createImageBitmap(byteBound);
      const ftyp = new Uint8Array([0, 0, 0, 20, ...new TextEncoder().encode('ftypheic'), 0, 0, 0, 0, ...new TextEncoder().encode('mif1')]);
      const heicError = await prepare(new File([ftyp], 'camera.heic', { type: 'image/heic' }), {})
        .then(() => null, err => err.code);
      return { w: bitmap.width, h: bitmap.height, top, bottom, type: converted.type,
        originalDims: [native.width, native.height], uploadSize: byteBound.size, heicError };
    });
    assert.equal(results.type, 'image/jpeg');
    assert.ok(results.w * results.h <= 120000);
    assert.ok(Math.abs(results.w / results.h - 2 / 3) < 0.005);
    assert.ok(results.top[0] > 220 && results.bottom[2] > 220);
    assert.deepEqual(results.originalDims, [400, 600]);
    assert.ok(results.uploadSize < 100000);
    assert.equal(results.heicError, 'PHOTO_EXPORT_JPEG');
  });

  await t.test('a phone JPEG with generic MIME uploads byte for byte and starts on completed validation', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'q'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    const calls = await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'uploads/prepare': () => ({ data: { upload_id: 'u3', method: 'POST', upload_url: 'http://nirahh.test/upload-sink', fields: { key: 'k' }, expires_at: '2026-11-01T01:05:00Z', max_bytes: 10485760 } }),
      'uploads/complete': () => ({ data: { upload_id: 'u3', status: 'ready', photo_id: 'p3', poll_after_ms: 1000 } }),
      'uploads/status': () => ({ data: { upload_id: 'u3', status: 'ready', photo_id: 'p3' } }),
      'jobs': () => ({ data: { job_id: 'j3', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': () => ({ data: { job_id: 'j3', status: 'processing', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', deadline_at: '2026-11-01T01:03:00Z', stage: 'creating', retry_allowed: false, poll_after_ms: 60000, limits: baseLimits } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    let uploaded;
    await page.route('http://nirahh.test/upload-sink', async route => {
      const request = route.request();
      const form = await new Response(request.postDataBuffer(), { headers: { 'Content-Type': request.headers()['content-type'] } }).formData();
      uploaded = Buffer.from(await form.get('file').arrayBuffer());
      await route.fulfill({ status: 201, body: '' });
    });
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'application/octet-stream', buffer: sampleJPEG });
    await page.locator('#tryonConsent').check();
    await page.locator('#tryonGenerate').click();

    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });
    assert.deepEqual(uploaded, sampleJPEG);
    assert.equal(calls.find(c => c.op === 'uploads/prepare').body.content_type, 'image/jpeg');
    assert.equal(calls.find((c) => c.op === 'jobs').body.photo_id, 'p3');
    assert.equal(calls.some((c) => c.op === 'uploads/status'), false);
  });

  await t.test('when uploads/complete already reports a rejection, it is shown without a status poll', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'r'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    const calls = await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'uploads/prepare': () => ({ data: { upload_id: 'u4', method: 'POST', upload_url: 'http://nirahh.test/upload-sink', fields: { key: 'k' }, expires_at: '2026-11-01T01:05:00Z', max_bytes: 10485760 } }),
      'uploads/complete': () => ({ data: { upload_id: 'u4', status: 'rejected', reason: 'PHOTO_UNSUITABLE', poll_after_ms: 1000 } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonFile').disabled);
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: sampleJPEG });
    await page.locator('#tryonConsent').check();
    await page.locator('#tryonGenerate').click();

    await page.waitForFunction(() => !document.getElementById('tryonNotice').hidden, null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonNotice').textContent(), "We couldn't use that photo. Make sure your face and full body are clearly visible in good light.");
    assert.equal(calls.some((c) => c.op === 'uploads/status'), false);
    assert.equal(calls.some((c) => c.op === 'jobs'), false);
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
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: sampleJPEG });
    await page.locator('#tryonConsent').check();
    await page.locator('#tryonGenerate').click();

    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });
    assert.equal(calls.find((c) => c.op === 'jobs').body.photo_id, 'p1');
    await page.waitForFunction(() => document.getElementById('tryonCreateStage').textContent === 'Creating your preview\u2026', null, { timeout: 5000 });
    // Only real stages: the photo check is already behind the shopper, the
    // model step is running, and nothing claims a "checking the result"
    // stage the backend never enters.
    assert.deepEqual(await page.$$eval('#tryonSteps .tryon-step', (steps) => steps.map((s) => [s.dataset.stage, s.dataset.state])),
      [['photo', 'done'], ['creating', 'active'], ['ready', 'idle']]);
    // The generating view shows the shopper's own chosen photo.
    // (The fixture's four-byte "photo" never decodes, so check the
    // attribute rather than rendered visibility.)
    assert.match(await page.locator('#tryonCreateImg').getAttribute('src'), /^blob:/);
    assert.equal(await page.locator('#tryonCreateImg').getAttribute('hidden'), null);
  });

  await t.test('a queued job reads as the model step, not a separate wait', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', '9'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/1"
              data-tryon-variant-gid="gid://shopify/ProductVariant/1" data-tryon-title="Rani saree">Try on</button>`);
    await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [{ photo_id: 'p1' }], jobs: [] } }),
      'products/eligibility': () => ({ data: { items: [{ product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', eligible: true, reason: 'approved' }] } }),
      'session/activity': () => ({ data: {} }),
      'jobs': () => ({ data: { job_id: 'j9', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': () => ({ data: { job_id: 'j9', status: 'queued', product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/1', deadline_at: '2026-11-01T01:03:00Z', stage: 'queued', retry_allowed: false, poll_after_ms: 60000, limits: baseLimits } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonGenerate').disabled, null, { timeout: 5000 });
    await page.locator('#tryonGenerate').click();
    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('tryonCreateStage').textContent.length > 0, null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonCreateStage').textContent(), 'Creating your preview\u2026');
    assert.equal(await page.locator('#tryonSteps [data-stage="creating"]').getAttribute('data-state'), 'active');
    // A reused photo has no local file and this status carries no
    // original, so the photo area stays a plain panel rather than showing
    // a broken image.
    assert.notEqual(await page.locator('#tryonCreateImg').getAttribute('hidden'), null);
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
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: sampleJPEG });
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
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: sampleJPEG });
    await page.locator('#tryonConsent').check();

    // Two click() calls on the same tick: the handler disables the button
    // synchronously on its very first line, so a real double-click (or a
    // slow first response) cannot submit the job twice.
    await page.evaluate(() => { const btn = document.getElementById('tryonGenerate'); btn.click(); btn.click(); });

    await page.waitForFunction(() => !document.getElementById('tryonReady').hidden, null, { timeout: 5000 });
    assert.equal(calls.filter((c) => c.op === 'jobs').length, 1);
    assert.equal(await page.locator('#tryonResultImg').getAttribute('src'), 'http://nirahh.test/result.jpg');
  });

  // Model only the server state needed by the repeat flow. Returning it on
  // each resume also exercises navigation away from and back to the saree.
  async function blouseFixture({ jobs, photos, limits, create, status }) {
    const page = await newPage();
    const product = { product_gid: 'gid://shopify/Product/1', variant_gid: 'gid://shopify/ProductVariant/42' };
    await page.addInitScript(() => sessionStorage.setItem('nirahh_tryon_session_token', 's'.repeat(43)));
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="${product.product_gid}" data-tryon-variant-gid="${product.variant_gid}">Try on</button>`);
    const calls = await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 'session', limits: limits(), feature_enabled: true,
        photos: photos.map(photo_id => ({ photo_id })), jobs: jobs.map(job => ({ ...product, ...job })) } }),
      'session/activity': () => ({ data: {} }),
      'products/eligibility': () => ({ data: { items: [{ ...product, eligible: true }] } }),
      'jobs': create,
      'jobs/status': ({ job_id }) => ({ data: { ...product, job_id, status: 'ready', stage: 'complete',
        limits: limits(), retry_allowed: limits().effective_remaining_generations > 0,
        original: { photo_id: photos[0], url: 'http://nirahh.test/original.jpg' },
        result: { result_url: 'http://nirahh.test/' + job_id + '.jpg' }, ...status(job_id) } })
    });
    for (const script of ['dialog', 'tryon-api', 'tryon']) {
      await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/' + script + '.js') });
    }
    const open = () => page.locator('[data-tryon-open]').click();
    const reopen = async () => { await page.locator('#modalClose').click(); await open(); };
    await open();
    return { page, calls, reopen, product };
  }

  await t.test('a confirmed same-saree repeat uses the original photo and one new job, including after reopening', async () => {
    const jobs = [];
    const photos = ['first-photo'];
    const limits = () => ({ ...baseLimits, remaining_generations: 2 - jobs.length, effective_remaining_generations: 2 - jobs.length });
    const { page, calls, reopen, product } = await blouseFixture({ jobs, photos, limits, status: () => ({}),
      create: () => {
        const job_id = jobs.length ? '20000000-0000-4000-8000-000000000002' : '20000000-0000-4000-8000-000000000001';
        jobs.push({ job_id, status: 'ready' });
        return { data: { job_id, status: 'queued', limits: limits() } };
      }
    });
    const another = page.locator('#tryonAnotherBlouse');
    await page.locator('#tryonReuse').waitFor();
    await page.locator('#tryonGenerate').click();
    await another.click();
    assert.match(await page.locator('#tryonBlouseNote').textContent(), /styling suggestion/);
    assert.match(await page.locator('#tryonBlouseCost').textContent(), /one more preview from this session/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tryonKeepPreview');
    await page.locator('#tryonKeepPreview').click();
    assert.equal(await page.locator('#tryonBlouseConfirm').isHidden(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tryonAnotherBlouse');

    photos.push('newer-unrelated-photo');
    await another.click();
    await reopen();
    await another.waitFor();
    assert.equal(await page.locator('#tryonBlouseConfirm').isHidden(), true);
    assert.equal(calls.filter(c => c.op === 'jobs').length, 1);
    await another.click();
    await page.locator('#tryonConfirmBlouse').evaluate(button => { button.click(); button.click(); });
    const finalImage = page.locator('#tryonResultImg[src$="000002.jpg"]');
    await finalImage.waitFor();
    assert.equal(await another.isHidden(), true);
    assert.equal(await page.locator('#tryonAddToBag').isEnabled(), true);
    await reopen();
    await finalImage.waitFor();
    const creates = calls.filter(c => c.op === 'jobs').map(c => c.body);
    assert.equal(creates.length, 2);
    assert.notEqual(creates[0].idempotency_key, creates[1].idempotency_key);
    assert.deepEqual(creates[1], { ...product, session_token: 's'.repeat(43), photo_id: 'first-photo', idempotency_key: jobs[0].job_id });
    assert.equal(calls.some(c => c.op.startsWith('uploads/')), false);
  });

  await t.test('an unlimited account can retry after a failed design, and a lost response replays the same confirmation', async () => {
    const jobs = [{ job_id: '10000000-0000-4000-8000-000000000001', status: 'ready' },
      { job_id: '10000000-0000-4000-8000-000000000002', status: 'quality_rejected' }];
    const limits = () => ({ ...baseLimits, exempt_from_limits: true });
    let unavailable = true;
    let accepted = false;
    const { page, calls, reopen } = await blouseFixture({ jobs, photos: ['first'], limits,
      status: () => unavailable ? { original: { url: 'http://nirahh.test/legacy.jpg' } } : {},
      create: () => {
        if (!accepted) {
          accepted = true;
          return { status: 503, error: { code: 'SERVICE_UNAVAILABLE', message: 'Unable to confirm the request.', retryable: true } };
        }
        return { data: { job_id: '10000000-0000-4000-8000-000000000003', limits: limits() } };
      }
    });
    await page.locator('#tryonReady').waitFor();
    assert.equal(await page.locator('#tryonAnotherBlouse').isHidden(), true);
    unavailable = false;
    await reopen();
    await page.locator('#tryonAnotherBlouse').click();
    assert.match(await page.locator('#tryonBlouseCost').textContent(), /unlimited previews/);
    await page.locator('#tryonConfirmBlouse').click();
    await page.locator('#tryonNotice').filter({ hasText: 'Unable to confirm the request.' }).waitFor();
    await page.locator('#tryonAnotherBlouse').click();
    await page.locator('#tryonConfirmBlouse').click();
    await page.locator('#tryonResultImg[src$="000003.jpg"]').waitFor();
    const keys = calls.filter(c => c.op === 'jobs').map(c => c.body.idempotency_key);
    assert.deepEqual(keys, [jobs[1].job_id, jobs[1].job_id]);
  });

  await t.test('reopening follows the active repeat, explains a rejected last attempt and keeps the earlier result available', async () => {
    const jobs = [{ job_id: 'first', status: 'ready' }, { job_id: 'second', status: 'processing' }];
    const limits = () => ({ ...baseLimits, remaining_generations: 0, effective_remaining_generations: 0 });
    const { page, calls } = await blouseFixture({ jobs, photos: ['photo'], limits,
      status: (id) => {
        if (id === 'first') return {};
        jobs[1].status = 'quality_rejected';
        return { status: 'quality_rejected', stage: 'stopped', error_code: 'QUALITY_REJECTED', result: undefined };
      }
    });
    await page.locator('#tryonNotice').filter({ hasText: 'image changed too much' }).waitFor();
    assert.doesNotMatch(await page.locator('#tryonNotice').textContent(), /allowance was restored/);
    assert.equal(await page.locator('#tryonReady').isHidden(), true);
    assert.equal(await page.locator('#tryonTryAgain').isHidden(), true);
    await page.getByRole('button', { name: 'View earlier preview' }).click();
    await page.locator('#tryonResultImg[src$="first.jpg"]').waitFor();
    assert.equal(await page.locator('#tryonAnotherBlouse').isHidden(), true);
    assert.deepEqual(calls.filter(c => c.op === 'jobs/status').map(c => c.body.job_id), ['second', 'first']);
    assert.equal(calls.some(c => c.op === 'jobs'), false);
  });

  await t.test('a withheld preview restores the displayed allowance and retries the same original only on an explicit click', async () => {
    const rejected = '20000000-0000-4000-8000-000000000002';
    const jobs = [{ job_id: 'first', status: 'ready' }, { job_id: rejected, status: 'processing' }];
    const limits = () => ({ ...baseLimits, remaining_generations: 1, effective_remaining_generations: 1 });
    let creates = 0;
    const { page, calls } = await blouseFixture({ jobs, photos: ['original', 'another-photo'], limits,
      status: (id) => id === rejected ? { status: 'quality_rejected', stage: 'stopped', error_code: 'QUALITY_REJECTED',
        allowance_restored: true, result: undefined } : {},
      create: () => ++creates === 1
        ? { status: 503, error: { code: 'SERVICE_UNAVAILABLE', message: 'Request still unconfirmed.', retryable: true } }
        : { data: { job_id: 'new-preview', limits: limits() } }
    });
    const retry = page.getByRole('button', { name: 'Generate again' });
    await retry.waitFor();
    assert.match(await page.locator('#tryonNotice').textContent(), /allowance was restored/);
    assert.match(await page.locator('#tryonCounters').textContent(), /1 preview left/);
    assert.equal(await page.locator('#tryonEarlierPreview').isVisible(), true);
    assert.equal(await page.locator('#tryonCancelJob').isHidden(), true);
    assert.equal(creates, 0);
    await retry.evaluate(b => { b.click(); b.click(); });
    await page.locator('#tryonNotice').filter({ hasText: 'Request still unconfirmed.' }).waitFor();
    assert.equal(creates, 1);
    await retry.click();
    await page.locator('#tryonResultImg[src$="new-preview.jpg"]').waitFor();
    const requests = calls.filter(c => c.op === 'jobs').map(c => c.body);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].idempotency_key, rejected);
    assert.equal(requests[0].photo_id, 'original');
    assert.deepEqual(requests[1], requests[0]);
    assert.equal(calls.some(c => c.op.startsWith('uploads/')), false);
  });

  await t.test('the first withheld job can be reopened and its photo replaced without spending a preview', async () => {
    const jobs = [{ job_id: 'withheld', status: 'quality_rejected' }];
    const { page, calls } = await blouseFixture({ jobs, photos: ['old-photo', 'newer-photo'], limits: () => baseLimits,
      status: () => ({ status: 'quality_rejected', allowance_restored: true, result: undefined }) });
    await page.locator('#tryonRetryPhoto').click();
    await page.locator('#tryonUploadFields').waitFor();
    assert.equal(await page.locator('#tryonReuse').isHidden(), true);
    assert.equal(await page.locator('#tryonGenerate').isDisabled(), true);
    assert.equal(calls.some(c => c.op === 'jobs' || c.op.startsWith('uploads/')), false);
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
    await page.locator('#tryonFile').setInputFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: sampleJPEG });
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

  await t.test('with two photos in the session, the next saree reuses the most recent one', async () => {
    const page = await newPage();
    await page.addInitScript(() => { sessionStorage.setItem('nirahh_tryon_session_token', 'n'.repeat(43)); });
    await gotoFixture(page, `${tryonDialogFixture(true)}
      <button data-tryon-open data-tryon-product-gid="gid://shopify/Product/3"
              data-tryon-variant-gid="gid://shopify/ProductVariant/3" data-tryon-title="Third saree">Try on</button>`);
    // session/resume lists photos oldest first (api/openapi.json).
    const calls = await mockProxy(page, {
      'session/resume': () => ({ data: { session_id: 's1', idle_expires_at: '2026-11-01T01:00:00Z', expires_at: '2026-11-01T03:00:00Z', limits: baseLimits, consent_version: 'v1', feature_enabled: true, photos: [
        { photo_id: 'first-photo', width: 10, height: 10, expires_at: '2026-11-01T03:00:00Z' },
        { photo_id: 'second-photo', width: 10, height: 10, expires_at: '2026-11-01T03:00:00Z' }
      ], jobs: [] } }),
      'products/eligibility': (body) => ({ data: { items: body.items.map((i) => ({ product_gid: i.product_gid, variant_gid: i.variant_gid, eligible: true, reason: 'approved' })) } }),
      'session/activity': () => ({ data: {} }),
      'jobs': () => ({ data: { job_id: 'j3', status: 'queued', deadline_at: '2026-11-01T01:03:00Z', poll_after_ms: 60000, limits: baseLimits } }),
      'jobs/status': () => ({ data: { job_id: 'j3', status: 'processing', product_gid: 'gid://shopify/Product/3', variant_gid: 'gid://shopify/ProductVariant/3', deadline_at: '2026-11-01T01:03:00Z', stage: 'creating', retry_allowed: false, poll_after_ms: 60000, limits: baseLimits } })
    });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/dialog.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon-api.js') });
    await page.addScriptTag({ path: path.join(root, 'shopify-theme/assets/tryon.js') });

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonReuse').hidden, null, { timeout: 5000 });
    await page.locator('#tryonGenerate').click();
    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });
    assert.equal(calls.find((c) => c.op === 'jobs').body.photo_id, 'second-photo');
  });

  await t.test('the real dialog offers no Change saree, Try another saree or Product details control', async () => {
    const markup = fs.readFileSync(path.join(root, 'shopify-theme/snippets/tryon-dialog.liquid'), 'utf8');
    for (const gone of ['tryonChangeSaree', 'tryonTryAnother', 'tryonProductLink', '>Change saree<', '>Try another saree<', '>Product details<']) {
      assert.equal(markup.includes(gone), false, `${gone} is still in tryon-dialog.liquid`);
    }
    const pdp = fs.readFileSync(path.join(root, 'shopify-theme/sections/main-product.liquid'), 'utf8');
    assert.match(pdp, /'products\.product\.try_on' \| t/);
    const locale = JSON.parse(fs.readFileSync(path.join(root, 'shopify-theme/locales/en.default.json'), 'utf8'));
    assert.equal(locale.products.product.try_on, 'See yourself in it');
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
    // effective_remaining_generations is min(session, account-day); the
    // server never sends a session remainder without lowering it too.
    const reservedLimits = Object.assign({}, baseLimits, { generations_reserved: 1, remaining_generations: 1, effective_remaining_generations: 1 });
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
    // reading server-refreshed counters. Queued and processing share one
    // stage label now, so the counters themselves are the signal.
    await page.waitForFunction(() => document.getElementById('tryonCounters').textContent.startsWith('1 preview'), null, { timeout: 5000 });
    assert.equal(await page.locator('#tryonCounters').textContent(), '1 preview left in this session \u00b7 5 left today');

    await page.locator('#tryonContinueShopping').click();
    assert.equal(await page.locator('#tryOnModal').isVisible(), false);
    assert.equal(calls.some((c) => c.op === 'jobs/cancel'), false);

    await page.locator('[data-tryon-open]').click();
    await page.waitForFunction(() => !document.getElementById('tryonCreate').hidden, null, { timeout: 5000 });
    await page.locator('#tryonCancelJob').click();
    await page.waitForFunction(() => !document.getElementById('tryonPhoto').hidden, null, { timeout: 5000 });
    assert.equal(calls.filter((c) => c.op === 'jobs/cancel').length, 1);
    assert.equal(calls.filter((c) => c.op === 'jobs').length, 1);
    assert.equal(await page.locator('#tryonCounters').textContent(), '2 previews left in this session \u00b7 5 left today');
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

// The browser tests above drive a hand-built copy of the dialog, so this
// checks the real snippet for what that copy cannot: one solid primary
// action per step with the right label, only real stages, the docked-panel
// modifier, and no allowance numbers baked into copy.
test('fitting-room snippet keeps one primary action per step and honest copy', () => {
  const liquid = fs.readFileSync(path.join(root, 'shopify-theme/snippets/tryon-dialog.liquid'), 'utf8');
  const enabled = liquid.split('{%- else -%}')[0];
  assert.match(liquid, /class="modal modal--tryon" id="tryOnModal"/);
  const panel = (id) => {
    const start = enabled.indexOf(`id="${id}"`);
    assert.notEqual(start, -1, id);
    const next = enabled.indexOf('class="tryon-panel"', start + 1);
    return enabled.slice(start, next === -1 ? undefined : next);
  };
  const solids = (html) => Array.from(html.matchAll(/class="btn btn-solid"[^>]*>([^<]+)</g), (m) => m[1].trim());
  assert.deepEqual(solids(panel('tryonSignin')), ['Sign in to try it on']);
  assert.deepEqual(solids(panel('tryonPhoto')), ['Try it on']);
  assert.deepEqual(solids(panel('tryonCreate')), ['Try again']);
  assert.deepEqual(solids(panel('tryonReady')), ['Add to bag']);
  assert.deepEqual(solids(panel('tryonExpired')), ['Start a new session']);
  assert.doesNotMatch(enabled, /Waiting to start|Checking the result/);
  assert.doesNotMatch(enabled, /\d+\s+(attempts?|previews?)\s+per\s+(session|day)/i);
  for (const id of ['tryonCreateImg', 'tryonCounterChip', 'tryonFile', 'tryonResultImg']) assert.match(enabled, new RegExp(`id="${id}"`));
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
