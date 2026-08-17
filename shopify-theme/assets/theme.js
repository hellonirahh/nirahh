(function () {
  'use strict';

  // Horizontal rails (the Edit, testimonials) advance by one visible page.
  function initRails(scope) {
    scope.querySelectorAll('.rail-next').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      var rail = document.getElementById(btn.dataset.rail);
      if (!rail) return;
      btn.addEventListener('click', function () {
        var atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 8;
        rail.scrollTo({ left: atEnd ? 0 : rail.scrollLeft + rail.clientWidth * 0.85, behavior: 'smooth' });
      });
    });
  }

  function initNav() {
    var toggle = document.getElementById('navToggle');
    var nav = document.getElementById('siteNav');
    if (!toggle || !nav || toggle.dataset.bound) return;
    toggle.dataset.bound = '1';
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  var observer = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px' });
  }

  function initReveal(scope) {
    scope.querySelectorAll('.reveal').forEach(function (el) {
      // A section re-rendered by the theme editor never scrolls into view, so it
      // would sit at opacity 0 forever. Show it outright in that case.
      if (!observer || window.Shopify && window.Shopify.designMode) {
        el.classList.add('in');
        return;
      }
      observer.observe(el);
    });
  }

  // ---- Product gallery -----------------------------------------------------
  function initGallery(scope) {
    var main = document.getElementById('pdpMain');
    if (!main) return;
    scope.querySelectorAll('.pdp-thumb').forEach(function (thumb) {
      if (thumb.dataset.bound) return;
      thumb.dataset.bound = '1';
      thumb.addEventListener('click', function () {
        main.src = thumb.dataset.full;
        main.alt = thumb.dataset.alt || '';
        document.querySelectorAll('.pdp-thumb').forEach(function (t) { t.classList.remove('active'); });
        thumb.classList.add('active');
      });
    });
  }

  // ---- See yourself in it --------------------------------------------------
  var objectUrl = null;
  var readTimer = null;

  function initTryOn() {
    var modal = document.getElementById('tryOnModal');
    var openBtn = document.getElementById('tryOnBtn');
    var closeBtn = document.getElementById('modalClose');
    if (!modal || modal.dataset.bound) return;
    modal.dataset.bound = '1';

    var upload = document.getElementById('uploadInput');
    var zone = document.getElementById('uploadZone');
    var stepUpload = document.getElementById('stepUpload');
    var stepPreview = document.getElementById('stepPreview');
    var previewImg = document.getElementById('previewImg');
    var previewTitle = document.getElementById('previewTitle');
    var previewStatus = document.getElementById('previewStatus');
    var previewStatusText = document.getElementById('previewStatusText');
    var resetBtn = document.getElementById('resetBtn');
    var doneBtn = document.getElementById('doneBtn');

    function reset() {
      if (readTimer) { clearTimeout(readTimer); readTimer = null; }
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      if (upload) upload.value = '';
      if (previewImg) previewImg.removeAttribute('src');
      if (stepPreview) stepPreview.hidden = true;
      if (stepUpload) stepUpload.hidden = false;
      if (previewStatus) previewStatus.classList.remove('done');
    }

    function setModal(show) {
      modal.hidden = !show;
      document.body.style.overflow = show ? 'hidden' : '';
      if (!show) reset();
    }

    function showPhoto(file) {
      if (!file || !/^image\//.test(file.type)) return;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file);

      previewImg.src = objectUrl;
      previewTitle.innerHTML = 'Reading the drape&hellip;';
      previewStatus.classList.remove('done');
      previewStatusText.textContent = 'Placing the Edit on you.';
      stepUpload.hidden = true;
      stepPreview.hidden = false;

      if (readTimer) clearTimeout(readTimer);
      readTimer = setTimeout(function () {
        previewTitle.textContent = 'Here you are.';
        previewStatus.classList.add('done');
        previewStatusText.textContent = 'Sarees from the Edit, drawn to your frame.';
      }, 1800);
    }

    if (openBtn) openBtn.addEventListener('click', function () { setModal(true); });
    if (closeBtn) closeBtn.addEventListener('click', function () { setModal(false); });
    modal.addEventListener('click', function (e) { if (e.target === modal) setModal(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) setModal(false);
    });

    if (upload && zone && stepUpload && stepPreview) {
      upload.addEventListener('change', function () {
        if (upload.files && upload.files[0]) showPhoto(upload.files[0]);
      });
      ['dragenter', 'dragover'].forEach(function (evt) {
        zone.addEventListener(evt, function (e) { e.preventDefault(); zone.classList.add('dragging'); });
      });
      ['dragleave', 'drop'].forEach(function (evt) {
        zone.addEventListener(evt, function () { zone.classList.remove('dragging'); });
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files[0]) showPhoto(e.dataTransfer.files[0]);
      });
      if (resetBtn) resetBtn.addEventListener('click', reset);
      if (doneBtn) doneBtn.addEventListener('click', function () { setModal(false); });
    }

    // A try-on link from a product page lands on the homepage anchor; open it.
    if (location.hash === '#try-on-open') setModal(true);
  }

  // The try-on modal is not on every page, but the link from a product page is.
  // Sending it to the section anchor is enough; nothing to bind here.

  function init(scope) {
    initNav();
    initRails(scope);
    initReveal(scope);
    initGallery(scope);
    initTryOn();
  }

  init(document);

  // The theme editor swaps section markup without reloading the page.
  document.addEventListener('shopify:section:load', function (e) {
    init(e.target);
  });
})();
