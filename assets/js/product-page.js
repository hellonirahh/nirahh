/* Renders one saree from the catalogue into product.html, chosen by ?saree=.
   One template for the whole collection, the way a Shopify product template
   works — so adding the other 60-odd sarees means adding data, not pages. */
(function () {
  'use strict';

  var mount = document.getElementById('pdp');
  if (!mount) return;

  var products = window.NIRAHH_PRODUCTS || [];
  var Bag = window.NirahhBag;
  var money = function (n) { return '\u20B9' + n.toLocaleString('en-IN'); };

  var handle = new URLSearchParams(location.search).get('saree');
  var product = products.filter(function (p) { return p.handle === handle; })[0];

  if (!product) {
    mount.innerHTML =
      '<section class="wrap narrow page-head center">' +
        '<p class="eyebrow">Not found</p>' +
        '<h1 class="display">That saree is no longer in the Edit.</h1>' +
        '<p class="lead">Everything we have is a single piece, so pieces do leave.</p>' +
        '<p style="margin-top:2rem"><a class="btn btn-solid" href="edit.html">See what is here now</a></p>' +
      '</section>';
    return;
  }

  document.title = product.name + ' — Nirahh';
  var desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', product.intro);

  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  var gallery = product.images.map(function (img, i) {
    return '<button class="pdp-thumb' + (i === 0 ? ' active' : '') + '" data-index="' + i + '" aria-label="View image ' + (i + 1) + '">' +
      '<img src="' + img.src + '" alt=""></button>';
  }).join('');

  var details = Object.keys(product.details).map(function (k) {
    return '<div class="spec"><dt>' + esc(k) + '</dt><dd>' + esc(product.details[k]) + '</dd></div>';
  }).join('');

  var related = products.filter(function (p) { return p.handle !== product.handle; }).slice(0, 4).map(function (p) {
    return '<article class="product">' +
        '<a class="product-media" href="product.html?saree=' + p.handle + '">' +
          '<img src="' + p.images[0].src + '" alt="' + esc(p.images[0].alt) + '"></a>' +
        '<h3><a href="product.html?saree=' + p.handle + '">' + esc(p.name) + '</a></h3>' +
        '<p class="product-meta">' + esc(p.fabric) + '</p>' +
        '<p class="price">' + money(p.price) + '</p>' +
      '</article>';
  }).join('');

  mount.innerHTML =
    '<nav class="crumbs wrap" aria-label="Breadcrumb">' +
      '<a href="index.html">Home</a><span>/</span><a href="edit.html">The Edit</a>' +
      '<span>/</span><span aria-current="page">' + esc(product.name) + '</span>' +
    '</nav>' +

    '<div class="wrap pdp-grid">' +
      '<div class="pdp-gallery">' +
        '<figure class="pdp-main"><img id="pdpMain" src="' + product.images[0].src + '" alt="' + esc(product.images[0].alt) + '"></figure>' +
        (product.images.length > 1 ? '<div class="pdp-thumbs">' + gallery + '</div>' : '') +
      '</div>' +

      '<div class="pdp-info">' +
        '<h1 class="pdp-title">' + esc(product.name) + '</h1>' +
        '<p class="pdp-fabric">' + esc(product.fabric) + '</p>' +
        '<p class="pdp-price">' + money(product.price) + '</p>' +
        '<p class="pdp-stock">One piece only \u00B7 in stock</p>' +

        '<p class="pdp-intro">' + esc(product.intro) + '</p>' +

        '<div class="pdp-actions">' +
          '<button class="btn btn-solid pdp-add" id="addToBag">Add to bag</button>' +
          '<button class="btn btn-ghost pdp-try" id="tryOnBtn">See yourself in it</button>' +
        '</div>' +
        '<dl class="pdp-specs">' + details + '</dl>' +
      '</div>' +
    '</div>' +

    '<section class="section">' +
      '<div class="wrap rail-head">' +
        '<div><h2 class="section-title">Also in the Edit</h2></div>' +
        '<a class="rail-link" href="edit.html">View all</a>' +
      '</div>' +
      '<div class="wrap"><div class="product-grid">' + related + '</div></div>' +
    '</section>';

  /* Gallery */
  var main = document.getElementById('pdpMain');
  mount.querySelectorAll('.pdp-thumb').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var img = product.images[Number(btn.dataset.index)];
      main.src = img.src;
      main.alt = img.alt;
      mount.querySelectorAll('.pdp-thumb').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
    });
  });

  /* Add to bag */
  var addBtn = document.getElementById('addToBag');

  var paint = function () {
    if (!Bag) return;
    var inBag = Bag.has(product.handle);
    addBtn.textContent = inBag ? 'In your bag — view bag' : 'Add to bag';
    addBtn.classList.toggle('in-bag', inBag);
  };

  if (addBtn && Bag) {
    addBtn.addEventListener('click', function () {
      if (Bag.has(product.handle)) {
        Bag.open();
        return;
      }
      Bag.add(product.handle);
      Bag.toast(product.name + ' is in your bag.');
      paint();
    });
    document.addEventListener('bag:change', paint);
    paint();
  }
})();
