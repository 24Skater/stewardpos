# Changelog

All notable changes to StewardPOS are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Two feature plans and a cleanup pass, none of it released. The version is still
`1.0.0-rc.1`; nothing here has been tagged.

### Added

**Registers, locations and the estate** (`docs/superpowers/plans/2026-08-17-register-management.md`)

- Locations are a real entity, not a text field on an order. Registers belong to
  one, are numbered per location, and carry a type and a `has_cash_drawer` flag
  as two independent axes rather than one conflated "is it a till".
- Every sale, return, drawer session and no-sale is stamped with the register it
  happened on and the cashier who was on shift at the time — not whoever is
  signed in when a report is run later.
- A register is a paired device. An admin issues a pairing code, the terminal
  redeems it once at `/pair` for a device token, and heartbeats every 60s so the
  estate view can show online, idle or offline. Revoking a register destroys the
  credential, ends any open shift, and refuses to leave a drawer open without an
  explicit force.
- A register can be retired but never deleted once it has sales.
- Per-register card reader binding, replacing a single store-wide device id.
- Reporting by register, cashier and location; drawer variance per register,
  no-sale counts, hourly breakdowns, and a web-versus-drawer split derived from
  the register's own capabilities. All of it filterable, and present in exports.
- Admin → Registers, Admin → Overrides and Admin → Shifts.

**PIN sign-on and till sessions** (`docs/superpowers/plans/2026-08-21-pin-till-auth.md`)

- A cashier signs on to a till with a six-digit PIN, which opens a *shift* and a
  scoped till session — never a password form and never a full JWT. PINs are
  stored bcrypt-hashed, are unique per org among active users, lock after five
  failures, and are redacted from every audit snapshot and every user endpoint.
- The register is gated on the terminal being enrolled rather than on somebody
  being logged in, with a non-dismissible lock screen and an idle timeout that
  ends the shift.
- Manager override: a supervisor PIN authorises one named action for ninety
  seconds without disturbing the cashier's shift. Single-use, action-matched,
  logged with approver and both values. Discount approvals route through the
  `requires_approval` / `approval_threshold` columns that had been dormant since
  migration 004 rather than through a second approval concept.
- An admin can assume a register from Admin → Registers without a device
  credential, with a banner naming whose till they are acting on, and can clear
  a PIN lockout from the cashier's row instead of waiting it out.

**Object storage**

- `STORAGE_ADAPTER=s3` now works, against Amazon S3 or the MinIO container in
  the Compose stack. Uploads keep their `/uploads/...` paths under either
  adapter, so switching does not invalidate URLs already stored against settings
  and products, and the bucket need not be public.

### Fixed

- **The audit trail silently discarded every action a till ever took.**
  `audit_logs.user_id` was `NOT NULL`, so any write without a user — every till
  session, every API key — was dropped. A mocked adapter had hidden it.
- **Revoking a register did not end its shift**, so the old token kept working.
- **A rejected PIN, an ending shift, and an ended assumed session** each sent the
  operator to `/login` — a screen a till-only user cannot use.
- **PIN attempts were throttled shop-wide rather than per register**, so one
  terminal's fat-fingering locked out every other till in the building.
- **The pairing screen asked for a code and linked nowhere.**
- Exports reported success over a file that was never written.
- CORS refused the register headers the client attaches to every request, which
  broke sign-in itself for any origin not proxied alongside the API.
- Timestamps are pinned to UTC end to end; `node-postgres` was parsing bare
  `TIMESTAMP` values in the process timezone.
- Product variants had no `ORDER BY`, so they reshuffled between reads.

### Changed

- **One auth gate in front of the admin console, not two.** Every admin page had
  wrapped itself in a second, role-based guard on top of the route's
  permission-based one. On the API Keys page the two disagreed, and the page was
  unreachable for exactly the role that had been granted it.
- **Invalidating the session now reaches every cache.** A permission or role
  change mid-session had kept gating the UI on whatever was loaded at sign-in.
- `GET /api/health/db` checks the database and the upload store instead of
  answering `healthy` unconditionally. It answers 503 naming which is down, and
  keeps the reason in the log — it is unauthenticated so a load balancer can
  poll it.
- `BCRYPT_ROUNDS` is honoured. It was documented and ignored, hardcoded in five
  places.

### Removed

- Fifty files nothing imported: twenty-two shadcn components, dead config,
  duplicate deploy scripts, two orphan password-reset scripts, and two of the
  three lockfiles. Twenty-seven packages went with them.
- `STORAGE_ADAPTER=azure` and the entire SMS configuration block. Neither had an
  implementation; both validated and then did nothing.

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
