# ZettleVault

The index to a box of handwritten cards. See [SPEC.md](SPEC.md) for what and why.

TypeScript end to end · Postgres with row level security · one Docker Compose stack.
Needs Node 24+ (runs the server's `.ts` files directly — no build step) and Docker.

## Develop

```bash
cp .env.example .env        # set the two passwords (hex), and the same two inside the URLs
npm install
npm run db                  # postgres on 127.0.0.1:5433
npm test                    # migrates, then runs the tests against that real database
npm run invite -- you@gmail.com
npm run dev:server          # :3000
npm run dev:web             # :5173 — open this one; it proxies /api and /auth
```

Sign-in needs a Google OAuth client: Google Cloud console → APIs & Services → Credentials →
Create OAuth client ID → Web application. Authorized redirect URIs:
`http://localhost:5173/auth/callback` and `https://<your domain>/auth/callback`.
Put the ID and secret in `.env`.

Schema changes: add `migrations/NNN_name.sql`. Every table with a `user_id` must enable RLS
with the `own_rows` policy (copy the loop at the bottom of `001_init.sql`); a test fails if one doesn't.

## Deploy (Oracle Cloud Always Free, ARM)

1. Create an Ampere A1 instance (Ubuntu). Open **80 and 443 in both places**: the subnet's
   security list *and* the host firewall — Oracle's Ubuntu images block them in iptables by default.
2. Point a DNS name at the instance's public IP.
3. On the VM: install Docker and rclone, clone this repo, create `.env` with
   `PUBLIC_URL=https://<domain>`, `DOMAIN=<domain>`, real passwords, the Google credentials,
   and `RCLONE_REMOTE` (e.g. `b2:zettlevault-backups`, after `rclone config`).
4. `scripts/deploy.sh` (first run too: it creates `data/photos` with the right owner) — Caddy gets the certificate on first request.
5. Invite yourself: `docker compose run --rm migrate node server/src/invite.ts you@gmail.com`
   Load the reference data once (Strong's + Webster 1828, ~25 MB download, pinned to inspected commits):
   `docker compose run --rm migrate node server/src/load-reference.ts` — locally: `npm run load-reference`.
   Keyword pages work without it; they just show no original words or dictionary entry.
6. Cron (`crontab -e`): `0 3 * * * /home/ubuntu/ZettleVault/scripts/backup.sh >> /home/ubuntu/backup.log 2>&1`
   Set `HEALTHCHECK_URL` to a healthchecks.io check so a *missing* backup alerts you.
   An external uptime check on `https://<domain>/healthz` doubles as keep-alive against idle reclamation.

Later deploys: `scripts/deploy.sh` on the VM.

## Restore / move to another machine

`scripts/restore.sh 2026-09-21` on any machine with Docker, rclone config, this repo and `.env`.
This is the exit from any provider — rehearse it before trusting it.
