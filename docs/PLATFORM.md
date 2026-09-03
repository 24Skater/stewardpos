# Steward Platform

StewardPOS is one app in the Steward platform. This file records the
platform-level constraints that apply to *this repository* and points at the
decision record that explains why they exist.

**Decision record:** https://claude.ai/code/artifact/fffcde73-8186-4c63-83f9-979d80f82f42

It covers seven decisions - hosting model, identity, tenancy, where platform
code lives, billing and entitlements, routing, and cross-app integration - plus
the phased roadmap this repository is working through.

## Where this repo sits

StewardPOS is the **base SKU**, and StewardTable is its add-on. That is the
commercial arrangement. Technically it runs the other way round: Table's schema
is the foundation, because POS has neither an order-status lifecycle nor any
tenancy today. Do not read the pricing relationship as an architectural one.

POS is **single-tenant today** and stays that way until Phase 3, which is
deliberately the last and most isolated migration in the plan. It is the
hardest because POS enforces nothing at the ORM layer - so it gets Postgres
Row-Level Security rather than a port of Table's Prisma guard, and it gets its
own phase so a mistake there cannot damage the phases that already earn money.

## Invariants

Enforced by `scripts/ci/check-platform-boundaries.sh`, the `Platform
boundaries` CI job. It sits alongside, not inside, the gitleaks `Secret scan`
job: gitleaks finds secrets by shape, and a platform Stripe key and a tenant
Stripe key have the same shape. The boundary this guard enforces is the
variable name.

### 1. No hardcoded platform domain

The platform root domain is configuration, never a source constant. This repo
is currently clean; keep it that way. When Phase 3 introduces host-based tenant
resolution, derive it from `PLATFORM_ROOT_DOMAIN` the way
`steward-table/lib/platform-domain.ts` does.

### 2. Platform billing is not this app's business

This app already runs Stripe for the *church's own* terminal payments
(`backend/src/terminal/StripeTerminalAdapter.ts`, keys in the encrypted
`settings` singleton). That is entirely separate from the money churches pay
Steward for the subscription.

- `STRIPE_PLATFORM_*` credentials exist only in the console's environment and
  must never appear in this repository.
- Platform webhooks go to the console host. Tenant commerce webhooks stay on
  this app's existing endpoints.
- This app never imports the console's Stripe client. It knows about
  entitlements; it does not know about invoices.

## Roadmap position

- **Phase 0 (done here):** boundary guard in CI.
- **Phase 1-2:** no code changes. POS keeps selling on dedicated stacks at the
  Managed price while Table and then Congregation/VBS move onto the pool.
- **Phase 3:** `027_rls.sql` - a non-owner application role, `ENABLE` plus
  `FORCE` RLS, one policy per `org_id` table; a per-request transaction setting
  `app.org_id` via `set_config(..., true)`; **the pooled-connection leak test**
  proving two sequential requests for different orgs on the same connection
  cannot see each other's rows; per-org `settings` (which is what finally
  unblocks per-org encrypted payment credentials); `UNIQUE (org_id, email)`;
  `<orgId>/` upload prefixes with authenticated uploads; triage of the 22
  tables that have no `org_id`. SQLite becomes formally single-org dev/test
  only.
- **Phase 4:** `POST /api/auth/sso/exchange`, verifying the ID token and then
  calling the existing `mintSession()`. PIN/till login and `X-API-Key` stay
  exempt from SSO, permanently - a cashier cannot be locked out of a register
  by an identity provider outage.

See the decision record for the full sequence.
