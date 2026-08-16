# Operating StewardPOS

Day-to-day running: where the logs are, what to check, and what to do when the
shop says "it's not working".

All commands are run from the repository directory on the server. `dcp` below is
shorthand for `docker compose -f docker-compose.prod.yml`; you may find it worth
aliasing.

---

## Is it up?

```bash
docker compose -f docker-compose.prod.yml ps
```

Five services: `caddy`, `postgres`, `minio`, `backend`, `frontend`. The backend
reports `healthy` once its own health check passes; the others report `running`.

```bash
curl -fsS https://$DOMAIN/api/health
```

```json
{"status":"healthy","timestamp":"...","uptime":1024.5,"memory":{"used":34,"total":35}}
```

That endpoint needs no authentication, which makes it the right target for an
uptime monitor. Point one at it — UptimeRobot, Healthchecks.io, a cron on
another box, anything. **You want to hear about an outage from a monitor, not
from a cashier with a queue.**

`uptime` climbing from near zero means the backend restarted recently. Worth
knowing why.

## Logs

Everything logs to stdout, so Docker collects it:

```bash
# Follow everything
docker compose -f docker-compose.prod.yml logs -f

# One service, recent
docker compose -f docker-compose.prod.yml logs --tail 100 backend

# Since a time
docker compose -f docker-compose.prod.yml logs --since 30m backend
```

The backend also writes JSON lines to `/app/logs/app.log` on the `backend_logs`
volume:

```bash
docker compose -f docker-compose.prod.yml exec backend tail -f /app/logs/app.log
```

**Rotation is bounded**: the file rolls at `LOG_MAX_SIZE_MB` (20 MB) and keeps
`LOG_MAX_FILES` (5), so at most 100 MB. Before those settings existed the file
grew for the life of the install and eventually filled the volume — an outage
that arrives months after anything changed and is miserable to diagnose. If your
disk is small, lower them.

Set `LOG_LEVEL=debug` temporarily to trace something, and put it back. Debug is
noisy enough to rotate away the context you actually wanted.

### What is and isn't in the logs

Logged: method, path, status, duration, client IP, user agent. Errors with
stack traces.

Not logged: request bodies, passwords, tokens, API keys, card details. A
customer email appears only where a receipt was emailed to it. If you are
shipping logs off-box, treat the client IP as personal data and keep them no
longer than you need.

## Common situations

**A cashier says the till is stuck.**
Check `/api/health` first — that separates "the server is down" from "this
browser is confused". If health is fine, reload the page; if it is not, read on.

**Everything returns 429.**
Rate limiting. Check `TRUST_PROXY` is `1`: with it wrong, every terminal in the
shop looks like one client and they share a bucket sized for one. Confirm with
`docker compose -f docker-compose.prod.yml exec backend printenv TRUST_PROXY`.

**Sign-in returns 429 but everything else works.**
The brute-force limiter, which counts failed sign-ins only. Someone is typing a
password wrong repeatedly — or someone is guessing. It clears at the end of the
window (15 minutes by default). Check the audit log and the sign-in failures in
the backend log before assuming it is the former.

**The backend keeps restarting.**

```bash
docker compose -f docker-compose.prod.yml logs backend | tail -40
```

The startup failures are all self-describing: insecure secrets, a configuration
field that will not validate, an unreachable database, or a failed migration.
See [install-vps.md](./install-vps.md#it-didnt-work) and
[upgrade.md](./upgrade.md).

**Certificates.**
Caddy renews automatically about 30 days before expiry. If something is wrong
you will hear about it at `ACME_EMAIL` first.

```bash
docker compose -f docker-compose.prod.yml logs caddy | grep -i 'certificate\|error'
```

The usual cause of a failed renewal is port 80 having been closed since install —
Let's Encrypt validates over it even though the site runs on 443.

**Disk filling up.**

```bash
df -h
docker system df
```

Usually old images from repeated upgrades. `docker image prune -a` reclaims
them; it will not touch volumes, so your data is not at risk. Check
`backups/` too — if the retention cron is missing, that grows forever.

**Restarting a single service.**

```bash
docker compose -f docker-compose.prod.yml restart backend
```

Safe at any time; in-flight requests fail and the client retries. Restarting
`postgres` is not something to do casually during trading.

## A weekly habit

Five minutes:

- `docker compose -f docker-compose.prod.yml ps` — everything running
- `ls -lt backups/ | head` — last night's backup exists and is a sane size
- `df -h` — disk under 80%
- **Admin → Audit Log** — any changes you do not recognise
- `docker compose -f docker-compose.prod.yml logs --since 168h backend | grep -c '"level":"error"'` — error count, and whether it is climbing

## Getting help

Include: the output of `ps`, the last 40 backend log lines, your StewardPOS
version (`git rev-parse --short HEAD`), and what you were doing. Redact `.env`
values before pasting anything.
