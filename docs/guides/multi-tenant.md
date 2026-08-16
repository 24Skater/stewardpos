# Single-tenant to multi-tenant

StewardPOS runs one shop per install. This describes what is already in place
for a second one, what deliberately is not, and what to do when a second one
actually arrives.

## What exists now

**An `organizations` table** (`id`, `name`, `slug`, `created_at`), seeded with a
single row:

```
id    00000000-0000-0000-0000-000000000001
name  Default Organization
slug  default
```

The id is fixed rather than generated. `authenticate` falls back to it without a
database lookup, and it lets migration 014 be idempotent across environments.

**A nullable `org_id` on 20 tenant-scoped tables**, each indexed:

```
products            product_variants   orders           order_items
customers           services           quotes           quote_items
discount_types      promo_codes        returns          return_items
audit_logs          roles              users            settings
categories          payments           store_credits    cash_drawer_sessions
```

Every existing row has `org_id IS NULL`, meaning the default org. `settings` is
included even though it stays a single row for v1 — adding the column later
would mean another migration against a live table, and an unused column costs
nothing.

**`req.orgId` on every authenticated request**, and an `orgId` claim in the JWT.
It resolves in this order:

1. the user's stored `org_id`
2. the token's `orgId` claim
3. `DEFAULT_ORG_ID`

The stored value wins over the claim for the same reason roles are reloaded on
every request rather than read from the token: a token outlives a change, and
moving a user between organizations should not wait for it to expire. The
fallback exists because tokens minted before organizations existed carry no
claim and are live in the wild until they expire.

It is **always populated** on an authenticated request. Code that eventually
reads it never has to decide what an absent tenant means.

## What does not exist, and why

**No query is scoped by `org_id`.** Nothing filters, and nothing sets the column
on insert.

This is a deliberate stopping point, not unfinished work. On a single-org
install, a correctly scoped query and a completely broken one return identical
results — there is no second tenant whose rows could wrongly appear or wrongly
vanish. Landing the filtering now would mean touching every read and write in
both adapters, with no observable behaviour to verify against and a failure mode
(one query missed, one tenant seeing another's orders) that is invisible until
the day it is catastrophic.

The column is reversible and free. The filtering is neither. So the shape lands
now, and the scoping lands per table, with tests, when there is something to
test it against.

Also absent: org-scoped login, a provisioning API, and per-org settings. Each is
listed below.

## Adding the second organization

Roughly in order. Each step is independently shippable.

**1. Backfill and tighten.** Set `org_id` to the default org on every existing
row, then make the column `NOT NULL`. Do this while there is still only one
organization — it is a no-op then, and it turns "forgot to set org_id" from a
silent cross-tenant leak into an immediate constraint violation. This is the
single highest-value step and it is worth doing before anything else.

**2. Scope reads, one table at a time.** Add `org_id = $n` to each adapter read.
Start with `products`, `orders`, and `customers` — the tables a leak would
matter most on. Every method that has no request context needs `orgId` passed
explicitly from the route or service; do not reach for a global or an
async-local store, since a background job has no request and would silently
read the wrong tenant.

**3. Scope writes.** Set `org_id` on every insert from `req.orgId`. With step 1
done, anything missed fails loudly rather than writing an orphan row.

**4. Org-scoped login.** Email is currently unique globally. Two organizations
will eventually both want `manager@`, so uniqueness has to become
`(org_id, email)`, and the login form needs to identify the organization —
by slug in the URL, a subdomain, or a field. Until then, treat email as globally
unique and say so.

**5. Provisioning.** An endpoint that creates an organization along with its
first admin, its default roles, and its settings row. Today the seeder does this
for exactly one org at startup; provisioning is that logic made callable and
parameterised by org.

**6. Per-org settings.** `settings` already has the column. Change the single-row
read to a per-org one and drop the singleton assumption in
`SINGLETON_ENTITY_ID`.

**7. Uploads.** Files land in one shared directory. Prefix keys with the org id
before a second tenant can upload, or one shop's product photos sit beside
another's — see the note on MinIO in the Phase 4 plan, which becomes relevant
at the same point for the same reason.

## Testing a change to any of this

The thing worth testing is not that one org sees its own rows. It is that it
does **not** see another's. Any test for org scoping needs at least two orgs
with overlapping data, asserting on absence as well as presence — a single-org
test passes just as happily against code that ignores `org_id` entirely.

---

## Verified against the schema

The table list above was checked against `backend/migrations/postgres/014_org_tenancy.sql`
on 2026-08-16: twenty tables, each gaining a nullable `org_id` and an index, plus
the fixed default organisation. It matches.

What has not changed is the important part — **no query filters on `org_id` yet**.
The column is the foundation, not the feature. See the ordering above before
assuming any of this is enforced.

For running the single-tenant install this describes, see
[install-vps.md](./install-vps.md).
