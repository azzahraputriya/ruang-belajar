#!/bin/sh
# Adds shadcn/ui components, then makes them pass this repo's lint.
# The shadcn CLI can't resolve the `#/` alias, so it imports `cn` from a stray "cn" package. We point it at #/lib/utils instead.
# The CLI is pinned so these fix-ups keep matching what it writes. Bump it on purpose and re-check.
# Usage: pnpm ui:add button dialog
set -eu

pnpm dlx shadcn@4.23.0 add "$@" -y
if grep -q '"cn": "' package.json; then pnpm remove cn; fi

for file in src/components/ui/* src/hooks/*; do
	[ -f "$file" ] || continue
	perl -pi -e 's|from "cn"|from "#/lib/utils"|; s|from "@/|from "#/|' "$file"
	head -1 "$file" | grep -q '^// Owns:' && continue
	name=$(basename "$file" | sed 's/\.[^.]*$//')
	printf '// Owns: shadcn/ui %s, as generated. Not here: app-specific changes (wrap it in src/components/).\n\n' "$name" | cat - "$file" >"$file.tmp"
	mv "$file.tmp" "$file"
done
./node_modules/.bin/oxfmt src/components/ui >/dev/null
[ -d src/hooks ] && ./node_modules/.bin/oxfmt src/hooks >/dev/null
echo "Added. Run pnpm check to confirm they pass lint."
