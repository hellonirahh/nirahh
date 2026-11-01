(function () {
  'use strict';

  // One shared fitting-room dialog for every entry point (homepage section,
  // product card and product page). The dialog itself is rendered once from
  // layout/theme.liquid via snippets/tryon-dialog.liquid; this file binds it
  // once and drives the full session/consent/upload/generation/result flow
  // (steps 25-26) plus Add to bag through Shopify's own Ajax cart endpoint
  // (step 27) — a separate commerce boundary from the nirahh-tryon proxy
  // client in tryon-api.js.

  var KEYS = {
    token: 'nirahh_tryon_session_token',
    id: 'nirahh_tryon_session_id',
    pending: 'nirahh_tryon_pending_product'
  };

  var REJECTION_MESSAGES = {
    UPLOAD_TOO_LARGE: 'That file is too large or an unsupported format. Use JPEG, PNG or WebP up to 10 MiB.',
    PHOTO_UNSUPPORTED: 'That file is too large or an unsupported format. Use JPEG, PNG or WebP up to 10 MiB.',
    PHOTO_UNSUITABLE: "We couldn't use that photo. Make sure your face and full body are clearly visible in good light."
  };

  var JOB_FAILURE_MESSAGES = {
    GENERATION_FAILED: "We couldn't create your preview. Try again.",
    QUALITY_REJECTED: "That combination didn't meet our quality bar. Try a different photo or saree.",
    OUTCOME_UNKNOWN: "We couldn't confirm what happened with that preview."
  };

  // ---- sessionStorage with an in-memory fallback if storage is denied ----
  function makeStore() {
    var memory = {};
    var usable = true;
    try {
      window.sessionStorage.setItem('__nirahh_probe__', '1');
      window.sessionStorage.removeItem('__nirahh_probe__');
    } catch (e) {
      usable = false;
    }
    return {
      get: function (key) {
        if (usable) {
          try { return window.sessionStorage.getItem(key); } catch (e) { /* fall through */ }
        }
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
      },
      set: function (key, value) {
        if (usable) {
          try { window.sessionStorage.setItem(key, value); return; } catch (e) { /* fall through */ }
        }
        memory[key] = value;
      },
      remove: function (key) {
        if (usable) {
          try { window.sessionStorage.removeItem(key); } catch (e) { /* fall through */ }
        }
        delete memory[key];
      }
    };
  }

  var store = makeStore();

  function randomUUID() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    // RFC 4122-shaped fallback for environments without crypto.randomUUID.
    var bytes = new Uint8Array(16);
    (window.crypto || { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } }).getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); });
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
  }

  function formatIST(iso) {
    try {
      return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    } catch (e) {
      return 'tonight';
    }
  }

  function jobKey(p) {
    return (p && p.productGid || '') + '|' + (p && p.variantGid || '');
  }

  // A multi-variant product page only keeps the clicked button's own
  // data-tryon-variant-gid attribute in sync with the option selected at
  // render time; resolve the live selection from its form at click time.
  function variantGidFor(button) {
    var form = button.closest('form');
    var input = form && form.querySelector('[name="id"]');
    if (input && input.value) return 'gid://shopify/ProductVariant/' + input.value;
    return button.dataset.tryonVariantGid || '';
  }

  function productFromButton(button) {
    return {
      productGid: button.dataset.tryonProductGid || '',
      variantGid: variantGidFor(button),
      title: button.dataset.tryonTitle || '',
      image: button.dataset.tryonImage || '',
      url: button.dataset.tryonUrl || ''
    };
  }

  // Shopify GIDs end in the same decimal numeric ID the Ajax cart endpoint
  // expects (gid://shopify/ProductVariant/987654321 -> "987654321"); no
  // separate lookup is needed in the theme.
  function numericIdFromGid(gid) {
    if (!gid) return null;
    var last = String(gid).split('/').pop();
    return /^\d+$/.test(last) ? last : null;
  }

  function initButtons(scope) {
    scope.querySelectorAll('[data-tryon-open]').forEach(function (button) {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';
      button.addEventListener('click', function () {
        TryOn.openForProduct(productFromButton(button));
      });
    });
  }

  // ---- the dialog controller --------------------------------------------
  var TryOn = (function () {
    var dialog = null;
    var enabled = false;
    var config = { proxyPath: '', signedIn: false, loginUrl: '', locale: 'en', cartRoot: '/', cartUrl: '/cart' };
    var api = null;
    var els = {};
    var session = { token: null, id: null, limits: null, consentVersion: null, featureEnabled: false, jobs: [], photos: [] };
    var product = null;
    var pendingFile = null;
    var pendingObjectUrl = null;
    var uploadId = null;
    var activeController = null;
    var generating = false;
    var capped = false;

    // Photo reuse (step 26's "selecting a second saree reuses the valid
    // photo"): 'new' shows the upload fields; 'reuse' shows a validated
    // photo_id already known for this session (from this page's own earlier
    // upload, or from session/resume's photos list) and skips straight to
    // Generate without a second upload.
    var photoMode = 'new';
    var reusablePhotoId = null;

    // One idempotency key per (product, variant) job attempt, stable across
    // a retried request but replaced once that attempt reaches a terminal
    // state, so a genuine user-requested retry is a new job as the contract
    // requires. Keyed in memory only; never persisted, since recovery after
    // a reload uses session/resume's own jobs list instead (server state is
    // authoritative, matching "resume from the server's persisted state").
    var pendingJobs = {};
    var currentJobId = null;
    var jobPollToken = 0;
    var latestOriginal = null;
    var latestResult = null;

    // The exact product/variant the ready job was created for, read from
    // the job's own server response rather than whatever the underlying
    // page's variant selector shows now (3.6/16: "changing the product
    // selector does not relabel an old result").
    var readyVariantGid = null;

    function readConfig() {
      var node = document.getElementById('tryonConfig');
      if (!node) return null;
      try { return JSON.parse(node.textContent); } catch (e) { return null; }
    }

    function cacheElements() {
      els = {
        saree: document.getElementById('tryonSaree'),
        sareeImage: document.getElementById('tryonSareeImage'),
        sareeTitle: document.getElementById('tryonSareeTitle'),
        changeSaree: document.getElementById('tryonChangeSaree'),
        signin: document.getElementById('tryonSignin'),
        signinBtn: document.getElementById('tryonSigninBtn'),
        photo: document.getElementById('tryonPhoto'),
        reuse: document.getElementById('tryonReuse'),
        useDifferentPhoto: document.getElementById('tryonUseDifferentPhoto'),
        uploadFields: document.getElementById('tryonUploadFields'),
        preview: document.getElementById('tryonPreview'),
        previewCaption: document.getElementById('tryonPreviewCaption'),
        file: document.getElementById('tryonFile'),
        consent: document.getElementById('tryonConsent'),
        progress: document.getElementById('tryonProgress'),
        stage: document.getElementById('tryonStage'),
        changePhoto: document.getElementById('tryonChangePhoto'),
        generate: document.getElementById('tryonGenerate'),
        counters: document.getElementById('tryonCounters'),
        notice: document.getElementById('tryonNotice'),
        create: document.getElementById('tryonCreate'),
        createStage: document.getElementById('tryonCreateStage'),
        cancelJob: document.getElementById('tryonCancelJob'),
        continueShopping: document.getElementById('tryonContinueShopping'),
        tryAgain: document.getElementById('tryonTryAgain'),
        ready: document.getElementById('tryonReady'),
        resultImg: document.getElementById('tryonResultImg'),
        toggleOriginal: document.getElementById('tryonToggleOriginal'),
        togglePreview: document.getElementById('tryonTogglePreview'),
        tryAnother: document.getElementById('tryonTryAnother'),
        download: document.getElementById('tryonDownload'),
        deleteBtn: document.getElementById('tryonDelete'),
        addToBag: document.getElementById('tryonAddToBag'),
        productLink: document.getElementById('tryonProductLink'),
        expired: document.getElementById('tryonExpired'),
        startNew: document.getElementById('tryonStartNew')
      };
    }

    function bindDialog() {
      var node = document.getElementById('tryOnModal');
      if (!node) return null;
      if (!node.dataset.tryonBound) {
        node.dataset.tryonBound = '1';
        dialog = node;
        config = readConfig() || config;
        enabled = !!document.getElementById('tryonConfig');
        api = enabled && window.NirahhTryOnAPI ? window.NirahhTryOnAPI.client(config.proxyPath) : null;
        cacheElements();

        // dialog.js's own Escape/backdrop/close-button listeners call its
        // closure-local setOpen directly, never through node._nirahhSetOpen,
        // so reacting only when we ourselves call it would miss most closes.
        // A MutationObserver on [hidden] catches every close (and open)
        // regardless of which code path triggered it.
        node._nirahhSetOpen = window.NirahhDialog(node);
        new MutationObserver(function () { onOpenChange(!node.hidden); })
          .observe(node, { attributes: true, attributeFilter: ['hidden'] });

        if (enabled) wireStaticHandlers();
        restorePendingIfSignedIn();

        // Abort any in-flight request on real navigation; dialog close
        // (onOpenChange above) already aborts for the dismiss case, but a
        // same-tab navigation away does not toggle the modal's hidden
        // attribute first.
        window.addEventListener('pagehide', function () {
          if (activeController) activeController.abort();
        });
      }
      return dialog;
    }

    function wireStaticHandlers() {
      if (els.file) els.file.addEventListener('change', onFileChange);
      if (els.consent) els.consent.addEventListener('change', updateGenerateEnabled);
      if (els.changePhoto) els.changePhoto.addEventListener('click', onChangePhotoClick);
      if (els.useDifferentPhoto) els.useDifferentPhoto.addEventListener('click', onUseDifferentPhotoClick);
      if (els.generate) els.generate.addEventListener('click', onGenerateClick);
      if (els.changeSaree) els.changeSaree.addEventListener('click', function () { dialog._nirahhSetOpen(false); });
      if (els.signinBtn) els.signinBtn.addEventListener('click', onSigninClick);
      if (els.cancelJob) els.cancelJob.addEventListener('click', onCancelJobClick);
      if (els.continueShopping) els.continueShopping.addEventListener('click', function () { dialog._nirahhSetOpen(false); });
      if (els.tryAgain) els.tryAgain.addEventListener('click', onTryAgainClick);
      if (els.toggleOriginal) els.toggleOriginal.addEventListener('click', function () { setComparison('original'); });
      if (els.togglePreview) els.togglePreview.addEventListener('click', function () { setComparison('preview'); });
      if (els.tryAnother) els.tryAnother.addEventListener('click', function () { dialog._nirahhSetOpen(false); });
      if (els.download) els.download.addEventListener('click', onDownloadClick);
      if (els.deleteBtn) els.deleteBtn.addEventListener('click', onDeleteClick);
      if (els.addToBag) els.addToBag.addEventListener('click', onAddToBagClick);
      if (els.startNew) els.startNew.addEventListener('click', function () { if (product) openForProduct(product); });
    }

    function onOpenChange(show) {
      if (show) return;
      if (activeController) { activeController.abort(); activeController = null; }
      // Dismissing the dialog pauses client-side polling only; the job
      // keeps running server-side (3.2 Create states) and is recovered from
      // session/resume's jobs list the next time this product is opened.
      jobPollToken++;
    }

    function newAbortController() {
      if (activeController) activeController.abort();
      activeController = new AbortController();
      return activeController;
    }

    function beginJobPollSequence() {
      return ++jobPollToken;
    }

    // ---- panel rendering --------------------------------------------------
    function showPanel(name) {
      if (els.signin) els.signin.hidden = name !== 'signin';
      if (els.photo) els.photo.hidden = name !== 'photo';
      if (els.create) els.create.hidden = name !== 'create';
      if (els.ready) els.ready.hidden = name !== 'ready';
      if (els.expired) els.expired.hidden = name !== 'expired';
    }

    function renderSaree(p) {
      if (els.sareeTitle) els.sareeTitle.textContent = p.title || '';
      if (els.sareeImage) {
        if (p.image) { els.sareeImage.src = p.image; els.sareeImage.alt = p.title || ''; els.sareeImage.hidden = false; }
        else els.sareeImage.hidden = true;
      }
    }

    function hideNotice() { if (els.notice) { els.notice.hidden = true; els.notice.textContent = ''; } }
    function showNotice(message, urgency) {
      if (!els.notice) return;
      els.notice.hidden = false;
      els.notice.textContent = message;
      els.notice.setAttribute('aria-live', urgency === 'assertive' ? 'assertive' : 'polite');
    }

    function setStage(text) {
      if (!els.stage) return;
      if (!text) { els.stage.hidden = true; els.stage.textContent = ''; return; }
      els.stage.hidden = false;
      els.stage.textContent = text;
    }
    function clearStage() { setStage(null); }

    function stageText(stage) {
      if (stage === 'queued') return 'Waiting to start\u2026';
      if (stage === 'creating') return 'Creating your preview\u2026';
      if (stage === 'checking') return 'Checking the result\u2026';
      return null;
    }
    function setCreateStage(text) { if (els.createStage) els.createStage.textContent = text || ''; }
    function hideTryAgain() { if (els.tryAgain) els.tryAgain.hidden = true; }

    function showProgress(loaded, total) {
      if (!els.progress) return;
      els.progress.hidden = false;
      els.progress.max = total || 100;
      els.progress.value = loaded || 0;
      setStage(null);
    }
    function hideProgress() { if (els.progress) els.progress.hidden = true; }

    function renderCounters() {
      if (!els.counters || !session.limits) return;
      var l = session.limits;
      els.counters.hidden = false;
      var sessionWord = l.remaining_generations === 1 ? 'attempt' : 'attempts';
      els.counters.textContent = l.remaining_generations + ' ' + sessionWord + ' left this session \u00b7 ' + l.account_generations_remaining_today + ' left today';
    }

    // Server-authoritative limits drive both the counters line and whether
    // Generate/Try another saree stay enabled; local state is never
    // authoritative (3.3). Account-day exhaustion is shown ahead of session
    // exhaustion when both are true.
    function applyLimits(limits) {
      if (!limits) return;
      session.limits = limits;
      renderCounters();
      capped = limits.effective_remaining_generations <= 0;
      updateGenerateEnabled();
      if (els.tryAnother) els.tryAnother.disabled = capped;
      if (capped) {
        if (limits.account_generations_remaining_today <= 0) {
          showNotice("You've used today's 5 previews across your account. More open at " + formatIST(limits.account_quota_resets_at) + ' tonight.', 'polite');
        } else {
          showNotice("You've used both previews for this session.", 'polite');
        }
      }
    }

    function updatePhotoModeView() {
      var reuse = photoMode === 'reuse' && !!reusablePhotoId;
      if (els.reuse) els.reuse.hidden = !reuse;
      if (els.uploadFields) els.uploadFields.hidden = reuse;
    }

    function resetPhotoPanel() {
      if (pendingObjectUrl) { URL.revokeObjectURL(pendingObjectUrl); pendingObjectUrl = null; }
      pendingFile = null;
      uploadId = null;
      if (els.preview) { els.preview.removeAttribute('src'); els.preview.hidden = true; }
      if (els.previewCaption) els.previewCaption.hidden = true;
      if (els.changePhoto) els.changePhoto.hidden = true;
      if (els.consent) els.consent.checked = false;
      if (els.file) els.file.value = '';
      hideProgress();
      clearStage();
      updateGenerateEnabled();
    }

    function resetForNewAttempt() {
      showPanel('photo');
      updatePhotoModeView();
      setPhotoControlsDisabled(false);
      clearStage();
      readyVariantGid = null;
      if (els.addToBag) els.addToBag.disabled = true;
    }

    function clearAllImages() {
      if (pendingObjectUrl) { URL.revokeObjectURL(pendingObjectUrl); pendingObjectUrl = null; }
      pendingFile = null;
      if (els.preview) { els.preview.removeAttribute('src'); els.preview.hidden = true; }
      if (els.resultImg) { els.resultImg.removeAttribute('src'); els.resultImg.setAttribute('alt', ''); }
      latestOriginal = null;
      latestResult = null;
      readyVariantGid = null;
      if (els.productLink) els.productLink.hidden = true;
      if (els.addToBag) els.addToBag.disabled = true;
      reusablePhotoId = null;
      photoMode = 'new';
    }

    function setPhotoControlsDisabled(disabled) {
      if (els.file) els.file.disabled = disabled;
      if (els.consent) els.consent.disabled = disabled;
      if (els.changePhoto) els.changePhoto.disabled = disabled;
      if (els.useDifferentPhoto) els.useDifferentPhoto.disabled = disabled;
      if (els.generate) els.generate.disabled = disabled || capped || !canGenerate();
    }

    function canGenerate() {
      if (!session.token) return false;
      if (photoMode === 'reuse') return !!reusablePhotoId;
      return !!(pendingFile && els.consent && els.consent.checked);
    }
    function updateGenerateEnabled() {
      if (els.generate) els.generate.disabled = capped || !canGenerate();
    }

    function onFileChange() {
      var file = els.file.files && els.file.files[0];
      if (!file) return;
      if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
      pendingFile = file;
      pendingObjectUrl = URL.createObjectURL(file);
      if (els.preview) { els.preview.src = pendingObjectUrl; els.preview.hidden = false; }
      if (els.previewCaption) els.previewCaption.hidden = false;
      if (els.changePhoto) els.changePhoto.hidden = false;
      hideNotice();
      updateGenerateEnabled();
    }

    function onChangePhotoClick() { resetPhotoPanel(); }

    function onUseDifferentPhotoClick() {
      photoMode = 'new';
      reusablePhotoId = null;
      updatePhotoModeView();
      updateGenerateEnabled();
    }

    function onSigninClick() {
      if (!product) return;
      store.set(KEYS.pending, JSON.stringify(product));
      var returnTo = window.location.pathname + window.location.search;
      var href = els.signinBtn.getAttribute('href') || config.loginUrl || '/account/login';
      var sep = href.indexOf('?') === -1 ? '?' : '&';
      els.signinBtn.setAttribute('href', href + sep + 'return_url=' + encodeURIComponent(returnTo));
    }

    // ---- session lifecycle --------------------------------------------
    function startSession(signal) {
      return api.sessionStart({ client_request_id: randomUUID(), locale: config.locale || 'en' }, signal);
    }

    function ensureSession(signal) {
      var token = store.get(KEYS.token);
      var attempt = token ? api.sessionResume({ session_token: token }, signal) : startSession(signal);
      return attempt.catch(function (err) {
        var identityStale = token && (err.code === 'SESSION_INVALID' || err.code === 'SESSION_EXPIRED' ||
          err.httpStatus === 404 || err.httpStatus === 410);
        if (!identityStale) throw err;
        store.remove(KEYS.token);
        store.remove(KEYS.id);
        return startSession(signal);
      }).then(function (data) {
        session.token = data.session_token || token;
        session.id = data.session_id;
        session.limits = data.limits;
        session.consentVersion = data.consent_version;
        session.featureEnabled = data.feature_enabled;
        session.jobs = data.jobs || [];
        session.photos = data.photos || [];
        if (session.token) store.set(KEYS.token, session.token);
        if (session.id) store.set(KEYS.id, session.id);
        return session;
      });
    }

    function checkEligibility(signal) {
      if (!product || !product.productGid || !product.variantGid) return Promise.resolve(null);
      return api.eligibility({
        session_token: session.token,
        items: [{ product_gid: product.productGid, variant_gid: product.variantGid }]
      }, signal).then(function (data) { return (data.items || [])[0] || null; });
    }

    function restorePendingIfSignedIn() {
      var raw = store.get(KEYS.pending);
      if (!raw) return;
      store.remove(KEYS.pending);
      if (!enabled || !config.signedIn) return;
      var pending;
      try { pending = JSON.parse(raw); } catch (e) { return; }
      openForProduct(pending);
    }

    // A resumed job still running or already ready can be shown again
    // without a new upload or a new job (F07, and the "dismissing the
    // dialog keeps the job recoverable" verify condition). A cancelled,
    // failed, quality-rejected, outcome-unknown or expired job is history,
    // not something to auto-restore (3.2's Cancelled row).
    function findResumableJob(jobsList, p) {
      if (!jobsList || !p) return null;
      for (var i = jobsList.length - 1; i >= 0; i--) {
        var j = jobsList[i];
        if (j.product_gid === p.productGid && j.variant_gid === p.variantGid &&
            (j.status === 'queued' || j.status === 'processing' || j.status === 'checking' || j.status === 'ready')) {
          return j;
        }
      }
      return null;
    }

    // ---- upload flow -----------------------------------------------------
    function pollUploadStatus(afterMs, signal) {
      return new Promise(function (resolve, reject) {
        function waitUntilVisible(cb) {
          if (!document.hidden) { cb(); return; }
          document.addEventListener('visibilitychange', function handler() {
            if (!document.hidden) { document.removeEventListener('visibilitychange', handler); cb(); }
          });
        }
        function tick(delay) {
          waitUntilVisible(function () {
            if (signal.aborted) return;
            api.uploadStatus({ session_token: session.token, upload_id: uploadId }, signal).then(function (data) {
              if (data.status === 'pending' || data.status === 'validating') {
                setStage(data.status === 'pending' ? 'Uploading your photo\u2026' : 'Checking your photo\u2026');
                setTimeout(function () { tick(data.poll_after_ms || delay); }, Math.min(data.poll_after_ms || delay, 8000));
              } else {
                resolve(data);
              }
            }).catch(reject);
          });
        }
        tick(afterMs || 1500);
      });
    }

    function showRejected(reason) {
      resetPhotoPanel();
      showNotice(REJECTION_MESSAGES[reason] || "We couldn't use that photo. Choose another one.", 'assertive');
    }

    function handleError(err) {
      if (err.limits) applyLimits(err.limits);
      if (err.code === 'CUSTOMER_LOGIN_REQUIRED' || err.code === 'SESSION_INVALID' || err.code === 'SESSION_EXPIRED') {
        store.remove(KEYS.token);
        store.remove(KEYS.id);
        showPanel('signin');
        return;
      }
      if (err.code === 'CONSENT_REQUIRED') { showNotice('Please check the consent box before continuing.', 'polite'); return; }
      if (err.code === 'UPLOAD_TOO_LARGE' || err.code === 'PHOTO_UNSUPPORTED' || err.code === 'PHOTO_UNSUITABLE') {
        showRejected(err.code);
        return;
      }
      if (err.code === 'JOB_LIMIT_REACHED') { showNotice('Another preview is being created right now. Try again in a moment.', 'polite'); return; }
      if (err.code === 'SESSION_GENERATION_LIMIT_REACHED') { showNotice("You've used both previews for this session.", 'polite'); return; }
      if (err.code === 'ACCOUNT_DAILY_GENERATION_LIMIT_REACHED') {
        var when = err.limits ? formatIST(err.limits.account_quota_resets_at) : 'tonight';
        showNotice("You've used today's 5 previews across your account. More open at " + when + ' tonight.', 'polite');
        return;
      }
      if (JOB_FAILURE_MESSAGES[err.code]) { showNotice(JOB_FAILURE_MESSAGES[err.code], 'assertive'); return; }
      showNotice(err.message || 'Something went wrong. Please try again.', 'assertive');
    }

    // ---- job creation, polling and results --------------------------------
    function ensureIdempotencyKey(key) {
      var rec = pendingJobs[key];
      if (rec && rec.idempotencyKey && !rec.terminal) return rec.idempotencyKey;
      var k = randomUUID();
      pendingJobs[key] = { idempotencyKey: k, terminal: false };
      return k;
    }
    function markJobTerminal(key) { if (pendingJobs[key]) pendingJobs[key].terminal = true; }

    function scheduleJobPoll(token, delayMs) {
      function waitUntilVisible(cb) {
        if (!document.hidden) { cb(); return; }
        document.addEventListener('visibilitychange', function handler() {
          if (!document.hidden) { document.removeEventListener('visibilitychange', handler); cb(); }
        });
      }
      setTimeout(function () {
        if (token !== jobPollToken) return;
        waitUntilVisible(function () {
          if (token !== jobPollToken) return;
          var controller = newAbortController();
          api.jobStatus({ session_token: session.token, job_id: currentJobId }, controller.signal).then(function (data) {
            if (token !== jobPollToken) return;
            handleJobStatus(data, token);
          }).catch(function (err) {
            if (err.name === 'AbortError' || token !== jobPollToken) return;
            handleError(err);
          });
        });
      }, delayMs || 3000);
    }

    // Single place that renders every JobState this dialog can see, whether
    // it arrived from a fresh create, a poll tick, or resuming a job found
    // in session/resume's list. Never overlaps with another in-flight poll
    // for a superseded sequence (the token check above and in every caller).
    function handleJobStatus(data, token) {
      currentJobId = data.job_id;
      applyLimits(data.limits);
      var key = jobKey({ productGid: data.product_gid, variantGid: data.variant_gid });

      if (data.status === 'queued' || data.status === 'processing' || data.status === 'checking') {
        showPanel('create');
        if (!capped) hideNotice();
        hideTryAgain();
        setCreateStage(stageText(data.stage));
        scheduleJobPoll(token, data.poll_after_ms);
        return;
      }

      markJobTerminal(key);

      if (data.status === 'ready') {
        // applyLimits above may have just shown the session/account-exhausted
        // notice for the attempt that produced this very result; keep it
        // beside the Ready panel rather than clobbering it (3.2's exhausted
        // rows: "Existing ready results ... remain active").
        if (!capped) hideNotice();
        renderReady(data);
        return;
      }
      if (data.status === 'cancelled') {
        if (!capped) hideNotice();
        resetForNewAttempt();
        return;
      }
      if (data.status === 'expired') {
        clearAllImages();
        showPanel('expired');
        return;
      }
      // failed / quality_rejected / outcome_unknown: 3.2 keeps the Create
      // panel, replacing the stage text with the failure notice. If no
      // retry is offered because the account/session is capped, keep the
      // more specific cap notice from applyLimits instead of the generic
      // failure text.
      showPanel('create');
      setCreateStage(null);
      if (data.retry_allowed || !capped) {
        showNotice(JOB_FAILURE_MESSAGES[data.error_code] || 'Something went wrong. Please try again.', 'assertive');
      }
      if (els.tryAgain) els.tryAgain.hidden = !data.retry_allowed;
    }

    function renderReady(data) {
      latestOriginal = data.original || null;
      latestResult = data.result || null;
      // Server-authoritative: the job's own variant_gid, not a possibly
      // since-changed live selector (3.6/16).
      readyVariantGid = data.variant_gid || (product && product.variantGid) || null;
      showPanel('ready');
      setComparison('preview');
      updateProductLink();
      if (els.addToBag) els.addToBag.disabled = !numericIdFromGid(readyVariantGid);
    }

    // The garment detail link always points at the real product page for
    // whichever product this dialog currently represents (3.1 Comparison:
    // "pointing at the real product photo and description"). Hidden when an
    // entry point did not carry a URL (e.g. the homepage CTA has no single
    // product) rather than guessing one.
    function updateProductLink() {
      if (!els.productLink) return;
      if (product && product.url) {
        els.productLink.href = product.url;
        els.productLink.hidden = false;
      } else {
        els.productLink.hidden = true;
      }
    }

    function setComparison(which) {
      var usingOriginal = which === 'original';
      if (els.toggleOriginal) els.toggleOriginal.setAttribute('aria-pressed', String(usingOriginal));
      if (els.togglePreview) els.togglePreview.setAttribute('aria-pressed', String(!usingOriginal));
      var asset = usingOriginal ? latestOriginal : latestResult;
      if (!els.resultImg || !asset) return;
      els.resultImg.src = asset.url || asset.result_url;
      els.resultImg.alt = usingOriginal ? 'Your original photo' : (asset.label || 'Your AI styling preview');
    }

    function submitJob(photoId) {
      var key = jobKey(product);
      var idempotencyKey = ensureIdempotencyKey(key);
      var token = beginJobPollSequence();
      showPanel('create');
      hideNotice();
      hideTryAgain();
      setCreateStage(stageText('queued'));
      var controller = newAbortController();
      api.createJob({
        session_token: session.token,
        photo_id: photoId,
        product_gid: product.productGid,
        variant_gid: product.variantGid,
        idempotency_key: idempotencyKey
      }, controller.signal).then(function (accepted) {
        currentJobId = accepted.job_id;
        applyLimits(accepted.limits);
        var c2 = newAbortController();
        return api.jobStatus({ session_token: session.token, job_id: accepted.job_id }, c2.signal);
      }).then(function (full) {
        generating = false;
        handleJobStatus(full, token);
      }).catch(function (err) {
        generating = false;
        if (err.name === 'AbortError') return;
        if (err.code === 'JOB_LIMIT_REACHED') {
          if (err.limits) applyLimits(err.limits);
          resetForNewAttempt();
          showNotice('Another preview is being created right now. Try again in a moment.', 'polite');
          return;
        }
        resetForNewAttempt();
        handleError(err);
      });
    }

    function onGenerateClick() {
      if (generating || !canGenerate()) return;
      generating = true;
      hideNotice();
      setPhotoControlsDisabled(true);

      if (photoMode === 'reuse' && reusablePhotoId) {
        submitJob(reusablePhotoId);
        return;
      }

      var file = pendingFile;
      var controller = newAbortController();
      showProgress(0, 100);

      api.sessionActivity({ session_token: session.token, action: 'generate' }, controller.signal).catch(function () {});

      api.uploadPrepare({
        session_token: session.token,
        filename: file.name,
        content_type: file.type,
        size_bytes: file.size,
        consent_version: session.consentVersion,
        accepted_self_adult_processing: true
      }, controller.signal).then(function (ticket) {
        uploadId = ticket.upload_id;
        return api.uploadFile(ticket, file, function (loaded, total) { showProgress(loaded, total); });
      }).then(function () {
        hideProgress();
        setStage('Checking your photo\u2026');
        return api.uploadComplete({ session_token: session.token, upload_id: uploadId }, controller.signal);
      }).then(function (accepted) {
        return pollUploadStatus(accepted.poll_after_ms, controller.signal);
      }).then(function (statusData) {
        clearStage();
        if (statusData.status === 'ready') {
          reusablePhotoId = statusData.photo_id;
          photoMode = 'reuse';
          submitJob(statusData.photo_id);
        } else if (statusData.status === 'rejected') {
          generating = false;
          showRejected(statusData.reason);
          setPhotoControlsDisabled(false);
        } else if (statusData.status === 'expired') {
          generating = false;
          resetPhotoPanel();
          showNotice('That upload expired. Choose your photo again.', 'polite');
          setPhotoControlsDisabled(false);
        }
      }).catch(function (err) {
        generating = false;
        if (err.name === 'AbortError') return;
        handleError(err);
        setPhotoControlsDisabled(false);
      });
    }

    function onCancelJobClick() {
      if (!currentJobId) return;
      var jobId = currentJobId;
      var controller = newAbortController();
      els.cancelJob.disabled = true;
      api.jobCancel({ session_token: session.token, job_id: jobId }, controller.signal).then(function (data) {
        els.cancelJob.disabled = false;
        currentJobId = null;
        applyLimits(data.limits);
        if (!capped) hideNotice();
        resetForNewAttempt();
      }).catch(function (err) {
        els.cancelJob.disabled = false;
        if (err.name === 'AbortError') return;
        handleError(err);
      });
    }

    function onTryAgainClick() {
      hideNotice();
      hideTryAgain();
      resetForNewAttempt();
    }

    // Refreshes the signed result link through an authorized status read
    // (never constructed or reused locally past its 60-second validity)
    // immediately before triggering the browser download.
    function onDownloadClick() {
      if (!currentJobId) return;
      var controller = newAbortController();
      api.jobStatus({ session_token: session.token, job_id: currentJobId }, controller.signal).then(function (data) {
        if (!data.result) return;
        latestOriginal = data.original || latestOriginal;
        latestResult = data.result;
        var a = document.createElement('a');
        a.href = data.result.result_url;
        a.download = 'nirahh-preview.jpg';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }).catch(function (err) { if (err.name !== 'AbortError') handleError(err); });
    }

    // Adds the exact product/variant the ready job was created for through
    // Shopify's own locale-aware Ajax cart endpoint (S04) — a separate
    // commerce boundary from the nirahh-tryon proxy, never carrying any
    // photo, capability or signed URL in its body. A sold-out/inventory
    // rejection (422) is routed to the product page, which already has
    // real-time stock UI, rather than inventing stock wording in the
    // dialog; any other failure shows the generic safe notice and lets the
    // shopper retry without leaving the dialog.
    function cartAddUrl() {
      var root = (config.cartRoot || '/').replace(/\/+$/, '');
      return root + '/cart/add.js';
    }

    function onAddToBagClick() {
      var variantId = numericIdFromGid(readyVariantGid);
      if (!variantId) { showNotice('Something went wrong. Please try again.', 'assertive'); return; }
      if (els.addToBag) els.addToBag.disabled = true;
      var controller = newAbortController();
      fetch(cartAddUrl(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: variantId, quantity: 1 }),
        signal: controller.signal
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          return { ok: response.ok, status: response.status, payload: payload };
        });
      }).then(function (result) {
        if (result.ok) {
          window.location.assign(config.cartUrl || '/cart');
          return;
        }
        if (els.addToBag) els.addToBag.disabled = false;
        if (result.status === 422) {
          window.location.assign((product && product.url) || config.cartUrl || '/');
          return;
        }
        showNotice('Something went wrong. Please try again.', 'assertive');
      }).catch(function (err) {
        if (els.addToBag) els.addToBag.disabled = false;
        if (err.name === 'AbortError') return;
        showNotice('Something went wrong. Please try again.', 'assertive');
      });
    }

    // Session-wide deletion is the only deletion operation the contract
    // exposes; there is no per-photo or per-job delete. It optimistically
    // clears the local view once the immediate revoke responds, rather than
    // blocking on /deletions/status completing (3.6).
    function onDeleteClick() {
      var controller = newAbortController();
      if (els.deleteBtn) els.deleteBtn.disabled = true;
      api.sessionDelete({ session_token: session.token }, controller.signal).then(function () {
        clearAllImages();
        store.remove(KEYS.token);
        store.remove(KEYS.id);
        session.token = null;
        session.id = null;
        session.limits = null;
        session.jobs = [];
        session.photos = [];
        currentJobId = null;
        pendingJobs = {};
        jobPollToken++;
        hideNotice();
        showPanel('expired');
      }).catch(function (err) {
        if (els.deleteBtn) els.deleteBtn.disabled = false;
        if (err.name === 'AbortError') return;
        handleError(err);
      });
    }

    // ---- entry point -------------------------------------------------
    function openForProduct(p) {
      var node = bindDialog();
      if (!node) return;
      product = p;
      renderSaree(p);

      if (!enabled) { node._nirahhSetOpen(true); return; }

      photoMode = 'new';
      reusablePhotoId = null;
      currentJobId = null;
      readyVariantGid = null;
      if (els.productLink) els.productLink.hidden = true;
      if (els.addToBag) els.addToBag.disabled = true;
      resetPhotoPanel();
      updatePhotoModeView();
      hideNotice();
      node._nirahhSetOpen(true);

      if (!config.signedIn) { showPanel('signin'); return; }

      showPanel('photo');
      setPhotoControlsDisabled(true);
      setStage('Preparing your session\u2026');

      var controller = newAbortController();
      ensureSession(controller.signal)
        .then(function () {
          api.sessionActivity({ session_token: session.token, action: 'select_product' }, controller.signal).catch(function () {});
          if (session.photos.length) {
            reusablePhotoId = session.photos[session.photos.length - 1].photo_id;
            photoMode = 'reuse';
          }
          var resumableJob = findResumableJob(session.jobs, p);
          return checkEligibility(controller.signal).then(function (eligibility) {
            return { eligibility: eligibility, job: resumableJob };
          });
        })
        .then(function (found) {
          clearStage();
          if (found.eligibility && found.eligibility.eligible === false) {
            // PRD.md 3.6: an ineligible product should never show a try-on
            // button at all (a catalogue check before Select photo, not a
            // dialog error). Full grid pre-filtering is deferred; until
            // then, this per-click fallback closes quietly rather than
            // inventing a dialog state the design does not define.
            node._nirahhSetOpen(false);
            return;
          }
          if (found.job) {
            var token = beginJobPollSequence();
            currentJobId = found.job.job_id;
            // JobSummary carries only a JobState (queued/processing/checking/
            // ready), not the finer JobStatusData.stage text; show a generic
            // placeholder until the authoritative jobStatus call below
            // replaces it (and may switch straight to the Ready panel).
            showPanel('create');
            setCreateStage(stageText('checking'));
            var c2 = newAbortController();
            api.jobStatus({ session_token: session.token, job_id: found.job.job_id }, c2.signal)
              .then(function (data) { handleJobStatus(data, token); })
              .catch(function (err) { if (err.name !== 'AbortError') handleError(err); });
            return;
          }
          updatePhotoModeView();
          setPhotoControlsDisabled(false);
          applyLimits(session.limits);
        })
        .catch(function (err) {
          if (err.name === 'AbortError') return;
          handleError(err);
        });
    }

    return { openForProduct: openForProduct, ensureBound: bindDialog };
  })();

  function init(scope) {
    // Bind the dialog (and so run restorePendingIfSignedIn) on every page
    // load, not just on a click, since a shopper returning from the Shopify
    // sign-in redirect never clicks anything on this load; they just arrive.
    // Binding alone makes no network call — only an actual pending marker
    // from before that redirect triggers openForProduct.
    TryOn.ensureBound();
    initButtons(scope);
  }

  init(document);

  // The theme editor can reload one section's markup without a full page
  // reload. Only the reloaded section's own buttons need (re-)binding; the
  // dialog lives in the layout and is never part of that swap.
  document.addEventListener('shopify:section:load', function (e) {
    initButtons(e.target);
  });
})();
