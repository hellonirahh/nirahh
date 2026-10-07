# The Nirahh Shopify theme

For terminal-based deployment, use the [Shopify CLI runbook](SHOPIFY-CLI-RUNBOOK.md).
It covers login, preserving admin settings and images, draft uploads,
publishing, verification, and rollback. The instructions below cover store setup
and the alternative manual ZIP upload.

`shopify-theme/` is the site rebuilt as a Shopify theme. The static site in the
project root is untouched — this is a copy, not a replacement, so you can keep
showing the GitHub Pages link while the store is being set up.

The file to upload is **`nirahh-shopify-theme.zip`** in this folder.

---

## Upload it

1. Shopify admin → **Online Store → Themes**
2. Under *Theme library*, **Add theme → Upload zip file**
3. Choose `nirahh-shopify-theme.zip`
4. It appears in the library as **Nirahh**. Click **Customise** to see it.
5. Leave it unpublished until the setup below is done. Nothing is live until
   you press **Publish**.

---

## Set it up

The theme has the layout and the styling. Shopify holds the actual sarees,
photographs and words. Five things to fill in.

### 1. The navigation

**Online Store → Navigation → Main menu.** Replace what's there with:

| Name | Links to |
|---|---|
| Shop by moment | Collections (or your Office drapes collection) |
| Our Story | the Our Story page |
| The Nirahh Note | the blog |

The header reads whatever is in this menu, in this order.

### 2. The sarees

**Products → Add product**, one per saree. What each field drives:

- **Title** — the name on the card, e.g. *The Peacock Ombré*
- **Media** — the first image is the card; the rest become the thumbnails on
  the product page
- **Price** — shown on the card and the product page
- **Product type** — the small line under the name, e.g. *Ombré weave*
- **Description** — the paragraph on the product page
- **Inventory** — set *Track quantity* and enter **1**. The product page then
  shows "One piece only", and Shopify stops a second person buying it.

The processed saree photographs are in `assets/images/` (`product-1.png`
through `product-6.png`). Upload those as product media.

### 3. The Edit

**Products → Collections → Create collection**, call it *The Edit*, add the
sarees. Then in **Customise → The Edit**, choose it. The homepage rail fills
in automatically — you never edit the homepage again when you add a saree.

Do the same for each moment you want to sell into: *Office drapes*,
*Boardroom drapes*, *Evening drapes*, *Travel drapes*, *Celebration drapes*.
Give each a collection image; the Shop by moment cards use it.

### 4. The Note

**Content → Blogs.** Shopify makes one called *News* — rename it to
*The Nirahh Note*. Add the six articles you already have in `note.html`.
Then in **Customise → The Nirahh Note**, choose that blog.

### 5. Our Story

**Content → Pages → Add page**, titled *Our Story*. Paste the copy from
`story.html`. It picks up the site's typography on its own.

---

## Optional: the specification table

The product page can show a Fabric / Length / Drape / Care table. Shopify needs
to be told those fields exist first.

**Settings → Custom data → Products → Add definition.** Four of them, all type
*Single line text*, with these exact names:

| Name | Namespace and key |
|---|---|
| Fabric | `custom.fabric` |
| Length | `custom.length` |
| Drape | `custom.drape` |
| Care | `custom.care` |

Then each product gets a *Metafields* box at the bottom of its page. Fill in
what you know; anything left empty is simply not shown.

---

## What changed from the static site

Most of it is the same markup and the same stylesheet. Three things had to
change, because Shopify does them properly and the prototype was faking them.

**The bag is real.** `assets/js/cart.js` and its localStorage drawer are gone.
"Add to bag" now posts to Shopify, and the bag icon shows Shopify's own count.
Checkout, payment, tax and shipping are Shopify's, which is the entire reason
to be on Shopify.

**Products come from the admin.** `assets/js/products.js` is gone. Adding a
saree is adding a product, not editing a file.

**Everything is editable without code.** Each band of the homepage is a
Shopify *section* — you can reorder them, change the headings, swap the
photographs and hide the ones you don't want, by dragging in the theme editor.
The colours and the wordmark are under **Theme settings**.

The “See yourself in it” panel opens a coming-soon message; virtual try-on is not implemented. Fonts are bundled in the theme assets and served through Shopify’s CDN.

---

## Store policies

Shopify stores policy text in the store admin, separately from theme files.
Uploading the theme does not update the policies shown at checkout.
In **Settings → Policies**, paste the HTML from these files into the matching
policy editor's HTML view and save:

| Policy field | Source file |
|---|---|
| Shipping policy | `policies/shipping-policy.html` |
| Return and refund policy | `policies/return-damage-policy.html` |
| Privacy policy | `policies/privacy-policy.html` |

These contain the supplied October 2026 copy. The theme footer links to the
store's saved shipping, refund and privacy policies when their contents are
nonempty. These links use Shopify's native policy URLs so they match the
policies used at checkout. See the [Shopify policy object documentation](https://shopify.dev/docs/api/liquid/objects/policy).

The static site has corresponding standalone pages linked from every footer.
Policy content edits do not change checkout shipping rates or service settings.

## Rebuilding the zip

If the theme files change, rebuild with:

```bash
python3 tools/check_theme.py && ./tools/build_theme.sh
```

The first command catches the mistakes Shopify rejects uploads for; the second
writes a fresh `nirahh-shopify-theme.zip`.
