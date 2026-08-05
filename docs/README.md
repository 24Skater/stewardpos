# StewardPOS Documentation

StewardPOS is **pre-1.0 and in active development**. Where documents disagree, the
order of authority is:

1. [`masterplan/ASSESSMENT-2026-08-04.md`](./masterplan/ASSESSMENT-2026-08-04.md) — verified current state
2. [`masterplan/`](./masterplan/README.md) — the plan and its locked decisions
3. [`guides/`](./guides/) and [`reference/`](./reference/) — how to run and configure things
4. [`archive/`](./archive/) — **historical only**, every file carries a banner saying so

---

## Start here

| If you want to | Read |
|---|---|
| Know what actually works today | [Readiness assessment](./masterplan/ASSESSMENT-2026-08-04.md) |
| Understand the road to v1.0 | [Master plan](./masterplan/README.md) |
| Deploy it | [Deployment guide](./guides/deployment.md) |
| Try it locally, fast | [Demo quick start](./guides/demo.md) |
| Configure environment variables | [Environment reference](./reference/environment.md) |
| Manage npm dependencies from the admin UI | [Component management](./guides/component-management.md) |

## Layout

```
docs/
├── masterplan/    Plan to v1.0 — phases 0-9, conventions, and the assessment
├── guides/        Task-oriented: deploy, demo, operate
├── reference/     Lookup material: environment variables
└── archive/       Superseded docs, kept for provenance only
    └── process/   AI-assisted build logs from the original scaffolding
```

## A note on the archive

The archive is large because this project was scaffolded with heavy AI assistance and
accumulated many overlapping status reports — several of which claim features are
"complete" that the assessment found broken or missing. They were kept rather than
deleted so the history is inspectable, but **nothing in `archive/` should be treated as
a description of current behaviour.**

Notably superseded:

- `archive/ROADMAP.md` and `archive/CODE-MAP-AND-ROADMAP.md` — replaced by [`masterplan/`](./masterplan/README.md)
- `archive/CODE-REVIEW-SUMMARY-2026-01.md` and `archive/process/CODE-REVIEW-REPORT.md` —
  replaced by the [assessment](./masterplan/ASSESSMENT-2026-08-04.md), which contradicts
  them in several places
- `archive/process/PHASE*.md` — build logs from the original scaffolding, not the
  master plan's phases
