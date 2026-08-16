# Installing StewardPOS on a VPS

From a bare Ubuntu server to a working till over HTTPS. Budget half an hour, most
of which is waiting for DNS and a Docker build.

You need:

- A VPS running **Ubuntu 22.04 or newer**, 2 GB RAM minimum (4 GB if the shop has
  a large catalog), with a public IP.
- A **domain or subdomain** you control — `pos.yourchurch.org`, say.
- SSH access as a user with `sudo`.

---

## 1. Point the domain at the server

Before anything else, because certificates depend on it and DNS is the slow part.

Create an **A record** for your hostname pointing at the server's public IP:

```
pos.yourchurch.org.   A   203.0.113.42
```

Check it has taken effect:

```bash
dig +short pos.yourchurch.org
# should print your server's IP
```

If it prints nothing, wait. Certificates cannot be issued until it resolves, and
retrying too often runs you into Let's Encrypt's rate limits.

## 2. Install Docker

```bash
sudo apt update && sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in so the group membership applies, then confirm:

```bash
docker compose version
```

## 3. Open the firewall

Only three ports. If you enable `ufw` without allowing SSH first you will lock
yourself out, so the order here matters.

```bash
sudo ufw allow 22/tcp     # SSH — this line first
sudo ufw allow 80/tcp     # HTTP, for certificate issuance and the redirect
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable
```

Nothing else needs to be open. Postgres, MinIO and the API are not published to
the host at all — they are reachable only from inside the Docker network.

## 4. Get the code

```bash
sudo mkdir -p /srv && sudo chown "$USER" /srv
cd /srv
git clone https://github.com/24Skater/stewardpos.git
cd stewardpos
```

## 5. Configure

```bash
cp .env.prod.example .env
```

Generate each secret — do not invent them by hand, and do not edit the
placeholders into something that merely looks random:

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 32   # MINIO_ROOT_PASSWORD
```

Then edit `.env` and set:

| Variable | Value |
|----------|-------|
| `DOMAIN` | `pos.yourchurch.org` — no `https://`, no trailing slash |
| `ACME_EMAIL` | A mailbox someone reads; it gets certificate-expiry warnings |
| `JWT_SECRET` | The first generated value |
| `POSTGRES_PASSWORD` | The second |
| `MINIO_ROOT_PASSWORD` | The third |

```bash
chmod 600 .env
```

**Keep a copy somewhere safe, off this machine.** Losing `JWT_SECRET` signs
everyone out; losing `POSTGRES_PASSWORD` locks you out of your own database, and
a database backup restored without it is not a restore.

## 6. Start it

```bash
docker compose -f docker-compose.prod.yml up -d
```

The first run builds both images and takes a few minutes. Watch it come up:

```bash
docker compose -f docker-compose.prod.yml ps
```

Every service should reach `running`, and `backend` should reach `healthy`.
Caddy fetches a certificate on its first request, which takes a few seconds.

## 7. Finish setup in the browser

Open `https://pos.yourchurch.org`.

The **setup wizard** runs on first visit. It creates your organisation, your
first administrator, the default roles and the store settings, and then locks
itself — it cannot be re-run to create a second admin.

Use a real email address and a real password. There is no demo account on a
production install; the seed that creates one refuses to run when
`NODE_ENV=production`, precisely because its password is published in this
repository.

Then:

- **Settings → General**: store name, tax rate, timezone.
- **Settings → Branding**: your colour, logo and receipt wording.
- **Settings → Users**: accounts for staff, with the role each one needs.

## 8. Before you trade on it

```bash
# Health
curl -fsS https://pos.yourchurch.org/api/health

# Certificate
curl -vI https://pos.yourchurch.org 2>&1 | grep -i 'issuer\|expire'
```

Then set up backups — see [backup-restore.md](./backup-restore.md). Do this on
day one. The first day you need a backup is the day you find out you never made
one.

---

## It didn't work

**The browser says the site can't be reached.**
DNS has not propagated, or the firewall is closed. `dig +short <domain>` should
print your server's IP, and `sudo ufw status` should list 80 and 443.

**The certificate is invalid, or Caddy keeps retrying.**

```bash
docker compose -f docker-compose.prod.yml logs caddy | tail -40
```

Almost always one of: the domain does not resolve to this server; port 80 is
blocked (Let's Encrypt validates over it, even though the site runs on 443); or
you have retried enough times to hit the rate limit. For the last one, uncomment
`acme_ca` in the `Caddyfile` to use the staging CA while you sort the rest out,
then comment it back.

**The backend container keeps restarting.**

```bash
docker compose -f docker-compose.prod.yml logs backend | tail -40
```

Look for:

- `Refusing to start in production with insecure secrets` — a `.env` line is
  still a placeholder. It names which one.
- `Configuration validation failed` — something is missing or malformed; the
  message names the field.
- `PostgreSQL did not become reachable` — `POSTGRES_PASSWORD` in `.env` does not
  match what the database volume was created with. If this is a fresh install,
  the quickest fix is to remove the volume and start again:
  `docker compose -f docker-compose.prod.yml down -v`. **That deletes all data** —
  only do it on an install that has none yet.
- `Migration failed` — the schema is not in the state the code expects. Do not
  work around it; see [upgrade.md](./upgrade.md).

**The page loads but every action fails.**
Open the browser console. `CORS` errors mean `DOMAIN` in `.env` does not match
the hostname you typed — `www.` counts as a different host. Fix `.env` and
`docker compose -f docker-compose.prod.yml up -d --force-recreate backend`.

**Everything works, then starts returning 429.**
Rate limiting. The defaults are sized for a busy shop, so this usually means
`TRUST_PROXY` is wrong for your setup — with it too low, every terminal appears
to be the same client. The production stack expects `1`.

---

## Next

- [operations.md](./operations.md) — logs, health, what to check when something breaks
- [backup-restore.md](./backup-restore.md) — do this first
- [upgrade.md](./upgrade.md) — taking a new version
- [api-keys.md](./api-keys.md) — machine access
- [deploy-alternatives.md](./deploy-alternatives.md) — if Compose is not for you
