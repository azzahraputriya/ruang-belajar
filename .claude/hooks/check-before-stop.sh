#!/bin/sh
# Runs when the agent tries to finish: work is done only when format, lint, and types are green.
# Skips when nothing changed, and when it already blocked once this turn, so it can't loop forever.
set -u
cd "$CLAUDE_PROJECT_DIR" || exit 0

active=$(node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{process.stdout.write(String(JSON.parse(s).stop_hook_active===true))})')
[ "$active" = true ] && exit 0
[ -z "$(git status --porcelain)" ] && exit 0

./node_modules/.bin/oxfmt >/dev/null 2>&1
if ! out=$(./node_modules/.bin/oxlint --deny-warnings 2>&1 && pnpm --silent typecheck 2>&1); then
	printf 'Not done yet: lint or type check failed. Fix these, then finish.\n%s\n' "$out" >&2
	exit 2
fi
