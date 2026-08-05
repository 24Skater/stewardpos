# Phase 6 — Reports, Exports, Branding & Audit

**Objective.** Round out the admin surface: accurate reporting with PDF/Excel/CSV export, full
store/receipt branding, and a usable audit‑log view. All reads are RBAC‑gated and org‑scoped, and all
figures come from server‑persisted (repriced) data.

**Entry criteria.** Phases 3–5 green (real orders, returns, discounts to report on).

**Exit criteria.**
- Sales/returns/inventory reports with date filtering, computed from persisted orders/returns.
- Export to PDF (`jspdf`), Excel (`xlsx`), and CSV matches on‑screen figures.
- Branding UI (store identity, logo/favicon, brand color, receipt header/footer) persists to
  `settings` and is reflected in the app + receipts with a live preview.
- Audit log is filterable/paginated and shows before/after for mutations.

---

### `P6-T1` — Reporting queries (API)
**Context.** Reports must aggregate from persisted data server‑side, not recompute in the browser.
**Files.** `backend/src/api/routes/reports.ts` (create if missing; the frontend has `AdminReports`),
a `reports` service with SQL aggregations, `src/lib/api/reports.ts`.
**Steps.**
1. Endpoints (all `authorize('reports','read')`, org‑scoped, `?from=&to=` date range):
   - `GET /api/reports/sales-summary` → gross, discounts, tax, net, refunds, order count, avg ticket.
   - `GET /api/reports/sales-by-day` → time series for charts (`recharts`).
   - `GET /api/reports/top-products` → best sellers by qty/revenue.
   - `GET /api/reports/payment-mix` → cash vs card totals.
   - `GET /api/reports/returns-summary` → refund totals/reasons.
2. Compute in SQL (sum on `DECIMAL`), return numbers ready to render. Handle empty ranges.
**Acceptance criteria.** Reports reconcile exactly with the underlying orders/returns for a known
seeded dataset.
**Verification.** Seed N orders with known totals → `sales-summary` matches hand‑computed figures
(integration test).

### `P6-T2` — Reports UI + charts  `[parallel-ok]`
**Files.** `src/pages/Reports.tsx`, `src/pages/admin/AdminReports.tsx`, chart components.
**Steps.** Date‑range picker, summary cards, `recharts` visualizations fed by P6‑T1. Follow
`dataviz` skill conventions (consistent palette, accessible, light/dark). Loading/empty/error states.
**Acceptance criteria.** Reports render correctly and update with the date range.
**Verification.** Manual: change range → figures + charts update; matches API responses.

### `P6-T3` — Exports: PDF / Excel / CSV
**Files.** `src/lib/export-utils.ts`, `src/pages/admin/AdminExports.tsx`, optional backend
`GET /api/reports/*/export`.
**Steps.** From the same report data, export PDF (`jspdf`+`jspdf-autotable`), Excel (`xlsx`), and CSV.
Include store branding on the PDF. Ensure exported figures equal on‑screen figures (same source).
**Acceptance criteria.** All three formats export and reconcile with the report.
**Verification.** Export a sales report as each format → totals match the UI.

### `P6-T4` — Branding & receipt customization
**Context.** `settings` has `store_name/email/phone/logo_url/icon_url/brand_color/config`;
`AdminSettings` + `AdminReceipts` pages exist. Make them persist and take effect.
**Files.** `backend/src/api/routes/admin.ts` (settings CRUD), `src/pages/admin/AdminSettings.tsx`,
`src/pages/admin/AdminReceipts.tsx`, theme/brand‑color application, `Receipt.tsx`.
**Steps.**
1. `GET/PUT /api/admin/settings` (authorize `settings`): store identity, logo/favicon (uploaded via
   Phase 4 storage), brand color, receipt header/footer, tax rate default, timezone.
2. Apply `brand_color` to the theme (CSS variable) with a live preview; set favicon; show logo in the
   POS header and on receipts.
3. Receipt customization (header/footer/logo) flows into the Phase 3 receipt renderer.
**Acceptance criteria.** Branding changes persist and immediately affect UI + receipts.
**Verification.** Change brand color + upload logo → header/receipt update after save; reload persists.

### `P6-T5` — Audit log view  `[parallel-ok]`
**Files.** `backend/src/api/routes/admin.ts` (audit list), `src/pages/admin/AdminAudit.tsx`.
**Steps.** `GET /api/admin/audit` with pagination + filters (user, entity, action, date). UI table
with before/after diff view. RBAC `authorize('users'|'settings','read')` or a dedicated `audit` read.
**Acceptance criteria.** Mutations (from P2‑T7) are visible, filterable, paginated.
**Verification.** Perform several mutations → they appear filtered correctly in AdminAudit.

### `P6-T6` — API keys management (optional‑but‑scaffolded)  `[parallel-ok]`
**Context.** `apikeys.ts` + `AdminApiKeys` exist. If kept in v1, secure them; else flag as beta.
**Files.** `backend/src/api/routes/apikeys.ts`, `src/pages/admin/AdminApiKeys.tsx`.
**Steps.** If retained: keys are hashed at rest, shown once on creation, scoped + revocable,
rate‑limited, and usable as an alternate auth for read endpoints. Otherwise, hide behind a flag and
document as experimental.
**Acceptance criteria.** Either a secure, documented API‑key flow, or a clearly‑flagged beta.
**Verification.** Create a key → it authenticates a scoped read; revoke → it stops working.
