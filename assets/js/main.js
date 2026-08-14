(function () {
  'use strict';

  // Horizontal rails (the Edit, testimonials) advance by one visible page.
  document.querySelectorAll('.rail-next').forEach(function (btn) {
    var rail = document.getElementById(btn.dataset.rail);
    if (!rail) return;
    btn.addEventListener('click', function () {
      var atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 8;
      rail.scrollTo({ left: atEnd ? 0 : rail.scrollLeft + rail.clientWidth * 0.85, behavior: 'smooth' });
    });
  });

  var toggle = document.getElementById('navToggle');
  var nav = document.getElementById('siteNav');
  if (toggle && nav) {
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

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px' });

  document.querySelectorAll('.reveal').forEach(function (el) {
    observer.observe(el);
  });

  var modal = document.getElementById('tryOnModal');
  var openBtn = document.getElementById('tryOnBtn');
  var closeBtn = document.getElementById('modalClose');

  var setModal = function (show) {
    if (!modal) return;
    modal.hidden = !show;
    document.body.style.overflow = show ? 'hidden' : '';
    if (!show && typeof resetTryOn === 'function') resetTryOn();
  };

  if (openBtn) openBtn.addEventListener('click', function () { setModal(true); });
  if (closeBtn) closeBtn.addEventListener('click', function () { setModal(false); });
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) setModal(false);
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setModal(false);
  });

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

  var objectUrl = null;
  var readTimer = null;

  var resetTryOn = function () {
    if (readTimer) { clearTimeout(readTimer); readTimer = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    if (upload) upload.value = '';
    if (previewImg) previewImg.removeAttribute('src');
    if (stepPreview) stepPreview.hidden = true;
    if (stepUpload) stepUpload.hidden = false;
    if (previewStatus) previewStatus.classList.remove('done');
  };

  var showPhoto = function (file) {
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
      previewStatusText.textContent = 'Six sarees from the Edit, drawn to your frame.';
    }, 1800);
  };

  if (upload && zone && stepUpload && stepPreview) {
    upload.addEventListener('change', function () {
      if (upload.files && upload.files[0]) showPhoto(upload.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.add('dragging');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      zone.addEventListener(evt, function () { zone.classList.remove('dragging'); });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files[0]) showPhoto(e.dataTransfer.files[0]);
    });

    if (resetBtn) resetBtn.addEventListener('click', resetTryOn);
    if (doneBtn) doneBtn.addEventListener('click', function () { setModal(false); });
  }

  var form = document.getElementById('signupForm');
  var msg = document.getElementById('signupMsg');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      form.hidden = true;
      if (msg) msg.hidden = false;
    });
  }

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
