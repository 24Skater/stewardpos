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

**1. Backfill and tighten.** ✅ **Done — migration 026 (Postgres only).**

Set `org_id` to the default org on every existing row, give the column that
value as its `DEFAULT`, and only then make it `NOT NULL`. All three parts, in
that order.

> **The order is not a style preference.** An earlier version of this guide said
> to backfill and then set `NOT NULL`, describing it as "a no-op" on a
> single-org install. It is not a no-op — it is an outage. **Not one of the
> forty-four `INSERT` statements in the two adapters names `org_id`**, so the
> constraint rejects every write the application makes:
>
> ```
> ERROR:  null value in column "org_id" of relation "customers"
>         violates not-null constraint
> ```
>
> The `DEFAULT` is what makes the constraint survivable: existing writes keep
> working and land in the default org, while an explicit `org_id` still wins.

What migration 026 does, per table:

```sql
UPDATE       products SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
ALTER TABLE  products ALTER COLUMN org_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE  products ALTER COLUMN org_id SET NOT NULL;
```

**It changes no behaviour.** On a single-org install the `DEFAULT` satisfies the
constraint on every write, so the application is bit-for-bit identical before
and after — which is exactly what made it safe to land ahead of the scoping
work rather than as part of it. Verified by running the full adapter
integration suite (379 tests) against the constrained schema.

Fully reversible while the `DEFAULT` is in place:

```sql
ALTER TABLE <t> ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE <t> ALTER COLUMN org_id DROP DEFAULT;
```

Two tests keep this honest: `orgIdWriteCoverage.test.ts` fails if a migration
makes `org_id` `NOT NULL` on a table whose inserts neither set it nor have a
default, and `orgIdRequired.integration.test.ts` asserts the constraint, the
default, and the blind write against a real database.

### SQLite does not get this, and will not

SQLite has no `ALTER TABLE ... ALTER COLUMN`, so neither the constraint nor the
default can be added to an existing column:

```
sqlite> ALTER TABLE customers ALTER COLUMN org_id SET NOT NULL;
Error: near "ALTER": syntax error
```

The alternatives were a twenty-table rebuild (create, copy, drop, rename, twice
per table, against a shop's only copy of its data) or twenty `AFTER INSERT`
triggers. The trigger version was written and tested — it works — and rejected:
it emulates the `DEFAULT` but not the `NOT NULL`, it costs an extra `UPDATE` per
`INSERT` on the checkout path, and twenty invisible triggers are a worse thing
to inherit than a documented difference.

**So multi-tenancy is a Postgres feature.** That is not a workaround; it is the
honest end state, because the destination of this whole sequence is row-level
security and SQLite has none. A SQLite install is a single shop, which is the
supported way to run one.

The adapters do not diverge in behaviour, only in what they store: every
org-scoped query reads through `COALESCE(org_id, <default org>)` and
`authenticate` falls back to the same value, so a `NULL` on SQLite and the
default org id on Postgres mean the same thing to every consumer.

**2. Scope reads, one table at a time.** Add `org_id = $n` to each adapter read.
Start with `products`, `orders`, and `customers` — the tables a leak would
matter most on. Every method that has no request context needs `orgId` passed
explicitly from the route or service; do not reach for a global or an
async-local store, since a background job has no request and would silently
read the wrong tenant.

**3. Scope writes.** Set `org_id` on every insert from `req.orgId` — forty-four
statements across the two adapters, none of which names the column today.

**Then drop the `DEFAULT`**, and only then:

```sql
ALTER TABLE <t> ALTER COLUMN org_id DROP DEFAULT;
```

Until it is gone the constraint from step 1 catches nothing, because the default
satisfies it on every write. Afterwards, a statement that forgets `org_id` fails
immediately instead of silently filing a row under the default org — which is
the whole point of step 1, realised here rather than there.

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
