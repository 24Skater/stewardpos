# Phase 0 — Honest Green Baseline

**Objective.** Before adding any feature, make the repo *truthful and buildable*: it compiles, boots
end‑to‑end via Docker Compose, has CI, uses one brand name, and quarantines dead code and
contradictory docs. This phase writes almost no product logic — it removes lies and friction so
later phases stand on solid ground.

**Entry criteria.** None (this is the first phase).

**Exit criteria.**
- `npm run typecheck && npm run build` (frontend) and `cd backend && npm run typecheck` both pass.
- `docker compose up -d --build` brings up postgres + minio + backend + frontend, all `healthy`.
- `curl http://localhost:3002/api/health` returns `{"success":true,...}`.
- CI workflow runs typecheck + lint + test + build on every PR and is green.
- No occurrence of "Persona POS" / `persona_pos` / `persona-pos` remains except in CHANGELOG history.
- A single authoritative `docs/` tree exists; stale/contradictory root docs are archived.

---

### `P0-T1` — Capture the real baseline
**Context.** We must know exactly what compiles and what doesn't before changing anything.
**Files.** Create `docs/masterplan/BASELINE.md`.
**Steps.**
1. Run, capturing full output into `BASELINE.md`:
   - `npm install` then `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test`.
   - `cd backend && npm install && npm run typecheck && npm run lint && npm run test`.
2. Record: which commands pass/fail, error counts, and the first ~20 errors of each failure.
3. List every route in `backend/src/server.ts` and, for each, whether it currently applies
   `authenticate`/`authorize` (grep each `routes/*.ts`). This seeds Phase 2.
4. List every `src/**/*.tsx` page and which data source it imports (`@/lib/db`, `@/lib/di`,
   `@/lib/api-client`, or `@/lib/db-operations`). This seeds Phase 1.
**Acceptance criteria.** `BASELINE.md` documents current pass/fail state and the two inventories.
**Verification.** File exists and lists all 16 routes and all ~23 pages with their data source.

---

### `P0-T2` — Make both apps typecheck (green compile)
**Context.** AI‑generated code frequently has type errors. We need a green compile as the floor.
**Files.** Wherever `tsc --noEmit` reports errors (frontend `src/**`, backend `backend/src/**`).
**Steps.**
1. Fix TypeScript errors with **minimal, behavior‑preserving** changes (see
   `build-error-resolver` agent guidance). Prefer correct types over `any`; use `unknown` + narrow.
2. Do **not** delete features to silence errors — if a whole module is broken and slated for
   removal in Phase 1 (e.g. `di.ts`), you may exclude it from `tsconfig` temporarily and note it in
   `BASELINE.md`, but do not delete yet.
3. Keep the two `tsconfig`s honest: no loosening `strict` to hide problems.
**Acceptance criteria.** Both `npm run typecheck` (root) and backend typecheck exit 0.
**Verification.** `npm run typecheck && (cd backend && npm run typecheck)` → exit 0.

---

### `P0-T3` — Unify the brand to "StewardPOS" (fixes C6)  `[parallel-ok]`
**Context.** "Persona POS" and "StewardPOS" both appear; a rebrand is mid‑flight (`.env` is dirty).
**Files.** repo‑wide. Key spots: root `package.json` (`name: vite_react_shadcn_ts`),
`backend/package.json` (`persona-pos-backend`, author), `backend/src/config/index.ts`
(`noreply@persona-pos.local`), `backend/env.example` (`DB_NAME=persona_pos`), `docker-compose*.yml`,
`nginx.conf`, `src/**` UI strings, migration default `store_name`.
**Steps.**
1. `grep -ri "persona" --include=*.ts --include=*.tsx --include=*.json --include=*.yml
   --include=*.md --include=*.conf .` (exclude `node_modules`, `CHANGELOG.md`). Replace with the
   StewardPOS equivalent. Package names: root → `stewardpos`, backend → `stewardpos-backend`.
2. Default email sender → `noreply@stewardpos.local`. Default DB name → `stewardpos`.
3. Confirm `.env` / `.env.example` / `backend/env.example` all use `stewardpos` DB name and the
   Compose defaults match (`docker-compose.yml` already uses `stewardpos`).
4. Do not rewrite git history; leave `CHANGELOG.md` past entries as‑is.
**Acceptance criteria.** No live "persona" references remain; app still builds.
**Verification.** `grep -ri persona --exclude-dir=node_modules --exclude=CHANGELOG.md .` returns
nothing (or only intentional historical notes). Frontend + backend typecheck still pass.

---

### `P0-T4` — De‑duplicate and organize documentation  `[parallel-ok]`
**Context.** Dozens of overlapping/contradictory docs (`archive/**`, `docs/archive/**`, root
`*.md`) make it impossible to know what's true. Consolidate into one tree.
**Files.** Root `*.md`, `archive/**`, `docs/archive/**`.
**Steps.**
1. Create `docs/` structure: `docs/guides/` (install, configure, operate), `docs/reference/`
   (env vars, API), `docs/archive/` (historical, clearly marked non‑authoritative).
2. Move all stale/phase/AI‑process docs into `docs/archive/` with a top banner:
   `> ARCHIVED — historical, may be inaccurate. See docs/masterplan and docs/guides.`
3. Keep root `README.md` but replace the aspirational "completed" roadmap section with a link to
   `docs/masterplan/README.md` and an honest status badge (pre‑1.0 / in development).
4. Ensure `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md` remain at root.
**Acceptance criteria.** One authoritative docs tree; archived docs are labeled; root README no
longer claims unbuilt features as done.
**Verification.** Manual: `docs/` tree exists; no root doc contradicts `docs/masterplan`.

---

### `P0-T5` — Boot the full stack via Docker Compose
**Context.** Compose files exist but may be stale (ports, env, health, migrations, seeding).
**Files.** `docker-compose.yml`, `Dockerfile`, `backend/Dockerfile`, `nginx.conf`, `.env.example`.
**Steps.**
1. `cp .env.example .env`; set a strong `JWT_SECRET` (≥32 chars) and DB creds.
2. `docker compose up -d --build`. Fix build failures (missing build args, Node version, `npm ci`
   lockfile issues, `tsc` build step, nginx config path, frontend `VITE_API_BASE_URL` build arg).
3. Ensure the backend container **runs migrations on start** (verify `migrator` is invoked at boot
   or via an entrypoint step) and optionally seeds when `AUTO_SEED=true`.
4. Confirm health: all four services report `healthy` in `docker compose ps`.
5. Verify the frontend (`http://localhost:8081`) loads and can reach the backend
   (`http://localhost:3002/api/health`) — fix CORS/`VITE_API_BASE_URL`/nginx proxy as needed.
**Acceptance criteria.** `docker compose up -d --build` yields 4 healthy services; health endpoint OK;
frontend loads without console CORS errors.
**Verification.**
```bash
docker compose up -d --build && sleep 20 && docker compose ps
curl -fsS http://localhost:3002/api/health
```
Both succeed; `ps` shows all healthy.

---

### `P0-T6` — Continuous Integration
**Context.** No CI gate exists. Every later phase relies on green CI.
**Files.** Create `.github/workflows/ci.yml`.
**Steps.**
1. Trigger on `pull_request` and `push` to `main`. Two jobs: `frontend` and `backend`.
2. `frontend`: Node 20, `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test -- --run`,
   `npm run build`.
3. `backend`: Node 20, `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test -- --run`
   (uses SQLite test DB — no external services needed).
4. Add a `docker-build` job that runs `docker compose build` to catch image regressions.
5. Add a status badge to root `README.md`.
**Acceptance criteria.** CI runs on PRs and blocks merge on failure.
**Verification.** Open a draft PR; all CI jobs run and pass on the Phase‑0 branch.

---

### `P0-T7` — Environment & secrets reference  `[parallel-ok]`
**Context.** Env is split across `.env`, `.env.example`, `.env.dev`, `backend/env.example`,
`environments/*` with drift (adapter defaults, DB names, JWT).
**Files.** `docs/reference/environment.md`, `.env.example`, `backend/env.example`.
**Steps.**
1. Produce **one** table documenting every env var: name, scope (frontend/backend/compose),
   required?, default, example, description. Include `JWT_SECRET`, `DB_*`, `CORS_ORIGIN`,
   `RATE_LIMIT_*`, `BCRYPT_ROUNDS`, `MINIO_*`, `EMAIL_*`, `STRIPE_*` (Phase 3), `AUTO_SEED`.
2. Reconcile defaults: production DB adapter = `postgres`; local dev may use `sqlite`. Make the two
   `env.example` files consistent with the doc and with `config/index.ts` (note: config currently
   defaults `port` 3000 but server/compose use 3001 — fix the drift).
3. Ensure `.gitignore` covers `.env`, `.env.*` (except `.env.example`/`.env.dev` if intentionally
   shared), `*.db`, `logs/`, `uploads/`.
**Acceptance criteria.** Single env reference; example files match it and boot the stack.
**Verification.** A fresh `.env` copied from the documented example boots the stack (re‑run P0‑T5).
