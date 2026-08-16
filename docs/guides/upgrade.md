# Upgrading

Taking a new version of StewardPOS. Migrations run automatically when the
backend starts, so an upgrade is three commands — but take a backup first, every
time, because a migration is the one step that cannot be undone by restarting.

---

## The procedure

```bash
cd /srv/stewardpos

# 1. Back up. Every time. This is the step people skip.
./scripts/backup.sh

# 2. Take the new code
git pull

# 3. Rebuild and restart
docker compose -f docker-compose.prod.yml up -d --build
```

The backend's entrypoint applies any pending migrations before the server
starts. Watch it:

```bash
docker compose -f docker-compose.prod.yml logs -f backend
```

You are looking for `Running database migrations`, then either
`No new migrations to apply` or a line per migration applied, and then
`Starting server`.

## Verifying

```bash
docker compose -f docker-compose.prod.yml ps        # all running, backend healthy
curl -fsS https://$DOMAIN/api/health
```

Then, in the browser: sign in, ring up a test sale, and open **Reports** for
today. That exercises the register, the money path and the reporting queries —
the three things a schema change is most likely to disturb.

## When a migration fails

The backend **refuses to start**. That is deliberate: it used to log
"Migration failed, but continuing..." and serve anyway, which meant running
against a schema the code did not match. The symptom was scattered 500s on
whichever endpoint touched the missing column, far from the migration that
actually failed, and after the shop had started trading on it.

So a failed migration looks like a container that will not come up:

```bash
docker compose -f docker-compose.prod.yml logs backend | tail -40
```

**Do not work around it** by editing `schema_migrations` or forcing the server
up. Either:

- Fix the cause if the message identifies it (most often a manual schema change
  made outside a migration), or
- Roll back — below — and open an issue with the log.

Migrations are forward-only. There is no "down" step, by design: a half-applied
rollback on a live sales ledger is worse than the problem it was solving.

## Rolling back

You need the backup from step 1. This is why it is step 1.

```bash
# Return the code to the version that was working
git log --oneline -10          # find the commit you were on
git checkout <that-commit>

# Restore the data as it was before the upgrade
./scripts/restore.sh ./backups/<the-one-you-just-took>

docker compose -f docker-compose.prod.yml up -d --build
```

Restore the data as well as the code even if the migration appeared to fail
early. "Appeared to" is doing a lot of work in that sentence, and a partly
migrated database against older code is a worse position than a clean restore.

## Version pinning

The production stack builds from the checkout, so `git pull` is what moves you
between versions. To hold a specific one:

```bash
git checkout v1.0.0
docker compose -f docker-compose.prod.yml up -d --build
```

Read `CHANGELOG.md` before a major version. Anything that needs an operator
decision — a setting that changes meaning, a manual step — is called out there.

## Zero downtime

There isn't any, and the honest answer is that a single-VPS Compose install
cannot offer it: the backend restarts, and migrations hold a lock while they
run. Expect tens of seconds.

Upgrade when the shop is shut. If that is genuinely impossible, the smallest
window is `docker compose -f docker-compose.prod.yml build` first — which
changes nothing running — and then `up -d` once the images are ready.
