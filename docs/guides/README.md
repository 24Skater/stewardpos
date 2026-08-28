# Guides

Everything an operator needs, in the order they need it.

## Running a shop on it

| Guide | What it covers |
|-------|----------------|
| [install-vps.md](./install-vps.md) | **Start here.** Bare Ubuntu server to a working till over HTTPS, in about half an hour |
| [backup-restore.md](./backup-restore.md) | Taking backups, getting them off the box, and restoring one — set this up on day one |
| [secret-rotation.md](./secret-rotation.md) | Rotating a credential that has been exposed, and the one exposure already in this repository's history |
| [operations.md](./operations.md) | Logs, health checks, and what to do when the shop says it's not working |
| [upgrade.md](./upgrade.md) | Taking a new version, and rolling one back |

## Configuring it

| Guide | What it covers |
|-------|----------------|
| [register-management.md](./register-management.md) | Running more than one till: locations, pairing, cashier PINs, manager overrides, loss prevention |
| [api-keys.md](./api-keys.md) | Machine access: scopes, storage, revocation |
| [component-management.md](./component-management.md) | Managing the UI component set |
| [demo.md](./demo.md) | The demo profile, and how it differs from a real install |

## Deploying it differently

| Guide | What it covers |
|-------|----------------|
| [deploy-alternatives.md](./deploy-alternatives.md) | Managed Postgres, S3, bare systemd, PaaS — possible, none of it supported |
| [deployment.md](./deployment.md) | The dev/QA/production environment overlays |
| [multi-tenant.md](./multi-tenant.md) | What v1 is (single-tenant), and what multi-tenant would actually require |

## Reference

- [../reference/environment.md](../reference/environment.md) — every environment variable

---

**Docker Compose on a single VPS is the supported path.** It is what the
maintainers run and what CI builds. Everything in "deploying it differently"
works, and none of it is tested on every release.
