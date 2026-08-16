# Backup and restore

Set this up on day one. The first day you need a backup is the day you find out
you never made one.

---

## What has to be backed up

Three things, and the database alone is not enough:

| What | Where it lives | Why it matters |
|------|----------------|----------------|
| **Database** | The `postgres_data` volume | Orders, customers, staff, settings — everything a shop cannot re-enter |
| **Uploads** | The `backend_uploads` volume | Product photos, logos, receipt images |
| **`.env`** | The repository directory | `JWT_SECRET` and `POSTGRES_PASSWORD` |

A database dump restored under a different `POSTGRES_PASSWORD` will not connect
at all — the restored database was created under the old one. Restored under a
different `JWT_SECRET`, everyone is simply signed out, which is survivable but
surprising if you were not expecting it.

`scripts/backup.sh` takes all three.

## Taking a backup

From the repository directory on the server:

```bash
./scripts/backup.sh
```

It writes a timestamped directory under `./backups/`:

```
backups/20260816-143456Z/
  database.sql.gz   pg_dump of the whole database
  uploads.tar.gz    product photos, logos, receipt images
  env.txt           the .env in force when it was taken
  MANIFEST          what was taken, from where, when, and at which commit
```

Write somewhere else with `./scripts/backup.sh /mnt/backups`.

**The directory contains credentials.** It is as sensitive as the database
inside it. The script sets `700` on it; keep it that way.

## Getting it off the machine

A backup on the server it protects is not a backup. That server is the thing
that fails.

```bash
rsync -a ./backups/ backup-host:/srv/stewardpos-backups/
```

Or any object store, or an external disk — the point is that it is somewhere the
loss of this VPS does not reach.

## Scheduling it

Nightly at 02:30, keeping 30 days:

```bash
crontab -e
```

```cron
30 2 * * * cd /srv/stewardpos && ./scripts/backup.sh >> /var/log/stewardpos-backup.log 2>&1
40 2 * * * rsync -a /srv/stewardpos/backups/ backup-host:/srv/stewardpos-backups/
0  3 * * * find /srv/stewardpos/backups -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
```

Check the log occasionally. A cron job that has been failing silently for six
weeks is the usual way this goes wrong — the backup that does not exist looks
exactly like the backup you never checked.

## Restoring

```bash
./scripts/restore.sh ./backups/20260816-143456Z
```

It will:

1. Show the manifest and make you type `RESTORE`. There is no undo.
2. Stop the backend, so nothing writes into a database that is being replaced.
3. Replace the database from the dump.
4. Replace the uploads.
5. Bring the stack back up.

Then check the secrets. If the backup's `env.txt` differs from your current
`.env`, the script says so — the backup's `POSTGRES_PASSWORD` is the one that
has to win, because the database you just restored was created under it.

Verify before trading on it:

```bash
docker compose -f docker-compose.prod.yml ps
curl -fsS https://$DOMAIN/api/health
```

Then sign in, open **Reports**, and check a day whose takings you recognise.

## Test the restore

An untested restore is a hope, not a plan. Do this once, deliberately, before
you need it.

The safe way is on a second machine, or the same one with the stack stopped:

```bash
# On a scratch host with the repository and Docker
cp /path/to/backup/env.txt .env
docker compose -f docker-compose.prod.yml up -d postgres
./scripts/restore.sh /path/to/backup
```

Then sign in and confirm a day's sales match what the original reported. What
you are checking is not that the script runs — it is that the backup you have
been taking contains what you think it does.

This procedure was verified end to end against a real stack: back up, insert a
row, restore, confirm the row is gone and the uploads are intact. It found two
bugs doing so, both now fixed, which is the argument for testing yours.

## If you lose the server entirely

1. Build a new VPS and follow [install-vps.md](./install-vps.md) up to and
   including cloning the repository.
2. Put the backup's `env.txt` in place as `.env` — **not** a freshly generated
   one.
3. `docker compose -f docker-compose.prod.yml up -d postgres`
4. `./scripts/restore.sh /path/to/backup`
5. `docker compose -f docker-compose.prod.yml up -d`
6. Point DNS at the new IP. Caddy issues a fresh certificate on the first
   request.

Skip the setup wizard — the restored database already has your organisation and
your accounts, and the wizard refuses to run against a database that has been
set up.
