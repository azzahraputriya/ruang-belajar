# Production image. Run it with docker-compose.prod.yml, see docs/deploy.md.
FROM node:26-alpine AS build
WORKDIR /app
# Node 26 ships without corepack, so install the pnpm version package.json pins.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN npm install -g "$(node -p 'require("./package.json").packageManager')"
# --ignore-scripts skips `prepare`, which needs a git repo to set the push hook.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

# .output is fully bundled, so the runtime stage needs no node_modules.
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/.output ./.output
COPY drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["sh", "-c", "node .output/migrate/migrate.mjs && exec node .output/server/index.mjs"]
