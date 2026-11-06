# Ruang Belajar

A general LMS for any class and any subject, with an AI tutor chat. Product intent comes from the physics-only "Ruang Fisika" design in `../mspd/` (PRDs in `a1/`, `a3/`; tutor prompt and tests in `a6/`). That folder exists only on the original machine. Read it for intent, not as rules for this repo.

The data model, and the libraries chosen for it, are in `docs/data-model.md`. Use those: Postgres with Drizzle, better-auth with username login, and ArkType to parse input. Don't add an alternative such as Prisma or zod.

## Identity and GitHub

The repo belongs to the student account.

- Commit as `Azzahra Putriya Ahmad <321860017+azzahraputriya@users.noreply.github.com>`. In a fresh clone, set both with `git config` before the first commit.
- Run every GitHub command through `../gh-arra`, never plain `gh`. First check that `../gh-arra api user --jq .login` returns `azzahraputriya`. If `../gh-arra` is missing, stop and ask.
- `main` is protected. Work on a branch, then open a pull request with `../gh-arra pr create`. Titles use conventional commits, e.g. `feat(auth): username sign-up`.
- Don't remove `claudeMdExcludes` from `.claude/settings.json`. It keeps the parent folder's coursework instructions out.

## Generated files

`src/routeTree.gen.ts` is rebuilt from `src/routes/` on every `pnpm dev` and `pnpm build`. Never edit it. Change the route files instead.

## Before you finish

Always run `pnpm check` (lint and format) and `pnpm typecheck`. `pnpm format` fixes formatting. Then add:

- `pnpm build` when you change routes, server code, or `vite.config.ts`. To try the result, run `node .output/server/index.mjs`.
- `pnpm lint:probes` when you change `.oxlintrc.json`. Also add a probe and a row in `docs/lint-rules.md` for each new rule.

## Lint errors that need project knowledge

The edit hook reports every lint error with its rule. Most fixes are obvious from the message. These are not:

- `import/no-relative-parent-imports`: import with `#/...`, which maps to `src/`.
- `typescript/no-explicit-any` and `no-unsafe-*`: parse unknown data with ArkType where it enters, then use the parsed type.
- `no-console`: there is no logger yet. Don't log. Let errors throw with a clear message. If a feature really needs logs, stop and ask.
- A waiver needs a reason: `// oxlint-disable-next-line <rule> -- <why>`. Keep the existing one in `src/router.tsx`, because TanStack's type registration needs an `interface`.

Why each rule exists: `docs/lint-rules.md`.
