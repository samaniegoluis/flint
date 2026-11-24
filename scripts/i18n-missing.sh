#!/usr/bin/env bash
# Lists the core's message ids (src/domain/messages.cf, milestone 69) with no entry in
# the page's catalogs, and catalog entries that do not match the core.
#
#   scripts/i18n-missing.sh           # exit 1 when anything is missing or stale
#   scripts/i18n-missing.sh --core    # print the core's ids and English text as JSON
#
# For each id it checks that `core.<id>` exists in ui/src/i18n/en.json and es.json,
# that en.json's text is the core's own (the page shows the core's English, so the
# catalog's only mirrors it), and that es.json names the same params. A `core.*` key
# with no id in the core is reported too.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 -I - "$root" "${1:-}" <<'PY'
import json, re, sys
from pathlib import Path

root, mode = Path(sys.argv[1]), sys.argv[2]
domain = root / "src" / "domain"

# String constants of the domain package (NAME: str = "..."), for texts built with +.
consts = {}
for f in sorted(domain.glob("*.cf")):
    if f.name.endswith("_test.cf"):
        continue
    for m in re.finditer(r'^([A-Z][A-Z0-9_]*): str = "((?:[^"\\]|\\.)*)"\s*$', f.read_text(), re.M):
        consts[m.group(1)] = m.group(2)

def unquote(s):
    # cfire escapes: \{ is a literal brace (a param), \" and \\ as usual.
    return re.sub(r'\\(.)', lambda m: m.group(1), s)

def expr(e):
    out = ""
    for part in re.findall(r'"(?:[^"\\]|\\.)*"|[A-Z][A-Z0-9_]*', e):
        out += unquote(part[1:-1]) if part.startswith('"') else unquote(consts[part])
    return out

src = (domain / "messages.cf").read_text()
body = src[src.index("fn message_defs()"):]
core = {}
for m in re.finditer(r'MessageDef\{ id: (MSG_[A-Z0-9_]+), code: (ERR_[A-Z_]+), text: (.+?) \},?\s*$', body, re.M):
    core[unquote(consts[m.group(1)])] = expr(m.group(3))

if mode == "--core":
    print(json.dumps(core, indent=2, ensure_ascii=False))
    sys.exit(0)

def params(text):
    return sorted(set(re.findall(r"\{(\w+)\}", text)))

problems = []
cats = {}
for lang in ("en", "es"):
    cats[lang] = json.loads((root / "ui" / "src" / "i18n" / f"{lang}.json").read_text())
for id_, text in core.items():
    key = f"core.{id_}"
    for lang, cat in cats.items():
        if key not in cat:
            problems.append(f"missing  {lang}.json  {key}")
        elif lang == "en" and cat[key] != text:
            problems.append(f"stale    en.json  {key}: the core says {text!r}")
        elif params(cat[key]) != params(text):
            problems.append(f"params   {lang}.json  {key}: {params(cat[key])}, the core has {params(text)}")
for lang, cat in cats.items():
    for key in cat:
        if key.startswith("core.") and key[5:] not in core:
            problems.append(f"unknown  {lang}.json  {key}: no such id in the core")

for p in problems:
    print(p)
if problems:
    sys.exit(1)
print(f"i18n-missing: {len(core)} core ids, all in en.json and es.json")
PY
