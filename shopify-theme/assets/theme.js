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
  function initVariants(scope) {
    scope.querySelectorAll('.pdp-form').forEach(function (form) {
      var select = form.querySelector('[name="id"]');
      if (!select || select.tagName !== 'SELECT' || select.dataset.bound) return;
      select.dataset.bound = '1';
      var info = form.closest('.pdp-info');
      var button = form.querySelector('[name="add"]');
      function update() {
        var option = select.options[select.selectedIndex];
        if (!option) { button.disabled = true; return; }
        info.querySelector('[data-variant-price]').textContent = option.dataset.price;
        var compare = info.querySelector('[data-variant-compare]');
        compare.textContent = option.dataset.compare;
        compare.hidden = !option.dataset.compare;
        info.querySelector('[data-variant-stock]').textContent = option.dataset.stock;
        button.disabled = option.dataset.available !== 'true';
        button.textContent = button.disabled ? button.dataset.soldLabel : button.dataset.addLabel;
        var image = form.closest('.pdp-grid').querySelector('#pdpMain');
        if (image && option.dataset.image) {
          image.src = option.dataset.image;
          image.alt = option.dataset.alt;
          form.closest('.pdp-grid').querySelectorAll('.pdp-thumb').forEach(function (thumb) {
            thumb.classList.toggle('active', thumb.dataset.full === option.dataset.image);
          });
        }
      }
      select.addEventListener('change', update);
      update();
    });
  }

  // The real render-the-saree-onto-your-photo backend isn't built yet, so
  // this just opens a "coming soon" message rather than pretending to work.
  function initTryOn() {
    var modal = document.getElementById('tryOnModal');
    var openBtn = document.getElementById('tryOnBtn');
    if (!modal || modal.dataset.bound) return;
    modal.dataset.bound = '1';

    var setModal = window.NirahhDialog(modal);
    if (openBtn) openBtn.addEventListener('click', function () { setModal(true); });

    // A try-on link from a product page lands on this homepage anchor; open it.
    if (location.hash === '#try-on') setModal(true);
  }

  // The try-on modal is not on every page, but the link from a product page is.
  // Sending it to the section anchor is enough; nothing to bind here.

  function init(scope) {
    window.NirahhNavigation();
    initRails(scope);
    initReveal(scope);
    initGallery(scope);
    initVariants(scope);
    initTryOn();
  }

  init(document);

  // The theme editor swaps section markup without reloading the page.
  document.addEventListener('shopify:section:load', function (e) {
    init(e.target);
  });
})();
