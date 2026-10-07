// Policy fragments are also ready to paste into Shopify's policy HTML editors.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const shell = fs.readFileSync(path.join(root, 'story.html'), 'utf8');
const policies = [
  ['shipping-policy', 'Shipping Policy', 'Where Nirahh ships, delivery estimates, shipping charges and tracking.'],
  ['return-damage-policy', 'Return &amp; Damage Policy', 'Nirahh’s return policy and how to report a damaged or defective saree.'],
  ['privacy-policy', 'Privacy Policy', 'How Nirahh collects, uses and protects your personal information.']
];

for (const [slug, title, description] of policies) {
  const content = fs.readFileSync(path.join(root, 'policies', slug + '.html'), 'utf8').trim();
  const page = shell
    .replace(/<title>.*?<\/title>/, `<title>${title} — Nirahh</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${description}">`)
    .replace(/<body>/, '<body>\n<a class="skip-link" href="#main">Skip to content</a>')
    .replace(/<main>[\s\S]*?<\/main>/, `<main id="main">
  <header class="wrap narrow page-head"><h1 class="display">${title}</h1></header>
  <article class="wrap narrow policy-content" aria-label="${title}">
${content}
  </article>
</main>`);
  fs.writeFileSync(path.join(root, slug + '.html'), page);
  console.log(`Built ${slug}.html`);
}
