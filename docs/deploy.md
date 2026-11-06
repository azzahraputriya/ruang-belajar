# Deploy

The live app runs on the VPS as two containers from `docker-compose.prod.yml`: the app and its own Postgres. It is a separate compose project (`ruang-belajar-prod`) from the dev database in `docker-compose.yml`, so the two never share data.

- The app listens on `127.0.0.1:3300` only. The outside world reaches it through the Cloudflare Tunnel at `https://lms.afiefabd.com`.
- Postgres has no port on the host. Only the app container can reach it.
- On every start, the app container applies any new migrations from `drizzle/` and then starts the server.
- Both containers restart on their own after a crash or a reboot.

## Data and backups

All accounts and class data live in the Docker volume `ruang-belajar-prod_db-data`. Rebuilds, restarts, and `docker compose down` keep it.

There are no backups. This is an accepted risk: if the disk or that volume is lost, all data is lost. Never run `docker compose down -v` or `docker volume rm` on it.

## First deploy

```bash
cp .env.production.example .env.production
```

Fill in `.env.production`. Git ignores it.

- `POSTGRES_PASSWORD` from `openssl rand -hex 24`. Put the same value inside `DATABASE_URL`.
- `BETTER_AUTH_SECRET` from `openssl rand -base64 32`.

Postgres saves the password the first time the volume is created. If you deploy from another checkout, copy this same file there. A newly generated one won't connect. Changing `BETTER_AUTH_SECRET` signs everyone out.

```bash
docker compose -f docker-compose.prod.yml up -d --build
curl -fsS http://127.0.0.1:3300/api/auth/get-session   # prints null with a 200
```

## Redeploy after a merge

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

## Logs and status

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app
```

## Make it public through the tunnel

A person does this step, once, with Afief's go-ahead. The tunnel already carries SSH to this machine at `remote-dev.afiefabd.com`. Restarting it drops that SSH session for a few seconds, so run it from a session you can lose, and reconnect afterwards.

1. In `/etc/cloudflared/config.yml`, add the new hostname above the final catch-all rule. Keep the `remote-dev.afiefabd.com` rule and the closing `http_status:404` rule as they are:

   ```yaml
   ingress:
     - hostname: remote-dev.afiefabd.com
       service: <unchanged> # the existing rule, keep it as it is
     - hostname: lms.afiefabd.com
       service: http://127.0.0.1:3300
     - service: http_status:404
   ```

2. Check the file, and check that the new hostname reaches the app:

   ```bash
   cloudflared tunnel ingress validate
   cloudflared tunnel ingress rule https://lms.afiefabd.com
   ```

3. Point the DNS name at the tunnel. `cloudflared tunnel list` shows the tunnel's name.

   ```bash
   cloudflared tunnel route dns <tunnel> lms.afiefabd.com
   ```

4. Restart the tunnel:

   ```bash
   sudo systemctl restart cloudflared
   ```

5. Confirm both hostnames work. `https://lms.afiefabd.com` shows the app, and SSH to `remote-dev.afiefabd.com` connects again.

If the tunnel runs from a dashboard token instead of `config.yml`, it ignores the file's ingress rules. Add the hostname in the Cloudflare Zero Trust dashboard under the tunnel's public hostnames instead.
