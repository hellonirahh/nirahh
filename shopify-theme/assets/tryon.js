(function () {
  'use strict';

  // One shared fitting-room dialog for every entry point (homepage section,
  // product card and product page). The dialog itself is rendered once from
  // layout/theme.liquid via snippets/tryon-dialog.liquid, so it only needs
  // binding once; every entry point button just carries the product/variant
  // it was opened for, via data-tryon-* attributes. Steps 25-26 add the
  // sign-in, consent, upload and generation panels this dialog leaves for
  // them; this file only proves the right entry point opens with the right
  // product context, and that a theme-editor section reload never creates a
  // second dialog binding or a second click listener on the same button.

  function bindDialog() {
    var dialog = document.getElementById('tryOnModal');
    if (!dialog) return null;
    if (!dialog.dataset.tryonBound) {
      dialog.dataset.tryonBound = '1';
      dialog._nirahhSetOpen = window.NirahhDialog(dialog);
    }
    return dialog;
  }

  // A multi-variant product page only keeps the clicked button's own
  // data-tryon-variant-gid attribute in sync with the option selected at
  // render time; resolve the live selection from its form at click time
  // instead of trusting a stale attribute after the shopper changes it.
  function variantGidFor(button) {
    var form = button.closest('form');
    var input = form && form.querySelector('[name="id"]');
    if (input && input.value) return 'gid://shopify/ProductVariant/' + input.value;
    return button.dataset.tryonVariantGid || '';
  }

  function openFor(button) {
    var dialog = bindDialog();
    if (!dialog) return;
    var productGid = button.dataset.tryonProductGid || '';
    dialog.dataset.productGid = productGid;
    dialog.dataset.variantGid = productGid ? variantGidFor(button) : '';
    var context = dialog.querySelector('#tryOnContext');
    if (context) {
      var title = button.dataset.tryonTitle;
      context.textContent = title ? 'Preparing your preview of ' + title + '\u2026' : 'Preparing your preview\u2026';
    }
    dialog._nirahhSetOpen(true);
  }

  function initButtons(scope) {
    scope.querySelectorAll('[data-tryon-open]').forEach(function (button) {
      if (button.dataset.bound) return;
      button.dataset.bound = '1';
      button.addEventListener('click', function () { openFor(button); });
    });
  }

  function init(scope) {
    bindDialog();
    initButtons(scope);
  }

  init(document);

  // The theme editor swaps section markup without reloading the page. Only
  // the reloaded section's own buttons need (re-)binding; the dialog lives in
  // the layout and is never part of that swap.
  document.addEventListener('shopify:section:load', function (e) {
    initButtons(e.target);
  });
})();
