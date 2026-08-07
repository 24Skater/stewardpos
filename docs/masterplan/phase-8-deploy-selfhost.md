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
