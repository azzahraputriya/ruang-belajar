# Lint rules

Why each project lint rule exists. `.oxlintrc.json` is the source of truth. Every rule in the `correctness`, `suspicious`, and `perf` groups is also an error.

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

## Changing the rules

- When a review comment or bug would recur, turn it into a rule instead of a note in `AGENTS.md`.
- Add a probe for every new rule in `scripts/check-lint-rules.sh`, and a row to the table above.
- A real exception gets an inline waiver with the reason: `// oxlint-disable-next-line <rule> -- <why>`. Unused waivers are errors.
- Planned: a custom rule that keeps quiz answer keys server-only, added when that code exists.
