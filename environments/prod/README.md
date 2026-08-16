# Production

**The production stack is not here.** It is `docker-compose.prod.yml` in the
repository root, and the guide is
[`docs/guides/install-vps.md`](../../docs/guides/install-vps.md):

```bash
cp .env.prod.example .env      # from the repository root
# fill it in
docker compose -f docker-compose.prod.yml up -d
```

## Why this directory is nearly empty

It used to hold a `docker-compose.prod.yml` that *overlaid* the development
stack, and that arrangement was the problem rather than a detail of it.

An overlay inherits everything it does not override, and the base stack
publishes Postgres, MinIO and the API on host ports because that is what a
developer wants. The prod overlay overrode some of those and not others, so
following this directory's instructions put a database on the public internet,
listening on 5432, behind whatever password the operator had set. It also had no
TLS at all.

The stack in the root is standalone for exactly that reason: it cannot inherit a
mistake. Only Caddy publishes ports, it terminates TLS with automatic
certificates, and the backend refuses to start on the placeholder secrets this
repository ships.

`environments/dev/` and `environments/qa/` are still overlays, which is fine —
neither is exposed to the internet.
