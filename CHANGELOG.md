# Changelog

All notable changes to StewardPOS are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Nothing yet.

---

## [1.0.0-rc.1] — 2026-08-17

The first release candidate. StewardPOS began as an AI-scaffolded prototype in
which a great deal existed and very little worked; this is the end of a nine-phase
plan (`docs/masterplan/`) to make it a thing a shop can actually run.

**It is a release candidate rather than 1.0.0 because two go-live checks cannot
yet pass** — see [Not in this release](#not-in-this-release). Everything else on
that checklist does.

### The money path

- **The server prices every sale.** The register sends intents — product, variant,
  quantity, a requested discount — and the server looks up prices, applies tax and
  discount rules, and computes every total. A client-supplied price is ignored.
  Before this, the API stored whatever it was sent, so anyone able to shape a
  request could buy a $40 item for a penny.
- **Integer cents throughout.** Floating-point dollars do not survive the
  arithmetic a receipt needs; totals convert to dollars only at the storage and
  serialization boundary.
- **Orders are transactional.** The order, its items, its payments and the stock
  decrement commit together or not at all. Stock is decremented conditionally
  (`WHERE stock >= n`), so two registers selling the last unit cannot both succeed.
- **Cash, change and drawer sessions**, with expected-versus-counted variance.
- **Split tender** — cash plus card, or store credit topped up with cash — recorded
  per payment rather than as a single method on the order.
- **Returns and refunds**, repriced from the original order, with restock gated on
  approval, and store credit issuable and spendable.
- **Discounts and promo codes** validated server-side across all four sources,
  with limits and approval thresholds enforced.

### Reporting

- Five endpoints (`/api/reports/*`) that aggregate in SQL: sales summary, daily
  series, top products, tender split and refunds by reason.
- Exports to PDF, Excel and CSV built from the same payload the screen renders,
  so the paper and the screen cannot disagree.

### Catalog, customers and admin

- Products with variants, images, barcode lookup, search, filtering and paging;
  CSV import and export; low stock as a store setting.
- Customers, with archival that does not destroy trading history.
- Store branding — colour, logo, favicon, receipt header and footer — applied
  across the app and onto receipts.
- An audit log filterable by user, entity, action and date, showing what changed
  field by field.
- API keys: hashed at rest, shown once, scoped, revocable, and unable to manage
  other keys.

### Security and operations

- JWT authentication with role-based permissions enforced on **every** protected
  route, checked against the database on each request rather than trusted from
  the token.
- Rate limiting per client address, with a separate budget for failed sign-ins.
- A production Docker Compose stack with Caddy terminating TLS and automatic
  certificates; only the proxy publishes ports.
- **The backend refuses to start in production on the placeholder secrets this
  repository ships.**
- Migrations run on start and a failure is fatal, rather than serving against a
  schema the code does not match.
- Scripted backup and restore, both tested against a real stack.
- Bounded log rotation.

### Not in this release

- **Card payments are simulated.** The Stripe Terminal integration (P3-T5) is
  unwired: it needs real credentials and hardware to verify, and was not written
  blind. Cash and manual tender work. The Square, Clover, Verifone and Dejavoo
  adapters compile but are flagged off for the same reason.
- **No install has been verified on a real VPS.** The guide is complete, the
  compose file and Caddyfile validate, and every failure path is covered by
  tests — but nobody has yet followed it start to finish on a clean server.
- **Multi-tenant is a foundation, not a feature.** `org_id` exists on twenty
  tables and on every authenticated request; **no query filters on it**.
- **Day bucketing follows the database server's timezone** (UTC in every shipped
  image). A store several hours behind UTC will see an evening sale counted
  against the following day.
- **Deferred by decision**, not omission: Services & Quotes, full CRM and
  loyalty, SSO, SMS, offline/PWA, and multi-tenant SaaS. The reasoning is in the
  backlog at the end of `docs/masterplan/phase-9-golive.md`.

### Promoting this to 1.0.0

Two things, and then it is a tag:

1. A card sale completed end to end against real Stripe Terminal hardware in test
   mode, with a decline creating no order.
2. A fresh VPS taken to a working HTTPS install by following
   `docs/guides/install-vps.md` and nothing else.

---

## Before 1.0.0-rc.1

This project has no released history. Everything above is the first release.

The development that produced it is recorded phase by phase in
`docs/masterplan/`, where each file carries completion notes describing what was
built, what it broke, and what was deliberately left undone. That is a more
useful record than a reconstructed changelog would be — several of the entries
above exist because a phase found the previous one had not actually worked.

A prior version of this file listed in-progress development as though it were
released. It has been replaced.
