"""Validate the Shopify theme before it is zipped.

Shopify rejects an upload on a single malformed schema, and the error it gives
back names the file but not the problem. This checks the things that are cheap
to get wrong: JSON syntax, section types that point at files which do not
exist, blocks referenced by a template that the section does not define, and
assets referenced by a path Shopify cannot resolve.
"""

import json
import re
import sys
from pathlib import Path

THEME = Path(__file__).resolve().parent.parent / "shopify-theme"
SCHEMA = re.compile(r"{%-?\s*schema\s*-?%}(.*?){%-?\s*endschema\s*-?%}", re.S)
ASSET = re.compile(r"'([^']+)'\s*\|\s*asset_url")
RENDER = re.compile(r"{%-?\s*render\s+'([^']+)'")

errors = []
notes = []


def check_json_files():
    for path in sorted(THEME.rglob("*.json")):
        try:
            json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            errors.append(f"{path.relative_to(THEME)}: invalid JSON — {exc}")


def section_schemas():
    """Return {section name: parsed schema} and record any that fail to parse."""
    schemas = {}
    for path in sorted((THEME / "sections").glob("*.liquid")):
        found = SCHEMA.findall(path.read_text())
        if not found:
            errors.append(f"sections/{path.name}: no {{% schema %}} block")
            continue
        if len(found) > 1:
            errors.append(f"sections/{path.name}: {len(found)} schema blocks, expected 1")
        try:
            schemas[path.stem] = json.loads(found[0])
        except json.JSONDecodeError as exc:
            errors.append(f"sections/{path.name}: invalid schema JSON — {exc}")
    return schemas


def check_templates(schemas):
    for path in sorted((THEME / "templates").glob("*.json")):
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue  # already reported

        sections = data.get("sections", {})
        for sid in data.get("order", []):
            if sid not in sections:
                errors.append(f"templates/{path.name}: order lists '{sid}', which has no section")

        for sid, section in sections.items():
            stype = section.get("type")
            if stype not in schemas:
                errors.append(f"templates/{path.name}: section '{sid}' is type '{stype}', but sections/{stype}.liquid does not exist")
                continue

            declared = {b["type"] for b in schemas[stype].get("blocks", [])}
            blocks = section.get("blocks", {})
            for bid, block in blocks.items():
                if block.get("type") not in declared:
                    errors.append(
                        f"templates/{path.name}: block '{bid}' is type "
                        f"'{block.get('type')}', which sections/{stype}.liquid does not define"
                    )
            for bid in section.get("block_order", []):
                if bid not in blocks:
                    errors.append(f"templates/{path.name}: block_order lists '{bid}', which has no block")

            max_blocks = schemas[stype].get("max_blocks")
            if max_blocks and len(blocks) > max_blocks:
                errors.append(f"templates/{path.name}: section '{sid}' has {len(blocks)} blocks, max is {max_blocks}")


def check_settings_schema():
    path = THEME / "config" / "settings_schema.json"
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, FileNotFoundError):
        errors.append("config/settings_schema.json: missing or invalid")
        return
    if not data or data[0].get("name") != "theme_info":
        errors.append("config/settings_schema.json: first entry must be theme_info")


def check_references():
    """Assets and snippets referenced by name must exist, and be flat."""
    have_assets = {p.name for p in (THEME / "assets").iterdir()}
    have_snippets = {p.stem for p in (THEME / "snippets").glob("*.liquid")}

    for path in sorted(THEME.rglob("*.liquid")):
        text = path.read_text()
        where = path.relative_to(THEME)
        for asset in ASSET.findall(text):
            if "/" in asset:
                errors.append(f"{where}: asset_url on '{asset}' — Shopify's assets folder is flat, no subfolders")
            elif asset not in have_assets:
                errors.append(f"{where}: references asset '{asset}', which is not in assets/")
        for snippet in RENDER.findall(text):
            if snippet not in have_snippets:
                errors.append(f"{where}: renders snippet '{snippet}', which is not in snippets/")


def check_required_files():
    required = [
        "layout/theme.liquid",
        "config/settings_schema.json",
        "locales/en.default.json",
        "templates/index.json",
        "templates/product.json",
        "templates/collection.json",
        "templates/cart.json",
        "templates/404.json",
    ]
    for rel in required:
        if not (THEME / rel).exists():
            errors.append(f"{rel}: required by Shopify, missing")

    layout = (THEME / "layout" / "theme.liquid").read_text()
    for tag in ("content_for_header", "content_for_layout"):
        if tag not in layout:
            errors.append(f"layout/theme.liquid: must output {{{{ {tag} }}}}")


def check_liquid_balance():
    """Unclosed tags are the other thing Shopify rejects on."""
    pairs = [
        ("if", "endif"), ("unless", "endunless"), ("for", "endfor"),
        ("case", "endcase"), ("form", "endform"), ("paginate", "endpaginate"),
        ("comment", "endcomment"), ("schema", "endschema"), ("style", "endstyle"),
    ]
    for path in sorted(THEME.rglob("*.liquid")):
        text = path.read_text()
        # Comments and schemas can legally contain unbalanced words, so strip
        # them before counting.
        stripped = SCHEMA.sub("", text)
        stripped = re.sub(r"{%-?\s*comment\s*-?%}.*?{%-?\s*endcomment\s*-?%}", "", stripped, flags=re.S)
        for opener, closer in pairs:
            if opener in ("comment", "schema"):
                body = text
            else:
                body = stripped
            opens = len(re.findall(r"{%-?\s*" + opener + r"[\s%-]", body))
            closes = len(re.findall(r"{%-?\s*" + closer + r"\s*-?%}", body))
            if opens != closes:
                errors.append(
                    f"{path.relative_to(THEME)}: {opens} {{% {opener} %}} against "
                    f"{closes} {{% {closer} %}}"
                )


def summarise():
    counts = {d.name: len(list(d.glob("*"))) for d in sorted(THEME.iterdir()) if d.is_dir()}
    notes.append("  ".join(f"{k}: {v}" for k, v in counts.items()))


check_json_files()
schemas = section_schemas()
check_templates(schemas)
check_settings_schema()
check_references()
check_required_files()
check_liquid_balance()
summarise()

for note in notes:
    print(note)

if errors:
    print(f"\n{len(errors)} problem(s):")
    for err in errors:
        print(f"  - {err}")
    sys.exit(1)

print(f"\nOK — {len(schemas)} sections, all schemas and templates parse.")
