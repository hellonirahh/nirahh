/* The catalogue. One entry per saree, keyed by handle.
   This is the shape Shopify expects too — handle, title, price, images — so the
   move to a real store is a mapping job, not a rewrite. */
window.NIRAHH_PRODUCTS = [
  {
    handle: 'peacock-ombre',
    name: 'The Peacock Ombré',
    fabric: 'Ombré weave',
    price: 6548,
    stock: 1,
    images: [
      { src: 'assets/images/product-1.png?v=5178aacd', alt: 'Peacock ombré saree in blue, green and violet' }
    ],
    intro: 'The colour moves from blue through green into violet along the length, so it reads as one considered shade from across a room rather than as a pattern.',
    details: {
      Fabric: 'Soft ombré-dyed weave, mid-weight',
      Length: '6.3 metres, including an unstitched 0.8 m blouse piece',
      Drape: 'Holds a crisp pleat; pallu falls straight rather than fanning',
      Care: 'Dry clean only. Store folded, away from direct light.'
    }
  },
  {
    handle: 'midnight-bloom',
    name: 'The Midnight Bloom',
    fabric: 'Floral print',
    price: 6548,
    stock: 1,
    images: [
      { src: 'assets/images/product-2.png?v=20b0b30c', alt: 'Black saree with sage floral print' }
    ],
    intro: 'Black does most of the work here. The sage floral sits quietly on top of it — visible to someone standing beside you, invisible from the far end of a table.',
    details: {
      Fabric: 'Fine printed crêpe with a matte finish',
      Length: '6.3 metres, including an unstitched 0.8 m blouse piece',
      Drape: 'Fluid, close to the body; pleats sit flat all day',
      Care: 'Dry clean only. Do not wring.'
    }
  },
  {
    handle: 'aubergine-linen',
    name: 'The Aubergine Linen',
    fabric: 'Embroidered linen',
    price: 6548,
    stock: 1,
    images: [
      { src: 'assets/images/product-3.png?v=54c80ad3', alt: 'Aubergine linen saree with embroidered motifs' }
    ],
    intro: 'Aubergine is what I recommend to anyone who finds black severe and navy predictable. It is a serious colour that still has warmth in it.',
    details: {
      Fabric: 'Handwoven linen with tonal thread embroidery',
      Length: '6.3 metres, including an unstitched 0.8 m blouse piece',
      Drape: 'Structured; pleats stay sharp, pallu holds a fold',
      Care: 'Dry clean recommended. Light steam to release travel creases.'
    }
  },
  {
    handle: 'teal-linen',
    name: 'The Teal Linen',
    fabric: 'Handwoven linen',
    price: 7890,
    stock: 1,
    images: [
      { src: 'assets/images/product-4.png?v=9a708d20', alt: 'Teal linen saree' }
    ],
    intro: 'A deep teal with no print and no border to argue with it. When the saree is this quiet, the woman wearing it is what the room registers.',
    details: {
      Fabric: 'Handwoven linen, substantial weight',
      Length: '6.3 metres, including an unstitched 0.8 m blouse piece',
      Drape: 'Architectural; the pleats hold a line without pinning',
      Care: 'Dry clean only. Steam rather than iron.'
    }
  },
  {
    handle: 'lemon-linen',
    name: 'The Lemon Linen',
    fabric: 'Woven motifs',
    price: 6155,
    stock: 1,
    images: [
      { src: 'assets/images/product-5.png?v=ac1af338', alt: 'Pale lemon linen saree with woven motifs' }
    ],
    intro: 'Pale lemon is a difficult colour to get right — most versions read either washed out or sweet. This one is muted enough to stay professional.',
    details: {
      Fabric: 'Handwoven linen with self-toned woven motifs',
      Length: '6.3 metres, including an unstitched 0.8 m blouse piece',
      Drape: 'Light and airy; needs a slip in a matching tone',
      Care: 'Dry clean only. Keep away from damp storage.'
    }
  },
  {
    handle: 'ivory-citron',
    name: 'The Ivory Citron',
    fabric: 'Contrast border',
    price: 7120,
    stock: 1,
    images: [
      { src: 'assets/images/product-6.png?v=2e5f3ea2', alt: 'Ivory linen saree with citron border' }
    ],
    intro: 'Ivory with a citron border. The contrast does all of the talking, which means nothing else you wear with it has to.',
    details: {
      Fabric: 'Handwoven linen with a woven contrast border',
      Length: '6.3 metres, including an unstitched 0.8 m blouse piece',
      Drape: 'Falls clean and straight; the border weights the pallu',
      Care: 'Dry clean only. Fold along the border to protect it.'
    }
  }
];
