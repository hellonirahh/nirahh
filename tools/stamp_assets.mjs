// Node equivalent of stamp_assets.py, for storefront-only environments.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const digest = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 8);
const catalogue = path.join(root, 'assets/js/products.js');
fs.writeFileSync(catalogue, fs.readFileSync(catalogue, 'utf8').replace(/(src: ')(assets\/[^'?]+)(\?v=[0-9a-f]+)?(')/g,
  (_, prefix, file, version, suffix) => `${prefix}${file}?v=${digest(file)}${suffix}`));
for (const page of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
  const file = path.join(root, page);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(src|href)="(assets\/[^"?]+)(\?v=[0-9a-f]+)?"/g,
    (_, attr, asset) => `${attr}="${asset}?v=${digest(asset)}"`));
}
