(function () {
  'use strict';

  // One shared fitting-room dialog for every entry point (homepage section,
  // product card and product page). The dialog itself is rendered once from
  // layout/theme.liquid via snippets/tryon-dialog.liquid; this file binds it
  // once, drives the session/consent/upload flow (step 25), and leaves the
  // job-creation and result panels (step 26) as an explicit, honest stop
  // point once a photo is validated, rather than a fabricated generation
  // state.

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
      image: button.dataset.tryonImage || ''
    };
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
    var config = { proxyPath: '', signedIn: false, loginUrl: '', locale: 'en' };
    var api = null;
    var els = {};
    var session = { token: null, id: null, limits: null, consentVersion: null, featureEnabled: false };
    var product = null;
    var pendingFile = null;
    var pendingObjectUrl = null;
    var uploadId = null;
    var activeController = null;

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
        preview: document.getElementById('tryonPreview'),
        previewCaption: document.getElementById('tryonPreviewCaption'),
        file: document.getElementById('tryonFile'),
        consent: document.getElementById('tryonConsent'),
        progress: document.getElementById('tryonProgress'),
        stage: document.getElementById('tryonStage'),
        changePhoto: document.getElementById('tryonChangePhoto'),
        generate: document.getElementById('tryonGenerate'),
        counters: document.getElementById('tryonCounters'),
        notice: document.getElementById('tryonNotice')
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
      }
      return dialog;
    }

    function wireStaticHandlers() {
      if (els.file) els.file.addEventListener('change', onFileChange);
      if (els.consent) els.consent.addEventListener('change', updateGenerateEnabled);
      if (els.changePhoto) els.changePhoto.addEventListener('click', onChangePhotoClick);
      if (els.generate) els.generate.addEventListener('click', onGenerateClick);
      if (els.changeSaree) els.changeSaree.addEventListener('click', function () { dialog._nirahhSetOpen(false); });
      if (els.signinBtn) els.signinBtn.addEventListener('click', onSigninClick);
    }

    function onOpenChange(show) {
      if (show) return;
      if (activeController) { activeController.abort(); activeController = null; }
    }

    function newAbortController() {
      if (activeController) activeController.abort();
      activeController = new AbortController();
      return activeController;
    }

    // ---- panel rendering --------------------------------------------------
    function showPanel(name) {
      if (els.signin) els.signin.hidden = name !== 'signin';
      if (els.photo) els.photo.hidden = name !== 'photo';
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

    function setPhotoControlsDisabled(disabled) {
      if (els.file) els.file.disabled = disabled;
      if (els.consent) els.consent.disabled = disabled;
      if (els.changePhoto) els.changePhoto.disabled = disabled;
      if (els.generate) els.generate.disabled = disabled || !canGenerate();
    }

    function canGenerate() {
      return !!(pendingFile && els.consent && els.consent.checked && session.token);
    }
    function updateGenerateEnabled() {
      if (els.generate) els.generate.disabled = !canGenerate();
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
      showNotice(err.message || 'Something went wrong. Please try again.', 'assertive');
    }

    function onGenerateClick() {
      if (!canGenerate()) return;
      var file = pendingFile;
      var controller = newAbortController();
      setPhotoControlsDisabled(true);
      hideNotice();
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
          // Step 26 takes over from a ready photo_id to create the job and
          // render the Create/Ready panels; this step stops here honestly
          // rather than fabricating a generation-in-progress state.
          showNotice("Your photo is ready. Generation isn't wired up yet in this build.", 'polite');
          setPhotoControlsDisabled(false);
        } else if (statusData.status === 'rejected') {
          showRejected(statusData.reason);
        } else if (statusData.status === 'expired') {
          resetPhotoPanel();
          showNotice('That upload expired. Choose your photo again.', 'polite');
        }
      }).catch(function (err) {
        if (err.name === 'AbortError') return;
        handleError(err);
        setPhotoControlsDisabled(false);
      });
    }

    // ---- entry point -------------------------------------------------
    function openForProduct(p) {
      var node = bindDialog();
      if (!node) return;
      product = p;
      renderSaree(p);

      if (!enabled) { node._nirahhSetOpen(true); return; }

      resetPhotoPanel();
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
          return checkEligibility(controller.signal);
        })
        .then(function (eligibility) {
          clearStage();
          if (eligibility && eligibility.eligible === false) {
            // PRD.md 3.6: an ineligible product should never show a try-on
            // button at all (a catalogue check before Select photo, not a
            // dialog error). Full grid pre-filtering is deferred; until
            // then, this per-click fallback closes quietly rather than
            // inventing a dialog state the design does not define.
            node._nirahhSetOpen(false);
            return;
          }
          setPhotoControlsDisabled(false);
          renderCounters();
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
