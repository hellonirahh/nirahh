#!/bin/bash
# Package shopify-theme/ for upload.
#
# Shopify wants the folders (assets, config, layout, ...) at the top of the zip,
# not inside a wrapper folder, so this zips from within the theme directory.
set -euo pipefail

cd "$(dirname "$0")/.."
ZIP="nirahh-shopify-theme.zip"

python3 tools/check_theme.py

find shopify-theme -name '.DS_Store' -delete
rm -f "$ZIP"
(cd shopify-theme && zip -rq "../$ZIP" . -x '.*')

echo
echo "Wrote $ZIP  ($(du -h "$ZIP" | cut -f1), $(unzip -l "$ZIP" | tail -1 | awk '{print $2}') files)"
echo "Upload it at Online Store -> Themes -> Add theme -> Upload zip file."
