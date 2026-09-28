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

  // ---- See yourself in it ----------------------------------------------
  // The real render-the-saree-onto-your-photo backend isn't built yet, so
  // this just opens a "coming soon" message rather than pretending to work.
  function initTryOn() {
    var modal = document.getElementById('tryOnModal');
    var openBtn = document.getElementById('tryOnBtn');
    var closeBtn = document.getElementById('modalClose');
    if (!modal || modal.dataset.bound) return;
    modal.dataset.bound = '1';

    function setModal(show) {
      modal.hidden = !show;
      document.body.style.overflow = show ? 'hidden' : '';
    }

    if (openBtn) openBtn.addEventListener('click', function () { setModal(true); });
    if (closeBtn) closeBtn.addEventListener('click', function () { setModal(false); });
    modal.addEventListener('click', function (e) { if (e.target === modal) setModal(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) setModal(false);
    });

    // A try-on link from a product page lands on this homepage anchor; open it.
    if (location.hash === '#try-on') setModal(true);
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
