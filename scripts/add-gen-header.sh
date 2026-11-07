#!/bin/sh
# Prepends the `// Owns:` header a generated file in src/ needs. Usage: add-gen-header.sh <file> <owns text>
set -eu
head -1 "$1" | grep -q '^// Owns:' && exit 0
printf '// Owns: %s\n\n' "$2" | cat - "$1" >"$1.tmp"
mv "$1.tmp" "$1"
