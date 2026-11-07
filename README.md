# Ruang Belajar

A learning platform for any class and any subject. Teachers create invite-only classes, students learn through modules, and an AI tutor helps after a wrong answer.

Built with TanStack Start, React, and Tailwind. Data model draft: [`docs/data-model.md`](docs/data-model.md).

## Develop

```bash
pnpm install            # also turns on the pre-push lint hook
cp .env.example .env
docker compose up -d    # Postgres on 127.0.0.1:5433
pnpm db:migrate
pnpm dev                # http://localhost:3000
```

`pnpm test` runs against the `ruang_test` database in the same container, and empties it before each test. After changing `src/db/`, run `pnpm db:generate` and commit the new file in `drizzle/`.

`pnpm check`, `pnpm typecheck`, and `pnpm test` must pass before a pull request. Agent instructions are in [`AGENTS.md`](AGENTS.md).

The live app runs on the VPS in Docker. How to deploy it: [`docs/deploy.md`](docs/deploy.md).
