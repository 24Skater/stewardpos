# Phase 8 — Deployment & Self‑Hosting (VPS)

**Objective.** Make StewardPOS trivially self‑hostable on a single VPS via Docker Compose, over
HTTPS, with backups, upgrades, and a complete operator runbook. A non‑expert should get from a bare
Ubuntu box to a working, secured install by following the docs alone.

**Entry criteria.** Phase 7 green (hardened, tested, backups exist).

**Exit criteria.**
- A production Compose stack (postgres + minio + backend + frontend + reverse proxy w/ TLS) starts
  with one command and a documented `.env`.
- HTTPS works with automatic certificates; secrets are strong and not defaulted.
- Backup/restore + upgrade procedures are documented and tested.
- `docs/guides/` fully covers install → configure → operate → back up → upgrade → troubleshoot.
- The single‑→multi‑tenant upgrade path is documented (D4).

---

### `P8-T1` — Production Compose + reverse proxy with TLS
**Context.** `docker-compose.yml` targets local dev (localhost origins, ports exposed, MinIO with a
`CHANGE_THIS` password). Production needs a hardened variant behind a TLS reverse proxy.
**Files.** `docker-compose.prod.yml`, a reverse proxy service (**Caddy** recommended for automatic
Let's Encrypt, or nginx + companion), `Caddyfile`/proxy config, `.env.prod.example`.
**Steps.**
1. Add a `caddy` (or `nginx-proxy` + `acme`) service terminating TLS on 80/443, proxying `/` to the
   frontend and `/api` to the backend. Only the proxy publishes ports; postgres/minio/backend are
   internal to the Compose network (no host port exposure in prod).
2. Parameterize the public domain (`DOMAIN`) and admin email (for ACME). `CORS_ORIGIN` and
   `VITE_API_BASE_URL` derive from `DOMAIN` (single origin: `https://<domain>`; API under `/api`).
3. Force strong secrets: boot fails if `JWT_SECRET`, DB password, or MinIO password are defaults.
4. Set `restart: unless-stopped`, healthchecks, and sane resource limits.
**Acceptance criteria.** `docker compose -f docker-compose.prod.yml up -d` serves the app over HTTPS
on the configured domain with valid certs and no default secrets.
**Verification.** On a test VPS/domain: stack comes up; `https://<domain>` loads; `https://<domain>/api/health`
returns success; SSL Labs / `curl -vI` shows a valid cert.

### `P8-T2` — Migrations & seeding on deploy
**Files.** `backend/Dockerfile`/entrypoint, `backend/src/services/migrator.ts`, compose.
**Steps.** On backend start: run pending migrations (idempotent, forward‑only), then seed only when
`AUTO_SEED=true` and the DB is empty. Never auto‑create a default admin in prod — the operator uses
the setup wizard (P2‑T4) on first load. Log applied migrations.
**Acceptance criteria.** First boot migrates + (optionally) seeds; subsequent boots are no‑ops.
**Verification.** Fresh volume → first `up` applies `001..NNN`; second `up` applies none; setup wizard
runs on first browser visit.

### `P8-T3` — VPS install guide (the golden path)
**Files.** `docs/guides/install-vps.md`.
**Steps.** A step‑by‑step for Ubuntu 22.04+: install Docker + Compose plugin; point a DNS A record at
the VPS; `git clone`; `cp .env.prod.example .env` and fill (`DOMAIN`, secrets via
`openssl rand -base64 32`); `docker compose -f docker-compose.prod.yml up -d`; open the domain; run the
setup wizard. Include firewall (ufw: 22/80/443), and a "it didn't work" checklist.
**Acceptance criteria.** Following the guide on a clean VPS yields a working HTTPS install in <30 min.
**Verification.** A second person (or a fresh VPS) follows the guide start‑to‑finish successfully.

### `P8-T4` — Operate: backups, restore, upgrades  `[parallel-ok]`
**Files.** `docs/guides/backup-restore.md`, `docs/guides/upgrade.md`, `scripts/backup.sh`,
`scripts/restore.sh`.
**Steps.** Document + script scheduled `pg_dump` + MinIO backup (cron example), off‑box copy, and a
tested restore. Upgrade procedure: `git pull` → `docker compose pull/build` → `up -d` (migrations run
automatically) → verify health; include a rollback note (restore last backup, redeploy prior tag).
**Acceptance criteria.** Operators can back up, restore, and upgrade with confidence.
**Verification.** Run backup → simulate loss (fresh volume) → restore → data intact; upgrade across a
version bump applies new migrations without data loss.

### `P8-T5` — Observability & logs  `[parallel-ok]`
**Files.** `docs/guides/operations.md`, logging config.
**Steps.** Document how to read logs (`docker compose logs`, Winston file in the backend volume),
health endpoints, and basic monitoring (uptime check on `/api/health`). Ensure logs don't contain
secrets/PII beyond what's necessary; rotate log files.
**Acceptance criteria.** An operator can diagnose a down service from the docs.
**Verification.** Kill a service → the troubleshooting doc leads to detection + recovery.

### `P8-T6` — Non‑Docker & platform notes  `[parallel-ok]`
**Files.** `docs/guides/deploy-alternatives.md`.
**Steps.** Briefly document alternatives the README implied (bare Linux w/ systemd + external
Postgres; managed Postgres + S3 instead of MinIO; single‑VM cloud). Keep Docker Compose as the
**recommended and supported** path; mark others as community/advanced.
**Acceptance criteria.** Alternatives are documented without diluting the supported path.
**Verification.** Doc review; commands are internally consistent with the env reference.

### `P8-T7` — Multi‑tenant upgrade path (D4)  `[parallel-ok]`
**Files.** `docs/guides/multi-tenant.md`.
**Steps.** Explain the current single‑tenant default and exactly what enabling multi‑tenant would
require given the nullable `org_id` foundation (P2‑T6): org‑scoped login/subdomains, a provisioning
API, per‑org settings/branding, billing, and data‑isolation tests. Mark as a future major version.
**Acceptance criteria.** A clear, honest upgrade path exists; no false promise that v1 is multi‑tenant.
**Verification.** Doc review against the actual schema (org_id present on the listed tables).

---

## Rate limiting was unusable in production (found 2026-08-07)

Two defects, both operational rather than theoretical.

**The global limit would have stopped a shop trading.** 100 requests per
15 minutes per IP. Measured against the running app, opening the register costs
~24 API calls and each sale adds ~3 — and every terminal in a store shares one
public IP. That is roughly **25 sales per quarter-hour for the whole shop**
before 429s begin, and the prod compose file set exactly that value, labelled
"Stricter limits". Raised to 3000 across every environment, with the arithmetic
recorded next to it.

**Nothing was actually per-IP.** `nginx.conf` proxies `/api/` to the backend and
sets `X-Forwarded-For`, but Express never had `trust proxy` configured, so
`express-rate-limit` keyed every request by the nginx container's address. The
entire internet shared one bucket: one abusive client could lock out every
store, and the new sign-in limiter would have been globally shared too.

`TRUST_PROXY` now controls this, defaulting to `0`. The default is deliberately
the cautious one — trusting the header when nothing sets it lets any client
spoof its address and escape the limits altogether — and each compose file that
ships an nginx sets it to `1`.

**Brute force had no specific protection.** Sign-in shared the global bucket,
which is sized for a busy shop and therefore useless against password guessing.
There is now a separate 10-per-window budget in front of `/api/auth/login` with
`skipSuccessfulRequests`, so only failures count and a shift change costs
nothing. Verified live: ten wrong passwords, then 429.

## `POST /api/admin/reset-database` was a live-install destroyer

Reachable from a button labelled "Reset Data" in the admin inventory screen, next
to Export and Import, with the warning "This will delete all current data and
load fresh inventory. Continue?".

What it actually did:

- `TRUNCATE orders`, `TRUNCATE order_items` — the sales ledger, which a shop is
  generally obliged to retain
- `DELETE FROM users WHERE email != 'admin@demo.local'` — every real staff
  account, keeping only the demo one (and if that account does not exist,
  which it will not on a properly-set-up install, *all* of them)
- reseed, recreating `admin@demo.local` with the password published in this
  repository

So one click on a production install would destroy the trading history and leave
a single account with known credentials.

It now refuses when `NODE_ENV === 'production'`, and outside production requires
`{ "confirm": "RESET" }` in the body so a misclick cannot trigger it. The button
is relabelled "Reset Demo Data", styled as destructive, and its confirmation
says what is actually deleted.

The environment gate lives in the route rather than the caller, because the
route is what has to be safe — a second UI, a script, or curl would otherwise
bypass a client-side check.

---

## Completion notes (2026-08-16)

All seven tasks are done. Read this rather than the task list above for the
current state.

Phase 8 is mostly documentation and infrastructure, and the interesting part was
that four of the things the plan asked to *document* turned out not to be true
yet. Those are the code changes below.

### P8-T1: there was no production stack, and the one labelled "production" was a hazard

`environments/prod/docker-compose.prod.yml` was an **overlay** on the development
stack, used as `-f docker-compose.yml -f docker-compose.prod.yml`. An overlay
inherits everything it does not override, and the base stack publishes Postgres,
MinIO and the API on host ports because that is what a developer wants. The
overlay overrode some of those and not others, so an operator following
`environments/prod/README.md` put a **database on the public internet listening
on 5432**. There was no TLS anywhere in it.

`scripts/deploy-prod.sh` compounded this by pointing at
`-f docker-compose.yml -f docker-compose.prod.yml` from the repository root,
where no such file existed — so the documented production deploy could not run
at all.

There is now a **standalone** `docker-compose.prod.yml` in the root, deliberately
not an overlay: a separate file cannot inherit a mistake. Caddy terminates TLS
with automatic Let's Encrypt certificates and is the only service that publishes
ports; Postgres, MinIO, the API and the frontend are reachable only on the
internal network. `Caddyfile` validates clean against `caddy validate`, and
routes `/api` and `/uploads` straight to the backend rather than through the
frontend's nginx — that keeps exactly one proxy in front of Express, which is
what `TRUST_PROXY: 1` has to mean. The old overlay and its deploy scripts are
gone, with `environments/prod/README.md` left as a pointer explaining why.

**Placeholder secrets now refuse to boot.** The existing check was
`z.string().min(32)` on `JWT_SECRET`, which catches an unset one and waves
`CHANGE_THIS_MIN_32_CHARACTERS_SECRET` straight through — it is thirty-six
characters long and it is the default in every compose file here. An install
that skipped a step would sign its sessions with a key published on the
internet, for the life of the install, with nothing saying so.
`config/secrets.ts` rejects the shipped placeholders for `JWT_SECRET`,
`DB_PASSWORD` and `MINIO_SECRET_KEY` in production, reports every problem at
once so one edit fixes them all, and matches exactly rather than by pattern so a
real passphrase containing the word "change" is not refused.

### P8-T2: a failed migration used to start the server anyway

The entrypoint printed `Migration failed, but continuing...` and served. The
server then ran against a schema its code did not match, which surfaces as
scattered 500s on whichever endpoint touches the missing column — far from the
migration that failed, and after the shop has started trading on it. It is now
fatal, and the database wait is bounded so a permanently wrong `DB_HOST` fails
the container instead of sitting in "Starting" forever.

**The seeder had no guards at all.** It writes an administrator called
`admin@demo.local` whose password is printed in this repository, and it ran
whenever it was invoked. `AUTO_SEED` lives in a `.env` file one line from the
settings an operator is already editing, so "a shop turns it on by mistake" is
not hypothetical — the result would be a live install carrying a working account
with published credentials. That is the same defect as the "Reset Data" button
this phase documents, arriving by a different route.

It now refuses in production outright, and skips a database that already has
users. `force` bypasses the emptiness check only — for the demo profile, "Reset
Demo Data" and the test fixtures — and never the production refusal, because
there is no caller for which planting a publicly-known administrator on a live
install is the right outcome. The existing "seeding twice" integration test was
updated to force, or the new guard would have turned it into a tautology.

### P8-T4: the backup scripts were tested, and testing them found two bugs

`scripts/backup.sh` takes the database, the uploads **and** the `.env`. The third
is not padding: a dump restored under a different `POSTGRES_PASSWORD` does not
connect at all, since the restored database was created under the old one.

The plan's verification is "run backup → simulate loss → restore → data intact",
and running it is what earned this section:

1. **`-C /app` was silently rewritten.** Git Bash on Windows converts
   Unix-looking absolute paths, so `tar -C /app` reached the container as
   `C:/Program Files/Git/app` and failed. The script caught the failure and
   reported "no uploads directory yet" — which is how a backup comes to be
   missing a shop's product photos while saying it succeeded. Both scripts now
   pass the command through `sh -c` so the container's own shell resolves it,
   and an empty archive is a hard failure rather than a shrug.
2. **`rm -rf /app/uploads` cannot work.** It is a Docker volume mount; the
   restore failed with "Permission denied" regardless of the container user,
   because a mount point cannot be unlinked from inside. It clears the contents
   now.

Verified end to end afterwards against a real stack: backup taken, a marker row
inserted, restore run, marker gone, uploads intact including real product
images. Both `docs/guides/backup-restore.md` and `upgrade.md` are written from
that run rather than from intention.

### P8-T5: the log file had no bound

The Winston file transport was configured with a filename and nothing else, so
`/app/logs/app.log` sat on a Docker volume and grew for the life of the install.
A shop writing a line per request fills a disk eventually — months after
anything changed, which makes it a miserable outage to diagnose and a cheap one
to prevent. It now rotates at `LOG_MAX_SIZE_MB` (20) keeping `LOG_MAX_FILES` (5),
capped at 100 MB, with `tailable` set so `app.log` stays the newest file rather
than becoming the oldest.

Logs were checked for what they carry: method, path, status, duration, client IP,
user agent, and errors with stack traces. No request bodies, passwords, tokens
or API keys. A customer email appears only where a receipt was sent to it.

### The environment reference was documenting a fixed defect

`docs/reference/environment.md` still listed the production rate limit as
**100 per 15 minutes** — the value Phase 8 already records as unusable, having
worked out that it allows roughly 25 sales per quarter-hour for an entire shop.
Anyone configuring from the reference would have reintroduced it. Corrected,
along with `TRUST_PROXY` guidance and the new logging settings.

### Documentation

`docs/guides/` now covers install → operate → back up → upgrade → troubleshoot,
with an index at `docs/guides/README.md`:

| Guide | Task |
|-------|------|
| `install-vps.md` | P8-T3 — Ubuntu golden path, DNS, firewall, secrets, wizard, and an "it didn't work" section keyed to the actual startup failures |
| `backup-restore.md` | P8-T4 |
| `upgrade.md` | P8-T4 |
| `operations.md` | P8-T5 |
| `deploy-alternatives.md` | P8-T6 — managed Postgres, S3, bare systemd, PaaS, Kubernetes, each with what you take on |
| `multi-tenant.md` | P8-T7 — verified against `014_org_tenancy.sql`: twenty tables, each with a nullable `org_id` and an index. Matches |

### Verification

```
backend   typecheck OK   lint 0 errors (176 `any` warnings, the known backlog)
          748 passed | 32 skipped      build OK
          271 integration passed against a real Postgres
frontend  typecheck OK   lint 0 errors
          255 passed                   build OK

caddy validate --config Caddyfile   Valid configuration
docker compose -f docker-compose.prod.yml config   valid
backup → insert marker → restore → marker gone, uploads intact
```

### Still open after this phase

- **No install has been done on a real VPS.** P8-T3's verification is "a second
  person follows the guide on a clean VPS start to finish", and that needs a
  server and a domain. Everything short of it is verified: the compose file and
  Caddyfile both validate, the secret refusal and migration failure paths are
  covered by tests, and backup/restore ran for real. The first genuine install
  will find something in the guide, and the guide should be corrected then.
- **`scripts/deploy-prod.ps1` was removed rather than rewritten.** It drove the
  old overlay, so it had to change; a second implementation of a production
  deploy in a language nobody runs on the target platform is the drift this
  project keeps finding. Production here is Linux. `deploy-dev.ps1` and
  `deploy-qa.ps1` are untouched.
- **`environments/qa/` is still an overlay** on the development stack and so
  still publishes ports. That is acceptable for QA and was left alone, but an
  internet-facing QA box would want the production file with a different domain.
- **MinIO is still unwired** — uploads use the volume-backed disk path, which is
  correct until there is more than one backend replica. The prod stack runs the
  container so the option is there, and `deploy-alternatives.md` covers S3.
