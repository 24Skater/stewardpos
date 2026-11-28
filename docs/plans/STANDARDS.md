# Executor standards (read before every task)

1. Do only what the task file says. Anything else goes in the task file as a question, not into code.
2. Reuse the helper the task names. Never add a dependency the task does not name.
3. Smallest complete diff: no options, wrappers or "for later" code. Delete rather than add where you can.
4. Money is integer cents (`*_cents BIGINT` / `INTEGER`). Never let the client send a price, tax or total; the server reprices.
5. Every new table: Postgres and SQLite migration with the same number, `org_id` NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001', and the `schema_migrations` insert line copied from 028.
6. Next migration number = highest in `backend/migrations/postgres` + 1. Re-check before committing; rebase if taken.
7. Both `PostgresAdapter.ts` and `SQLiteAdapter.ts` get every new method, with a SQLite test.
8. Validate every request body with Zod (`.issues`, not `.errors`; `partialUpdate` from `utils/zod.ts` for PATCH-style updates).
9. Every route uses `requirePermission(resource, action)`; every write calls `audit(req, ...)` from `services/audit.ts`.
10. Every feature is off by default behind its setting. With it off, existing tests and behavior are unchanged.
11. Outside services go through a port plus adapters, chosen by a setting `internal | <provider> | off`; credentials via `encryptCredentials`. Unconfigured means "unavailable", never a fake success.
12. Integrations with sibling apps: HTTP only, 3 s timeout, through the outbox; never block checkout.
13. Emit the webhook events the task lists via `enqueueEvent` (T-02). Do not invent event names.
14. Tax, expiry and consent rules are settings, never constants. Docs say "check your local rules".
15. Comments explain why, in one line. A known shortcut gets `// shortcut: <limit>, <when to upgrade>`.
16. Never cut: validation at trust boundaries, error handling that prevents data loss, permissions, accessibility labels.
17. No emojis anywhere. No `console.log`. No `any`.
18. Tests: Vitest beside the code (`__tests__/`). Run only the task's tests: `npx vitest run <path>` (frontend) or `cd backend && npm run test:run -- <path>`.
19. `beforeEach(() => { x.mockReset(); })` with braces. Use `fireEvent`; user-event is not installed.
20. Frontend: functional components, existing `src/components/ui/*`, API calls only through `src/lib/api/`.
21. Docs: add or update the page the task names under `docs/guides/`, and one line under `## [Unreleased]` in CHANGELOG.md.
22. Commit on the task's branch only, conventional message (`feat: ...`), no attribution lines, no `--no-verify`. Never push to main.
23. Do not touch the dev database on port 5435. Do not add `STRIPE_PLATFORM_*` or a literal platform domain.
24. Two failed attempts: stop and report what failed. Reply in at most 100 words: files changed, test result, blockers.
