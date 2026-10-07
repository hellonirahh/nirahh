# Shopify CLI deployment runbook

Use this runbook to authenticate, upload, publish, verify, and roll back Nirahh
theme changes from a terminal. Run commands from the repository root in Bash
or Zsh. Keep the same shell session so the variables below remain available.

Validated with Shopify CLI **4.8.5** on **8 October 2026**.

## Store and scope

- Store: `awjrt7-4f.myshopify.com`
- Theme source: `shopify-theme/`
- Static prototype: root HTML files and `assets/`; these are **not** uploaded by
  Shopify theme commands.
- Last verified live theme: `164776476929`, **Nirahh — reviewed 2026-10-08**.
- Previous theme: `163452420353`, **Nirahh**.

Those IDs are historical references. List themes before every deployment and
identify the current `live` theme; do not assume these IDs remain current.

Shopify admin is the source of truth for product images, collection content,
and saved theme settings. Do not enhance, compress, or replace those images
as part of a code deployment. Preserve remote theme assets and settings.

## 1. Set up the CLI and log in

Install Node.js and npm if needed. This function runs a pinned CLI from an npm
cache without adding dependencies to the project or requiring a global install:

```bash
export NIRAHH_STORE=awjrt7-4f.myshopify.com
export NIRAHH_CLI_CACHE="${TMPDIR:-/tmp}/nirahh-shopify-cli-cache"

shopify_cli() {
  npm exec --yes --cache "$NIRAHH_CLI_CACHE" \
    --package @shopify/cli@4.8.5 -- shopify "$@"
}

shopify_cli version
shopify_cli auth login
```

The CLI opens Shopify's device-login page and prints a one-time code. Complete
sign-in on Shopify, then wait for `Logged in` in the terminal. A human may need
to complete authentication; CLI-only deployment does not bypass Shopify login.
Never save passwords, one-time codes, tokens, or session cookies in this repo.

```bash
shopify_cli theme list --store "$NIRAHH_STORE" --json
```

Successful theme listing confirms access to this store. Theme deployment uses
`auth login`; `store auth` is a separate app-authentication flow for Admin API
operations and is not needed here.

For restricted agent environments, network access and writes to Shopify's
user-level preferences may require an escalated terminal command. After the
package has been downloaded, adding `--offline` immediately after `npm exec`
avoids npm registry lookups; Shopify commands still require network access.
Do not read credential files or use `--verbose` to troubleshoot authentication.

## 2. Validate the local changes

```bash
git status --short
git diff --check
npm ci
npm test
shopify_cli theme check --path shopify-theme
```

`npm test` uses local Chrome on macOS when available. Otherwise install the
Playwright browser with `npx playwright install chromium`, or set `CHROME_PATH`
to a Chrome executable. Browser tests may need permission to run outside an
agent sandbox. Theme Check validates Liquid and theme structure; the tests
cover storefront interactions but do not prove that live checkout works.

If editing static policy content, regenerate its pages and asset hashes first:

```bash
node tools/build_policy_pages.mjs
node tools/stamp_assets.mjs
```

Git staging is independent of deployment. The CLI uploads files on disk,
including unstaged changes. Inspect them before uploading. Keep `.idea/`,
credentials, generated ZIPs, and temporary release folders out of commits.

## 3. Pull the current live theme into a separate release folder

Copy the ID marked `live` from `theme list` into the variable below:

```bash
export NIRAHH_LIVE_THEME=REPLACE_WITH_CURRENT_LIVE_THEME_ID
export NIRAHH_PREVIOUS_THEME="$NIRAHH_LIVE_THEME"
export NIRAHH_RELEASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nirahh-release.XXXXXX")"
mkdir -p "$NIRAHH_RELEASE_DIR/live" "$NIRAHH_RELEASE_DIR/upload"

shopify_cli theme pull \
  --store "$NIRAHH_STORE" \
  --theme "$NIRAHH_LIVE_THEME" \
  --path "$NIRAHH_RELEASE_DIR/live"

cp -R "$NIRAHH_RELEASE_DIR/live/." "$NIRAHH_RELEASE_DIR/upload/"
```

Do not pull into `shopify-theme/`: that could overwrite local work. The `live`
directory is the untouched rollback snapshot; prepare the release in `upload`.
Keep the release folder until verification is complete. Temporary folders may
be removed by the operating system, so archive the snapshot outside the repo
if a longer-lived backup is needed.

## 4. Apply only the intended changes to the upload copy

Use an explicit list of changed theme files. For example, the Travel heading
fix changes only `sections/main-collection.liquid`:

```bash
NIRAHH_CHANGED_FILES=(
  sections/main-collection.liquid
)

for file in "${NIRAHH_CHANGED_FILES[@]}"; do
  diff -u "$NIRAHH_RELEASE_DIR/live/$file" "shopify-theme/$file"
done
```

Review these differences before copying. If a file includes newer remote edits,
merge the intended change into the upload copy instead of replacing that file.
A diff exit code of 1 means differences were found. For a new file, inspect it
directly and include it in the list. Include dependencies such as new scripts.

Once the file list and differences are correct:

```bash
for file in "${NIRAHH_CHANGED_FILES[@]}"; do
  mkdir -p "$(dirname "$NIRAHH_RELEASE_DIR/upload/$file")"
  cp "shopify-theme/$file" "$NIRAHH_RELEASE_DIR/upload/$file"
done
```

Preserve the pulled `config/settings_data.json`, `templates/*.json`, section
group JSON, and image/font assets unless a specific change requires updating
them. These can hold image selections, menus, section order, and merchant copy.
Never copy the entire local theme over the snapshot just to deploy a few fixes.

For an intentional text-setting change, edit the corresponding saved value in
the **upload copy** as well as its schema default in the source. Changing a
default alone does not replace a saved value. Do not rewrite a saved value only
at render time: the storefront and theme editor would disagree. Shopify JSON
files may start with a generated comment; account for it when parsing them.

## 5. Validate, package, and upload an unpublished draft

```bash
shopify_cli theme check --path "$NIRAHH_RELEASE_DIR/upload"
shopify_cli theme package --path "$NIRAHH_RELEASE_DIR/upload"
```

Packaging writes `THEME_NAME-THEME_VERSION.zip` in that directory, using the
values in `config/settings_schema.json`. With the current metadata:

```bash
cp "$NIRAHH_RELEASE_DIR/upload/Nirahh-1.0.0.zip" nirahh-shopify-theme.zip

shopify_cli theme push \
  --store "$NIRAHH_STORE" \
  --path "$NIRAHH_RELEASE_DIR/upload" \
  --unpublished \
  --theme "Nirahh — reviewed $(date +%Y-%m-%d-%H%M)" \
  --strict \
  --json
```

The CLI uploads the theme directory, **not the ZIP**. The ZIP is an archive of
the same release. Save the returned theme ID, `preview_url`, and `editor_url`.
Use the ID for later updates; repeating `--unpublished` creates another draft.

```bash
export NIRAHH_DRAFT_THEME=REPLACE_WITH_RETURNED_DRAFT_THEME_ID
shopify_cli theme list --store "$NIRAHH_STORE" --json

curl -L --fail --silent --show-error \
  -c "$NIRAHH_RELEASE_DIR/preview-cookies.txt" \
  -b "$NIRAHH_RELEASE_DIR/preview-cookies.txt" \
  "https://$NIRAHH_STORE/?preview_theme_id=$NIRAHH_DRAFT_THEME" \
  -o "$NIRAHH_RELEASE_DIR/preview.html"
```

Confirm the returned theme is `unpublished`. Check the rendered HTML for the
changed text and Liquid errors. Preview redirects require the cookie jar;
without it, curl can return the live theme instead. HTML checks do not verify
interactive behavior or visual layout; use the returned preview link for that.
Do not commit the cookie jar or captured pages.

## 6. Publish and verify

Publish when the release has been reviewed and publishing is authorized. An
agent should use an explicit publish request already given in the conversation;
do not ask again for the same authorized action. A request to upload a draft
alone is not a request to publish it.

```bash
shopify_cli theme publish \
  --store "$NIRAHH_STORE" \
  --theme "$NIRAHH_DRAFT_THEME" \
  --path "$NIRAHH_RELEASE_DIR/upload" \
  --force

shopify_cli theme list --store "$NIRAHH_STORE" --json

curl -L --fail --silent --show-error \
  "https://$NIRAHH_STORE/" \
  -o "$NIRAHH_RELEASE_DIR/published.html"
```

`--force` skips the CLI's interactive confirmation; it does not replace user
authorization. Verify that the expected ID now has role `live`, and the previous
theme is `unpublished`. Fetch the affected public routes without preview cookies
or `preview_theme_id`, for example `/collections/travel`, and confirm the actual
rendered result. Report the storefront link, verification result, and anything
outside the theme deployment that remains outstanding.

## 7. Small, explicitly requested live fixes

For a narrow follow-up to the live storefront, pull the current live file first,
review its diff, and validate the intended edit. Then upload only that file:

```bash
shopify_cli theme push \
  --store "$NIRAHH_STORE" \
  --theme "$NIRAHH_LIVE_THEME" \
  --allow-live \
  --path "$NIRAHH_RELEASE_DIR/upload" \
  --only sections/main-collection.liquid \
  --nodelete \
  --strict \
  --json
```

Refresh `NIRAHH_LIVE_THEME` after any publication; it may differ from the ID
recorded before publishing. Repeat `--only` for each required file. `--nodelete`
prevents deleting remote files absent locally, but does not protect files being
overwritten. Do not omit `--only` for a targeted fix. Verify the public route
afterwards. This edits the live theme immediately; no separate publish is needed.

## 8. Rollback

For a full release, republish the previous live theme recorded in step 3:

```bash
shopify_cli theme publish \
  --store "$NIRAHH_STORE" \
  --theme "$NIRAHH_PREVIOUS_THEME" \
  --path "$NIRAHH_RELEASE_DIR/live" \
  --force

shopify_cli theme list --store "$NIRAHH_STORE" --json
```

Keep `NIRAHH_PREVIOUS_THEME` set to the original pre-release ID. For an in-place
live fix, upload the affected file from the untouched
`live` snapshot using `--only`, `--nodelete`, and `--allow-live`. Verify the public
page again. Do not delete the previous theme during release or rollback.

## What theme deployment does not update

Theme commands do not update products, collection names/descriptions, Shopify
policy bodies, shipping rates, payment settings, or uploaded product media.
The HTML in `policies/` is source copy, not a deployment mechanism for Shopify
policies. Theme policy links point to Shopify's saved policies.

This runbook covers the theme-only CLI workflow. Admin API mutations are a
separate workflow with app authentication and appropriate permissions; theme
login does not imply that access. Do not claim those store records changed
because a theme upload succeeded.

## Official command references

- [Authentication](https://shopify.dev/docs/api/shopify-cli/auth/auth-login)
- [Pull](https://shopify.dev/docs/api/shopify-cli/theme/theme-pull)
- [Theme Check](https://shopify.dev/docs/api/shopify-cli/theme/theme-check)
- [Package](https://shopify.dev/docs/api/shopify-cli/theme/theme-package)
- [Push](https://shopify.dev/docs/api/shopify-cli/theme/theme-push)
- [Publish](https://shopify.dev/docs/api/shopify-cli/theme/theme-publish)

Run `shopify_cli COMMAND --help` when using a different CLI version; flags may
change. Record the tested CLI version and release theme IDs in the handoff.
