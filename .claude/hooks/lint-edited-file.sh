#!/bin/sh
# Runs after every agent edit: formats the file, then lints it.
# Lint errors go back to the agent (exit 2) so it fixes them right away.
set -u
cd "$CLAUDE_PROJECT_DIR" || exit 0

file=$(node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{process.stdout.write(JSON.parse(s).tool_input?.file_path??"")})')

case "$file" in
"$CLAUDE_PROJECT_DIR"/*) ;;
*) exit 0 ;;
esac

case "$file" in
*.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs) ;;
*.json | *.jsonc | *.md | *.css | *.yml | *.yaml)
	./node_modules/.bin/oxfmt "$file" >/dev/null 2>&1
	exit 0
	;;
*) exit 0 ;;
esac

./node_modules/.bin/oxfmt "$file" >/dev/null 2>&1
if ! out=$(./node_modules/.bin/oxlint --deny-warnings "$file" 2>&1); then
	printf 'Lint errors in %s. Fix them now. Why each rule exists: AGENTS.md "Lint rules".\n%s\n' "$file" "$out" >&2
	exit 2
fi
