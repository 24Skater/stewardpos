# Hosting invariants

Two rules this repository holds itself to, both enforced by
`scripts/ci/check-platform-boundaries.sh` as the **Platform boundaries** CI job.

Neither requires anything hosted. StewardPOS runs standalone, and today that is
the only way it runs.

That guard sits alongside, not inside, the gitleaks **Secret scan** job:
gitleaks finds secrets by shape, and a hosted-billing Stripe key and a store's
own Stripe key have exactly the same shape. What this guard enforces is the
variable name.

## 1. No hardcoded production domain

A deployment domain is configuration, never a source constant. In this
repository that means `deploy/edge/sites/*.caddy` and the comma-separated
`CORS_ORIGIN` list — not a literal hostname compiled into the app.

## 2. No hosted-billing credentials

If this app is ever run as part of a hosted subscription, the billing for that
subscription is not this app's business. Credentials named `STRIPE_PLATFORM_*`
must never appear here, and this app never imports a billing client belonging to
whoever hosts it.

That is entirely separate from the Stripe and Square integrations POS uses for a
store's *own* money, which are ordinary application configuration and belong in
the encrypted settings row where they already live.

## Not yet: multi-tenancy

StewardPOS is single-tenant. `org_id` exists on 20 of 42 tables and **no query
filters on it**, which is worse than not having the column: it looks like
tenancy and enforces nothing. Treat one deployment as belonging to one
organization, because that is what it is.

The plan when that changes is Postgres Row-Level Security rather than a
query-layer guard, and the reason is specific to this codebase. There is no ORM
to hook — 42 tables of raw SQL, with 44 `INSERT` statements across two adapters,
none of which name `org_id`. Rewriting every query by hand is weeks of work with
a permanent risk that the forty-fifth insert forgets. RLS makes the queries
correct without rewriting them, including the ones nobody has written yet.

Two things to know before that lands, both already documented in
`docs/guides/multi-tenant.md`:

- The org context must be set **transaction-locally** (`set_config(..., true)`).
  A plain `SET` survives on a pooled connection and leaks into the next
  request — which is the whole failure this is meant to prevent.
- `FORCE ROW LEVEL SECURITY` is required, not just `ENABLE`. Without it, any
  connection made as the table owner bypasses every policy.

**SQLite is single-organization, development and test only, permanently.** It
has neither `ALTER COLUMN` nor row-level security.
