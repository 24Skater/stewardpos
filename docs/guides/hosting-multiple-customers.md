# Hosting several customers

Running StewardPOS for other businesses, rather than for yourself.

One stack per customer, several stacks per machine, one shared TLS terminator in
front. This guide covers why it is built that way, how to run it, and what
changes about your obligations the moment somebody else's payment credentials
live in a database you operate.

---

## Why one database per customer, and not one database with an `org_id`

Because nothing filters on `org_id` yet.

`getAllProducts`, `getAllOrders`, `getAllCustomers`, `searchProducts` and
`getAllCategories` read their whole table. Two customers sharing a database
would see each other's catalogue, sales and customer list on the first day.
`settings` is worse still: it is `SELECT * FROM settings WHERE id = 1`, a single
row holding the store name, the tax rate **and the payment credentials**.

Three more would bite immediately:

| Thing | State today |
|---|---|
| `users.email` | globally `UNIQUE` — the second customer who wants `manager@` cannot have it |
| `/uploads/:prefix/:filename` | no authentication, one shared directory |
| Login | resolves an email against every user on the install |

So one database per customer is not a stepping stone toward isolation. **For now
it is the isolation, and it is complete.** `docs/guides/multi-tenant.md` has the
sequence that would make pooling safe; it is a substantial project, and it is
only worth starting when you have enough customers that running separate stacks
actually hurts.

---

## The shape

```
                      ┌──────────────────────────┐
   :80 :443  ────────►│  stewardpos-edge (Caddy) │   one per host
                      └───────────┬──────────────┘
                                  │ routes by hostname
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
   ┌──────────────────────┐               ┌──────────────────────┐
   │ alpha.example.com    │               │ beta.example.com     │
   │  frontend + backend  │               │  frontend + backend  │
   │  postgres  (private) │               │  postgres  (private) │
   │  minio     (private) │               │  minio     (private) │
   │  own secrets, own    │               │  own secrets, own    │
   │  volumes             │               │  volumes             │
   └──────────────────────┘               └──────────────────────┘
```

Each customer gets their own database, uploads volume, logs, MinIO bucket and —
importantly — their own `JWT_SECRET`, `CREDENTIALS_KEY`, database password and
object-store credentials. `scripts/tenant.sh` generates all four per tenant with
`openssl rand`; none of them is ever shared or reused.

### What is actually isolated, measured

Verified against two live tenants rather than asserted:

| From tenant A's backend | Result |
|---|---|
| Reach B's Postgres by DNS name | ✅ refused — `ENOTFOUND` |
| Reach B's Postgres **by raw IP** | ✅ refused — timeout, no route |
| Reach its own Postgres | ✅ works |
| Reach B's **backend** on the shared edge | ⚠️ reachable |
| Authenticate to B with a token signed by A's `JWT_SECRET` | ✅ **401** |

The one honest caveat is that row: every tenant's backend and frontend share the
edge network, so they can address one another. That is what lets a single Caddy
route to all of them. It is a modest exposure rather than a hole — reaching B's
API still requires credentials B would accept, and B's signing key is not A's —
but it is real, and it is the thing to fix first if you ever host customers who
are actively hostile to each other. The fix is a network per tenant with Caddy
joined to each; it costs a compose file regenerated on every provision, which is
why it is not the default.

Databases, uploads and secrets are unreachable across tenants either way.

---

## Setup, once per machine

```bash
ACME_EMAIL=you@example.com docker compose -f docker-compose.edge.yml up -d
```

That is the shared Caddy. It binds 80 and 443, which is the reason tenants
cannot each run their own — `docker-compose.prod.yml` publishes those ports
itself and is right for a single shop on a single host.

Before the first customer, make sure the host has:

- a DNS record per customer pointing at it (Caddy cannot get a certificate for a
  name that does not resolve)
- ports 80 and 443 reachable from the internet
- disk for N databases plus N sets of uploads, and a backup destination that is
  **not** this machine

---

## Per customer

```bash
./scripts/tenant.sh new acme shop.acme.example
```

That generates the secrets, writes `tenants/acme/.env` with mode `600`, writes a
Caddy site file, starts the stack, and waits for the backend to report healthy —
which it only does after its migrations have run, because the entrypoint refuses
to serve against a schema it does not match.

Then:

1. Point the domain at the host.
2. Have the customer create their first administrator at `/setup`. There is no
   seeded account: `AUTO_SEED` is off, because what the seeder writes is an
   administrator whose password is published in this repository.
3. Take a backup: `./scripts/tenant.sh backup acme`.

### Day to day

```bash
./scripts/tenant.sh list                 # who is running, and how healthy
./scripts/tenant.sh backup --all         # every customer, one timestamp
./scripts/tenant.sh upgrade --all        # backs up first, then pulls and migrates
./scripts/tenant.sh rotate-jwt acme      # new signing key; signs everyone out
./scripts/tenant.sh exec acme sh         # a shell in that customer's backend
./scripts/tenant.sh rm acme              # final backup, then delete everything
```

`upgrade` backs up before it touches anything, because an upgrade that runs
migrations is the single most likely moment to want the previous state back.

---

## Backups

`backup` writes three things per customer, and all three are needed:

```
backups/<slug>/<timestamp>/
  database.sql.gz    pg_dump of that customer's database
  uploads.tar.gz     product photos, logos, receipt images
  env.txt            their secrets
  MANIFEST           schema version and image tag at the time
```

**`env.txt` is not optional.** A dump restored against a fresh `JWT_SECRET`
signs out every user, and against a fresh `CREDENTIALS_KEY` leaves the saved
payment credentials permanently undecryptable — the customer would have to
re-enter their Stripe or Square keys. The manifest records the schema version so
you know which release the dump belongs to.

Copy `backups/` off the machine. A backup on the host it protects is not a
backup.

---

## What changes about your obligations

This is the part that is not technical, and it is the part worth reading twice.

While customers self-host, an unencrypted Stripe key is their own key in their
own database — poor practice, their risk. Hosting inverts that. It becomes
**their** live key in **your** database, and one leaked backup is a payment
account takeover for every customer whose backup sat beside it.

Three things stop being optional:

**`CREDENTIALS_KEY` becomes mandatory.** `docker-compose.tenant.yml` declares it
with `:?`, so a tenant stack refuses to start without one. `tenant.sh` generates
a distinct key per customer. (On the single-shop stack it stays optional, and
until recently it could not be set at all — `docker-compose.prod.yml` never
passed it to the container, so enabling it was impossible. Fixed alongside this
guide.)

**`JWT_SECRET` must be per customer and must be one you generated.** A shared or
published signing key mints admin sessions for every tenant that uses it, with
no password and nothing in the audit log. `tenant.sh` generates one per tenant;
`rotate-jwt` replaces it.

**You become a data processor** for other businesses' customer records. That
carries breach-notification duties, and holding their payment API keys puts you
in PCI scope even though Stripe and Square handle the card data. Worth a
conversation with someone qualified before the first paying customer, not after.

---

## When to stop doing it this way

Silos cost one Postgres, one MinIO and one Node process per customer. That is
fine for tens of customers on a decent machine and wasteful at hundreds.

Reach for pooling when **all** of these are true:

- running the stacks is genuinely painful, not just inelegant
- the per-customer resource floor is a real cost line
- you know what customers actually need well enough to design the tenancy model
  once, correctly

Then work `docs/guides/multi-tenant.md` in order: scope reads, scope writes, drop
the `org_id` default, add row-level security. Note that pooling is **Postgres
only** — SQLite has no row-level security and cannot take the `NOT NULL`
constraint step 1 applies, so a SQLite install stays a single shop.

Until then, silos are not a compromise. They are a stronger isolation guarantee
than pooled multi-tenancy will give you even after all that work, because
nothing is shared to get wrong.
