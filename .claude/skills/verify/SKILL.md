---
name: verify
description: Run Ruang Belajar locally and check a change in a real browser with screenshots. Use after any change a user could see, before opening a PR, or when asked to run, start, or screenshot the app.
---

# Verify a change in the running app

Tests prove the logic. This proves a person sees the right thing. Do both.

## 1. Start the app

This machine is shared. Never use port 3000 or a port another project holds.

First start Postgres and apply migrations: `docker compose up -d --wait`, then `pnpm db:migrate`. Copy `.env.example` to `.env` if it is missing.

```sh
PORT=$(node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')
pnpm dev --port "$PORT"   # run in the background
```

Wait until `curl -fsS -o /dev/null "http://localhost:$PORT/"` succeeds. If the change touches server code, routes, or `vite.config.ts`, also check the production build: `pnpm build`, then `PORT=$PORT node --env-file=.env .output/server/index.mjs`.

## 2. Drive it with the Playwright MCP

Load the tools with ToolSearch (`select:mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_take_screenshot,mcp__playwright__browser_console_messages`), then:

1. Navigate to `http://localhost:$PORT/<page>`.
2. Act as the user would. Click, type, and submit with the MCP tools. Never call app internals.
3. After each step that matters, take a screenshot into `.playwright-mcp/<branch>/<step>.png`. The MCP can only write inside the repo, and git ignores that folder. Use a 1280x800 viewport, and a 390x844 one for any screen students use on a phone.
4. Read `browser_console_messages`. Any error fails the check.

Write each check as a pass rule before you run it, such as "after sign-up, the page shows the display name". A step passes only when its screenshot shows that.

## 3. Report and clean up

- List each check with pass or fail and its screenshot path. Give the person the paths. Never link images from a branch.
- Stop the dev server and close the browser.
