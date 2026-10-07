/* Shared by the static storefront and Shopify (copied to theme assets). */
(function () {
  'use strict';
  var activeClose;
  window.NirahhNavigation = function () {
    var toggle = document.getElementById('navToggle');
    var nav = document.getElementById('siteNav');
    if (!toggle || !nav || toggle.dataset.bound) return;
    toggle.dataset.bound = '1';
    var previousOverflow;
    function close() {
      if (!nav.classList.contains('open')) return;
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = previousOverflow;
    }
    toggle.addEventListener('click', function () {
      if (nav.classList.contains('open')) close();
      else {
        previousOverflow = document.body.style.overflow;
        nav.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
      }
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) close(); });
    nav.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || !nav.classList.contains('open')) return;
      var links = nav.querySelectorAll('a[href]');
      if ((!e.shiftKey && e.target === links[links.length - 1]) || (e.shiftKey && e.target === links[0])) {
        e.preventDefault();
        toggle.focus();
      }
    });
    toggle.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && nav.classList.contains('open')) {
        var links = nav.querySelectorAll('a[href]');
        if (links.length) { e.preventDefault(); links[e.shiftKey ? links.length - 1 : 0].focus(); }
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) { close(); toggle.focus(); }
    });
    window.matchMedia('(max-width: 820px)').addEventListener('change', function (e) {
      if (!e.matches) close();
    });
  };
  window.NirahhDialog = function (root) {
    var previousFocus, previousOverflow;
    var panel = root.querySelector('[role="dialog"]');
    panel.tabIndex = -1;
    function focusable() {
      return Array.from(panel.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'))
        .filter(function (el) { return !el.disabled && el.tabIndex >= 0 && el.getClientRects().length; });
    }
    function focusFirst() {
      (focusable()[0] || panel).focus();
    }
    function keydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
      } else if (e.key === 'Tab') {
        var items = focusable();
        var first = items[0], last = items[items.length - 1];
        if (!items.length || !panel.contains(document.activeElement) ||
            (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) ||
            (!e.shiftKey && (document.activeElement === last || document.activeElement === panel))) {
          e.preventDefault();
          (e.shiftKey ? last || panel : first || panel).focus();
        }
      }
    }
    function keepFocus(e) {
      if (!panel.contains(e.target)) focusFirst();
    }
    function setOpen(show) {
      if (show === !root.hidden) return;
      if (show) {
        if (activeClose) activeClose();
        previousFocus = document.activeElement;
        previousOverflow = document.body.style.overflow;
        root.hidden = false;
        document.body.style.overflow = 'hidden';
        activeClose = function () { setOpen(false); };
        document.addEventListener('keydown', keydown, true);
        document.addEventListener('focusin', keepFocus);
        focusFirst();
      } else {
        root.hidden = true;
        document.body.style.overflow = previousOverflow;
        document.removeEventListener('keydown', keydown, true);
        document.removeEventListener('focusin', keepFocus);
        activeClose = null;
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
      }
    }
    root.addEventListener('click', function (e) {
      if (e.target === root || e.target.closest('[data-close], .modal-close, a[href]')) setOpen(false);
    });
    return setOpen;
  };
})();
