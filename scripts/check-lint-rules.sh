#!/bin/sh
# Proves each key lint rule still fires: writes one file that breaks it, expects that exact rule ID.
# A rule that silently stops firing (resolver change, version bump) fails here, not in review.
set -eu

dir=src/lint-probes
rm -rf "$dir"
mkdir -p "$dir/nested"
trap 'rm -rf "$dir"' EXIT
trap 'exit 1' HUP INT PIPE TERM

probe() {
	printf '%b' "$3" >"$dir/$1"
	expected="$expected $1|$2"
}
expected=""

probe default-export.ts 'import(no-default-export)' 'export default 1;\n'
probe nested/parent-import.ts 'import(no-relative-parent-imports)' 'import { a } from "../cycle-a";\nexport const p = a;\n'
probe cycle-a.ts 'import(no-cycle)' 'import { b } from "#/lint-probes/cycle-b";\nexport const a = (): number => b() + 1;\n'
probe cycle-b.ts 'import(no-cycle)' 'import { a } from "#/lint-probes/cycle-a";\nexport const b = (): number => a();\n'
probe floating-promise.ts 'typescript(no-floating-promises)' 'const f = async () => 1;\nexport const g = () => {\n\tf();\n};\n'
probe explicit-any.ts 'typescript(no-explicit-any)' 'export const x: any = 1;\n'
probe non-null.ts 'typescript(no-non-null-assertion)' 'export const f = (s?: string) => s!.length;\n'
probe interface.ts 'typescript(consistent-type-definitions)' 'export interface Thing {\n\tid: string;\n}\n'
probe console.ts 'eslint(no-console)' 'console.log("hi");\nexport {};\n'
probe eval.ts 'eslint(no-eval)' 'export const r = eval("1");\n'
probe BadName.ts 'unicorn(filename-case)' 'export const bad = 1;\n'

out=$(./node_modules/.bin/oxlint "$dir" 2>&1 || true)

failed=0
for item in $expected; do
	file=${item%%|*}
	rule=${item#*|}
	if ! printf '%s\n' "$out" | grep -F "$dir/$file:" | grep -qF "$rule"; then
		echo "lint rule did not fire: $rule on $file" >&2
		failed=1
	fi
done

if [ "$failed" -ne 0 ]; then
	printf '%s\n' "$out" >&2
	exit 1
fi
echo "All $(echo "$expected" | wc -w | tr -d ' ') lint probes fired."
