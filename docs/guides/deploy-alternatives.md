# Other ways to deploy

**Docker Compose on a single VPS is the supported path.** It is what
[install-vps.md](./install-vps.md) describes, what the maintainers run, and what
CI builds. Everything below is possible, and none of it is tested on every
release.

If you are choosing rather than migrating, choose Compose.

---

## Managed Postgres instead of the bundled one

The least exotic variation, and a reasonable one: someone else handles backups,
patching and failover for the part that matters most.

Remove the `postgres` service from `docker-compose.prod.yml` and point the
backend at your instance:

```yaml
backend:
  environment:
    DB_HOST: your-instance.eu-west-1.rds.amazonaws.com
    DB_PORT: 5432
    DB_NAME: stewardpos
    DB_USER: stewardpos
    DB_PASSWORD: ${POSTGRES_PASSWORD}
  # and drop the depends_on: postgres
```

Requires Postgres 16 or newer, and TLS to the database if it leaves the host.

**Backups change.** `scripts/backup.sh` runs `pg_dump` inside the local
container and will not work. Use your provider's snapshots for the database —
and keep running the script for uploads and `.env`, or replace it with your own.
A provider snapshot alone is not a full backup of this application.

## S3 instead of MinIO

MinIO exists so the stack is self-contained. Any S3-compatible store works:

```yaml
backend:
  environment:
    STORAGE_ADAPTER: s3
    S3_ENDPOINT: https://s3.eu-west-1.amazonaws.com
    S3_REGION: eu-west-1
    S3_BUCKET: your-bucket
    S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
    S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
```

Then drop the `minio` service.

Note that uploads currently default to a **volume-backed disk path** rather than
object storage, and that is deliberate — it is correct until there is more than
one backend replica. If you are running one container, S3 buys you little beyond
someone else's durability.

## Bare Linux with systemd

No Docker. More moving parts to keep in step, and you own every one.

You need: Node 20+, Postgres 16+, and a reverse proxy with TLS (nginx + certbot,
or Caddy).

```bash
# Backend
cd /srv/stewardpos/backend
npm ci --omit=dev
npm run build
npm run migrate          # migrations do not run themselves without the entrypoint

# Frontend
cd /srv/stewardpos
npm ci && npm run build  # serve dist/ from nginx
```

```ini
# /etc/systemd/system/stewardpos.service
[Unit]
Description=StewardPOS API
After=network.target postgresql.service

[Service]
Type=simple
User=stewardpos
WorkingDirectory=/srv/stewardpos/backend
EnvironmentFile=/srv/stewardpos/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**What you take on:**

- Migrations. The Docker entrypoint runs them on every start and refuses to
  serve if they fail; systemd does neither. `npm run migrate` before every
  restart after an upgrade, and check the exit code.
- Backups. `scripts/backup.sh` assumes containers. Write your own around
  `pg_dump` plus the uploads directory plus `.env`.
- The reverse proxy, and therefore `TRUST_PROXY` — it must equal the number of
  proxies in front of the API, or rate limiting is either useless or bypassable.
- Node version drift on the host.

## A single cloud VM

Identical to the VPS path — that is all a VPS is. Use the provider's firewall
instead of `ufw`, and their volume snapshots as a second line of defence behind
`scripts/backup.sh`, not instead of it.

## Kubernetes

Not supported, and not recommended for a single shop.

The application would run — it is a stateless API, a static frontend, Postgres
and object storage — but nothing here is built for it: no Helm chart, no
manifests, no readiness semantics beyond the Docker health check, and the
uploads volume assumes a single writer. If you already run a cluster and want
this on it, you are ahead of the documentation and on your own.

## Platform-as-a-service (Render, Railway, Fly, and similar)

Workable for a demo, awkward for a till.

The backend is an ordinary Node service and deploys fine. The difficulties are
the ones a POS cares about: uploads need real persistent storage or S3, not an
ephemeral filesystem; a cold start in the middle of a queue is unacceptable, so
you cannot use a scale-to-zero tier; and `TRUST_PROXY` depends on how many
proxies the platform puts in front of you, which is often undocumented.

If you try it, set `TRUST_PROXY` deliberately and verify rate limiting behaves
by hitting the API from two different addresses.
