# Ruang Belajar

A general LMS for any class and any subject, with an AI tutor chat. Product intent comes from the physics-only "Ruang Fisika" design in `../mspd/` (PRDs in `a1/`, `a3/`; tutor prompt and tests in `a6/`). That folder exists only on the original machine. Read it for intent, not as rules for this repo.

The data model, and the libraries chosen for it, are in `docs/data-model.md`. Use those: Postgres with Drizzle, better-auth with username login, and ArkType to parse input. Don't add an alternative such as Prisma or zod.

## Identity and GitHub

The repo belongs to the student account.

- Commit as `Azzahra Putriya Ahmad <321860017+azzahraputriya@users.noreply.github.com>`. In a fresh clone, set both with `git config` before the first commit.
- Run every GitHub command through `../gh-arra`, never plain `gh`. First check that `../gh-arra api user --jq .login` returns `azzahraputriya`. If `../gh-arra` is missing, stop and ask.
- `main` is protected. Work on a branch, then open a pull request with `../gh-arra pr create`. Titles use conventional commits, e.g. `feat(auth): username sign-up`.
- PR descriptions follow `.github/pull_request_template.md`. `gh pr create --body-file` skips the template, so copy its sections into your body file. CI's `pr-format` check fails without "What changed", "Decisions", "Review notes", and a filled-in `Made by: <model> via <harness>`.
  - List under "Assumed" every choice you made that the person didn't ask for.
  - Screenshots for "Evidence": save the PNGs locally and give the person their paths. They drag them in. Never link images from a branch.
- Don't remove `claudeMdExcludes` from `.claude/settings.json`. It keeps the parent folder's coursework instructions out.

## File boundaries

Every file in `src/` opens with `// Owns: <what this file is for>. Not here: <what goes elsewhere>.` Files have no length limit, so the header is what keeps each one focused.

- Before adding code to a file, read its header. Add the code only if it fits.
- If it doesn't fit, put it in the file whose header covers it (`rg "^// Owns:" src` lists them all), or create a new file with its own header.
- If a file's job really changes, update its header in the same edit.

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
