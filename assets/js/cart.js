/* The bag.
   Every saree in the Edit is a single piece, so the bag holds a saree or it
   does not — there is no quantity to step up and down. That keeps the drawer
   quiet and matches how the collection is actually bought.

   State lives in localStorage under one key so the bag survives a reload and
   stays in step across pages. */
(function () {
  'use strict';

  var KEY = 'nirahh-bag';
  var products = window.NIRAHH_PRODUCTS || [];

  var find = function (handle) {
    for (var i = 0; i < products.length; i++) {
      if (products[i].handle === handle) return products[i];
    }
    return null;
  };

  var read = function () {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(raw) ? raw.filter(find) : [];
    } catch (e) {
      return [];
    }
  };

  var write = function (handles) {
    try {
      localStorage.setItem(KEY, JSON.stringify(handles));
    } catch (e) {
      /* Private browsing can refuse writes; the bag still works for this page. */
    }
  };

  var money = function (n) {
    return '\u20B9' + n.toLocaleString('en-IN');
  };

  var Bag = {
    items: function () {
      return read().map(find);
    },
    has: function (handle) {
      return read().indexOf(handle) !== -1;
    },
    add: function (handle) {
      if (!find(handle) || Bag.has(handle)) return false;
      var handles = read();
      handles.push(handle);
      write(handles);
      sync();
      return true;
    },
    remove: function (handle) {
      write(read().filter(function (h) { return h !== handle; }));
      sync();
    },
    subtotal: function () {
      return Bag.items().reduce(function (sum, p) { return sum + p.price; }, 0);
    },
    money: money
  };

  /* ---------- drawer ---------- */

  var drawer, body, foot;

  var build = function () {
    drawer = document.createElement('div');
    drawer.className = 'drawer';
    drawer.id = 'cartDrawer';
    drawer.hidden = true;
    drawer.innerHTML =
      '<div class="drawer-scrim" data-close></div>' +
      '<aside class="drawer-panel" role="dialog" aria-modal="true" aria-label="Your bag">' +
        '<div class="drawer-head">' +
          '<h2 class="section-title">Your bag</h2>' +
          '<button class="drawer-close" data-close aria-label="Close bag">&times;</button>' +
        '</div>' +
        '<div class="drawer-body" id="bagBody"></div>' +
        '<div class="drawer-foot" id="bagFoot"></div>' +
      '</aside>';
    document.body.appendChild(drawer);
    body = drawer.querySelector('#bagBody');
    foot = drawer.querySelector('#bagFoot');

    drawer.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close')) setDrawer(false);
      var rm = e.target.closest('[data-remove]');
      if (rm) Bag.remove(rm.getAttribute('data-remove'));
    });
  };

  var setDrawer = function (show) {
    if (!drawer) return;
    if (show) render();
    drawer.hidden = !show;
    document.body.style.overflow = show ? 'hidden' : '';
    if (show) {
      var close = drawer.querySelector('.drawer-close');
      if (close) close.focus();
    }
  };

  var render = function () {
    if (!body) return;
    var items = Bag.items();

    if (!items.length) {
      body.innerHTML =
        '<div class="bag-empty">' +
          '<p class="lead">Your bag is empty.</p>' +
          '<a class="btn btn-ghost" href="edit.html">Browse the Edit</a>' +
        '</div>';
      foot.innerHTML = '';
      return;
    }

    body.innerHTML = items.map(function (p) {
      return '<article class="bag-item">' +
          '<a class="bag-thumb" href="product.html?saree=' + p.handle + '">' +
            '<img src="' + p.images[0].src + '" alt="' + p.images[0].alt + '">' +
          '</a>' +
          '<div class="bag-item-copy">' +
            '<h3><a href="product.html?saree=' + p.handle + '">' + p.name + '</a></h3>' +
            '<p class="product-meta">' + p.fabric + '</p>' +
            '<p class="price">' + money(p.price) + '</p>' +
            '<button class="bag-remove" data-remove="' + p.handle + '">Remove</button>' +
          '</div>' +
        '</article>';
    }).join('');

    foot.innerHTML =
      '<div class="bag-total"><span>Subtotal</span><span>' + money(Bag.subtotal()) + '</span></div>' +
      '<p class="fineprint">Shipping calculated at checkout. Complimentary above \u20B95,000.</p>' +
      '<button class="btn btn-solid bag-checkout" id="bagCheckout">Proceed to checkout</button>' +
      '<p class="signup-msg" id="bagCheckoutMsg" hidden>Checkout connects to the payment provider once the store goes live.</p>' +
      '<button class="bag-continue" data-close>Continue shopping</button>';

    var pay = foot.querySelector('#bagCheckout');
    if (pay) {
      pay.addEventListener('click', function () {
        var msg = foot.querySelector('#bagCheckoutMsg');
        if (msg) msg.hidden = false;
      });
    }
  };

  /* ---------- header count + toast ---------- */

  var sync = function () {
    var n = read().length;
    document.querySelectorAll('.bag-count').forEach(function (el) {
      el.textContent = String(n);
      el.classList.toggle('is-empty', n === 0);
    });
    document.querySelectorAll('.icon-btn.bag').forEach(function (el) {
      el.setAttribute('aria-label', 'Bag, ' + n + (n === 1 ? ' item' : ' items'));
    });
    if (drawer && !drawer.hidden) render();
    document.dispatchEvent(new CustomEvent('bag:change'));
  };

  var toastTimer = null;
  Bag.toast = function (text) {
    var el = document.getElementById('bagToast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.id = 'bagToast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    /* Re-trigger the transition when a second saree is added in quick succession. */
    el.classList.remove('in');
    void el.offsetWidth;
    el.classList.add('in');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('in'); }, 2600);
  };

  Bag.open = function () { setDrawer(true); };
  Bag.close = function () { setDrawer(false); };

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer && !drawer.hidden) setDrawer(false);
  });

  var start = function () {
    build();
    document.querySelectorAll('.icon-btn.bag').forEach(function (btn) {
      btn.addEventListener('click', function () { setDrawer(true); });
    });
    sync();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.NirahhBag = Bag;
})();
