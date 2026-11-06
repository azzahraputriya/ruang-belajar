# Ruang Belajar

A general LMS for any class and any subject, with an AI tutor chat. It grows out of the physics-only "Ruang Fisika" design in `../mspd/` (PRDs in `a1/`, `a3/`; tutor prompt and tests in `a6/`). Read those for intent, not as rules for this repo. The data model draft is `docs/data-model.md`.

`.claude/settings.json` excludes the parent `arra` instructions on purpose. They are coursework rules and do not apply here.

## Identity

The repo belongs to the student account. Commits use the repo-level git config, already set. Run every GitHub command through `../gh-arra`, never plain `gh`, and check `../gh-arra api user --jq .login` returns `azzahraputriya` first.

`main` is protected. Work on a branch and open a pull request.

## Stack

TanStack Start (React, file routes in `src/routes/`), Vite, Nitro node server, Tailwind v4, oxlint (type-aware), oxfmt, pnpm.

## Commands

- `pnpm dev` runs the dev server on port 3000.
- `pnpm build` writes the production server to `.output/`. Start it with `node .output/server/index.mjs`.
- `pnpm check` runs oxlint and checks oxfmt formatting. `pnpm format` fixes formatting.
- `pnpm typecheck` runs `tsc`.
- `pnpm lint:probes` proves each lint rule below still fires.

## Lint rules

Lint is the spec. Code is done when `pnpm check` and `pnpm typecheck` pass. Claude Code hooks lint every file you edit and block finishing until both pass. The pre-push hook runs them again.

| Rule                                                                        | What it asks                                      | Why                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `import/no-default-export`                                                  | Named exports only. Config files are exempt.      | `rg "export const Foo"` finds every definition.                        |
| `typescript/consistent-type-imports`                                        | `import type` for types.                          | Types vanish at build time, and the intent is visible.                 |
| `unicorn/filename-case`                                                     | kebab-case file names. Routes are exempt.         | Predictable paths to glob. TanStack routes need `__root` and `$param`. |
| `max-lines`                                                                 | 300 lines per file at most.                       | Small files are easier to read whole and to place.                     |
| `import/no-relative-parent-imports`                                         | Import with `#/...`, never `../`.                 | One absolute path per module. Moves don't break imports.               |
| `import/no-cycle`                                                           | No import cycles.                                 | Cycles hide layering mistakes and break load order.                    |
| `typescript/no-explicit-any`, `no-unsafe-*`                                 | No `any`, and no unchecked use of untyped values. | Parse unknown data at the boundary, then trust the types.              |
| `typescript/no-non-null-assertion`, `ban-ts-comment`                        | No `!` and no `@ts-ignore`.                       | They silence the type checker instead of fixing the cause.             |
| `typescript/consistent-type-definitions`                                    | `type`, not `interface`.                          | One way to declare shapes.                                             |
| `typescript/switch-exhaustiveness-check`                                    | Every union case is handled.                      | A new step kind or status can't be forgotten.                          |
| `typescript/no-floating-promises`, `no-misused-promises`                    | Every promise is awaited or handled.              | Unhandled failures disappear silently.                                 |
| `no-eval`, `no-new-func`, `typescript/no-implied-eval`                      | No code from strings.                             | Security.                                                              |
| `no-console`                                                                | No `console.*`.                                   | Logging will go through one logger.                                    |
| `react/rules-of-hooks`, `react/exhaustive-deps`, `react/no-array-index-key` | Hooks used correctly and stable list keys.        | Avoids stale state and render bugs.                                    |
| `unicorn/no-nested-ternary`, `no-param-reassign`                            | Flat conditionals, no reassigned parameters.      | Easier to read.                                                        |

Every rule in the `correctness`, `suspicious`, and `perf` groups is also an error.

### Changing the rules

- When a review comment or bug would recur, turn it into a rule instead of a note here.
- Add a probe for every new rule in `scripts/check-lint-rules.sh`, and add a row to the table above.
- A real exception gets an inline waiver with the reason: `// oxlint-disable-next-line <rule> -- <why>`. Unused waivers are errors.
- Planned: a custom rule that keeps quiz answer keys server-only, added when that code exists.
