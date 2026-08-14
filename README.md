# Nirahh — storefront

A static prototype of the Nirahh homepage and storefront, built to the positioning:
**made for composure** — the saree complements the woman, never competes with her.

## Run it

No build step, no dependencies.

```bash
python3 -m http.server 4321
```

Then open http://localhost:4321

## Pages

| File | What it is |
|---|---|
| `index.html` | Homepage — all ten sections of the brief |
| `edit.html` | The Edit, grouped by Work / Events / Travel |
| `product.html` | One saree, chosen by `?saree=<handle>`; the whole collection runs through this single template |
| `note.html` | The Nirahh Note — editorial index |
| `story.html` | Our Story — the point of view |

## Shop

The catalogue lives in `assets/js/products.js`, one entry per saree. Adding a
saree means adding data, not a page.

Every piece is a single one, so the bag holds a saree or it does not — there is
no quantity stepper. `assets/js/cart.js` keeps that state in `localStorage` and
injects the bag drawer into every page, so the count survives reloads and
follows the visitor between pages. Checkout is deliberately a dead end until a
payment provider is connected.

Asset URLs carry a content hash (`?v=…`) so a browser cannot serve a stale
image after a file is replaced. Re-run `python3 tools/stamp_assets.py` after
changing anything under `assets/`.

## Homepage sections

1. **Announcement bar + header** — logo top-left, `NIRAHH` centred in the logo typeface, nav on its own row
2. **Hero** — medium height; statement left, portrait right
3. **Pillars** — light fabrics / quiet colours / considered drapes
4. **Shop by moment** — by occasion, not by fabric (the signature section)
5. **The Nirahh Edit** — a short rail; the narrowness is the positioning
6. **The Nirahh Point of View** — what we look for; this sells the eye
7. **See yourself in it** — try-on, with the technology kept invisible
8. **The Nirahh Note** — editorial; where the future presence/image work begins quietly
9. **Worn by women who have rooms to run** — real women, professions named, not influencers
10. **Footer** — shop / info / help / newsletter

## Brand assets

`tools/prepare_logo.py` derives the web assets from `assets/images/logo-full.png`:

- `logo-mark.png` — monogram with the card flood-filled away, used in the header
- `logo-lockup.png` — full lockup, edges feathered for placing on paper-toned panels
- `favicon.png`, `apple-touch-icon.png`

It also prints the sampled brand colours, which are mirrored in the CSS tokens
(`--gold #A8813C`, `--gold-light #C9A25E`, `--gold-deep #8A6829`).

Re-run it if the logo artwork is ever replaced:

```bash
python3 tools/prepare_logo.py
python3 tools/sync_header.py   # push header changes to the sub-pages
node tools/shoot.mjs           # screenshots to /tmp for a visual check
```

## Design system

Defined as custom properties in `assets/css/style.css`.

- **Palette** — ivory `#FBF8F3`, paper `#F3EEE5`, ink `#211E1A`, muted `#7C7266`, gold `#A8874C`
- **Type** — Cormorant Garamond (display/editorial) + Jost (UI, letterspaced uppercase)
- **Motion** — slow reveals on scroll, 1.1s image scale on hover; all disabled under `prefers-reduced-motion`

## Images

Everything in `assets/images/` is AI-generated placeholder art matching the art direction.
**Replace with real Nirahh photography before launch.** The direction to brief a photographer:

- Subject not smiling at camera; composed, mid-thought
- Real office and event environments, never studio-glam or bridal
- Matte fabrics, minimal jewellery, neat hair
- Warm neutral palette, soft natural light, generous negative space

## Porting to Shopify (Prestige)

The sections map cleanly onto Prestige:

| Nirahh section | Prestige section |
|---|---|
| Hero | Image with text overlay |
| Pillars | Multi-column / Image with text blocks |
| The Edit | Featured collection (limit 6) |
| Shop by moment | Collection list or Lookbook |
| Point of View | Image with text |
| The Complete Look | Shop the Look / hotspots |
| Worn by | Testimonials with images |
| The Note | Blog posts |

Build it in Prestige's free trial with real photography before purchasing.
