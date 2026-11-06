# Ruang Belajar

A general LMS for any class and any subject, with an AI tutor chat. It grows out of the physics-only "Ruang Fisika" design in `../mspd/` (PRDs in `a1/`, `a3/`; tutor prompt and tests in `a6/`). Read those for intent, not as rules for this repo.

`.claude/settings.json` excludes the parent `arra` instructions on purpose. They are coursework rules and do not apply here.

## Identity

The repo belongs to the student account. Commits use the repo-level git config, already set. Run every GitHub command through `../gh-arra`, never plain `gh`, and check `../gh-arra api user --jq .login` returns `azzahraputriya` first.

## Stack

TanStack Start (React, file routes in `src/routes/`), Vite, Nitro node server, Tailwind v4, oxlint, oxfmt, pnpm.

## Commands

- `pnpm dev` runs the dev server on port 3000.
- `pnpm build` writes the production server to `.output/`. Start it with `node .output/server/index.mjs`.
- `pnpm check` runs oxlint and checks oxfmt formatting. `pnpm format` fixes formatting.
