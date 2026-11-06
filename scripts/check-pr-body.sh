#!/bin/sh
# Fails when a PR description (in $BODY) drops a required section of .github/pull_request_template.md.
set -eu

body=$(printf '%s\n' "${BODY:-}" | tr -d '\r')
missing=""

for heading in "## What changed" "## Decisions" "## Review notes"; do
	printf '%s\n' "$body" | grep -qxF "$heading" || missing="$missing
- $heading"
done
printf '%s\n' "$body" | grep -qE '^Made by: *[^ <]' || missing="$missing
- a filled-in \"Made by:\" line"

if [ -n "$missing" ]; then
	echo "The PR description is missing these parts of .github/pull_request_template.md:$missing" >&2
	exit 1
fi
echo "PR description follows the template."
