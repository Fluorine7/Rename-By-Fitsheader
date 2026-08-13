#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
name="Fluorine7BatchScripts-1.0.0.zip"
build_dir="$root/build"
package="$root/$name"

rm -rf "$build_dir" "$package"
mkdir -p "$build_dir/src/scripts/Fluorine7/LICENSES"

cp "$root/package.xml" "$build_dir/"
cp "$root/src/scripts/Fluorine7/"*.js "$build_dir/src/scripts/Fluorine7/"
# Include signatures automatically after they have been generated with
# Script > Development > CodeSign.
if compgen -G "$root/src/scripts/Fluorine7/*.xsgn" >/dev/null; then
   cp "$root/src/scripts/Fluorine7/"*.xsgn "$build_dir/src/scripts/Fluorine7/"
   python3 - "$build_dir/package.xml" "$build_dir/src/scripts/Fluorine7" <<'PY'
import pathlib, sys
manifest = pathlib.Path(sys.argv[1])
signature_dir = pathlib.Path(sys.argv[2])
text = manifest.read_text(encoding="utf-8")
entries = "".join(
    "         <file>src/scripts/Fluorine7/%s</file>\n" % path.name
    for path in sorted(signature_dir.glob("*.xsgn"))
)
text = text.replace("      </file-list>", entries + "      </file-list>")
manifest.write_text(text, encoding="utf-8")
PY
fi
cp "$root/LICENSES/"*.txt "$build_dir/src/scripts/Fluorine7/LICENSES/"

(
   cd "$build_dir"
   find . -type f -print | LC_ALL=C sort | zip -X -q "$package" -@
)

sha1="$(shasum -a 1 "$package" | awk '{print $1}')"
printf 'Built: %s\nSHA-1: %s\n' "$package" "$sha1"
printf '\nUpdate updates.xri with this SHA-1, then sign updates.xri with CodeSign.\n'
