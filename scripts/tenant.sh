#!/usr/bin/env bash
#
# StewardPOS - run one stack per customer on one machine.
#
#   ./scripts/tenant.sh new  <slug> <domain>   provision a customer
#   ./scripts/tenant.sh list                   what is running, and how healthy
#   ./scripts/tenant.sh up|down <slug>         start / stop one
#   ./scripts/tenant.sh upgrade <slug>|--all   pull, migrate, restart
#   ./scripts/tenant.sh backup  <slug>|--all   database + uploads + env
#   ./scripts/tenant.sh rotate-jwt <slug>      new signing key (signs everyone out)
#   ./scripts/tenant.sh exec <slug> <cmd...>   run a command in that backend
#   ./scripts/tenant.sh rm <slug>              remove, after a final backup
#
# ## Why one stack per customer
#
# No query in this codebase filters by organisation yet. `getAllProducts`,
# `getAllOrders`, `getAllCustomers` and the rest read the whole table, so two
# customers sharing a database would see each other's catalogue, sales and
# customer list on day one. `settings` is worse: it is `WHERE id = 1`, a single
# row holding the store name, tax rate and the payment credentials.
#
# One database per customer is therefore not a stepping stone toward isolation -
# for now it IS the isolation, and it is complete. See
# docs/guides/hosting-multiple-customers.md for when that stops being the right
# trade, and docs/guides/multi-tenant.md for what pooling them would take.
#
# ## Where state lives
#
#   tenants/<slug>/.env       every secret for that customer, generated here
#   deploy/edge/sites/*.caddy one routing file per customer
#   docker volumes            namespaced by the compose project stewardpos-<slug>
#
# `tenants/` is gitignored. It is the one thing on the host that cannot be
# rebuilt from this repository, so it belongs in your backups.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TENANT_COMPOSE="docker-compose.tenant.yml"
EDGE_COMPOSE="docker-compose.edge.yml"
TENANTS_DIR="tenants"
SITES_DIR="deploy/edge/sites"

# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------

die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }

# A slug becomes a compose project, a Docker network alias, a DNS-ish label and
# a directory name. Constrain it once, here, rather than discovering which of
# those rejects a capital letter after the volumes are created.
valid_slug() {
  [[ "$1" =~ ^[a-z][a-z0-9-]{1,30}$ ]]
}

# Generated, never invented. `openssl rand -base64 32` is what the install guide
# tells operators to run by hand; doing it here is the difference between a
# strong secret per customer and the same one pasted three times.
generate_secret() {
  openssl rand -base64 32 | tr -d '\n=' | tr '+/' '-_'
}

tenant_dir()  { echo "$TENANTS_DIR/$1"; }
tenant_env()  { echo "$TENANTS_DIR/$1/.env"; }
project()     { echo "stewardpos-$1"; }

require_tenant() {
  local slug="$1"
  [ -n "$slug" ] || die "Which tenant? Try: $0 list"
  [ -f "$(tenant_env "$slug")" ] || die "No such tenant: $slug (looked for $(tenant_env "$slug"))"
}

# Every compose call for a tenant goes through here, so the project name and the
# env file can never be forgotten. Forgetting -p is not a small mistake: compose
# would fall back to the directory name, and every tenant would share one
# project - and therefore one set of volumes.
tc() {
  local slug="$1"; shift
  docker compose -p "$(project "$slug")" --env-file "$(tenant_env "$slug")" -f "$TENANT_COMPOSE" "$@"
}

edge_running() {
  docker ps --format '{{.Names}}' | grep -q '^stewardpos-edge$'
}

reload_edge() {
  if ! edge_running; then
    warn "The shared edge is not running; nothing to reload."
    warn "Start it once with: ACME_EMAIL=you@example.com docker compose -f $EDGE_COMPOSE up -d"
    return 0
  fi
  # Reload rather than restart: a restart drops every other customer's
  # connections to add one.
  # Wrapped in `sh -c` so the path is a substring of one argument rather than
  # an argument of its own. Git Bash on Windows rewrites a bare `/etc/...`
  # argument into a Windows path before Docker sees it, and the reload then
  # fails looking for C:/Program Files/Git/etc/caddy/Caddyfile. Irrelevant on
  # the Linux host this actually runs on, and free to be robust about.
  if docker exec stewardpos-edge sh -c 'caddy reload --config /etc/caddy/Caddyfile' >/dev/null 2>&1; then
    ok "  edge reloaded"
  else
    warn "  edge reload failed - check: docker logs stewardpos-edge"
  fi
}

list_slugs() {
  [ -d "$TENANTS_DIR" ] || return 0
  find "$TENANTS_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort
}

# ---------------------------------------------------------------------------
# new
# ---------------------------------------------------------------------------

cmd_new() {
  local slug="${1:-}" domain="${2:-}"

  [ -n "$slug" ] && [ -n "$domain" ] || die "Usage: $0 new <slug> <domain>"
  valid_slug "$slug" || die "Slug must be lowercase letters, digits and hyphens, starting with a letter: $slug"
  [ ! -d "$(tenant_dir "$slug")" ] || die "Tenant already exists: $slug"

  # A domain typo is cheap to fix now and expensive later: it is baked into
  # CORS_ORIGIN and into the certificate Let's Encrypt issues.
  [[ "$domain" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "That does not look like a hostname: $domain"

  for existing in $(list_slugs); do
    if grep -q "^TENANT_DOMAIN=$domain$" "$(tenant_env "$existing")" 2>/dev/null; then
      die "$domain already belongs to tenant '$existing'"
    fi
  done

  info "Provisioning $slug at $domain"

  mkdir -p "$(tenant_dir "$slug")" "$SITES_DIR"

  local env_file; env_file="$(tenant_env "$slug")"
  # Written before the secrets, then chmod'd, so the file is never readable by
  # others even briefly.
  : > "$env_file"
  chmod 600 "$env_file"

  {
    echo "# StewardPOS tenant: $slug"
    echo "#"
    echo "# Generated by scripts/tenant.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)."
    echo "# Every secret below is unique to this customer. Losing this file means"
    echo "# losing access to their database and their encrypted payment"
    echo "# credentials, so it belongs in your backups - see scripts/tenant.sh backup."
    echo
    echo "TENANT_SLUG=$slug"
    echo "TENANT_DOMAIN=$domain"
    echo
    echo "POSTGRES_DB=stewardpos"
    echo "POSTGRES_USER=stewardpos_user"
    echo "POSTGRES_PASSWORD=$(generate_secret)"
    echo
    echo "# Signs this customer's session tokens. Rotating it signs everyone out:"
    echo "#   ./scripts/tenant.sh rotate-jwt $slug"
    echo "JWT_SECRET=$(generate_secret)"
    echo "JWT_EXPIRES_IN=24h"
    echo
    echo "# Encrypts the Stripe or Square credentials this customer saves in"
    echo "# their settings. Required when hosting: without it their live key sits"
    echo "# in clear text in a database you operate."
    echo "#"
    echo "# Do NOT rotate this the way you rotate JWT_SECRET. The stored values"
    echo "# are encrypted with it; changing it makes them undecryptable and the"
    echo "# customer has to re-enter their credentials."
    echo "CREDENTIALS_KEY=$(generate_secret)"
    echo
    echo "MINIO_ROOT_USER=stewardpos-$slug"
    echo "MINIO_ROOT_PASSWORD=$(generate_secret)"
    echo "S3_BUCKET=stewardpos"
    echo "STORAGE_ADAPTER=localstorage"
    echo
    echo "# Pin a released tag in production; 'local' builds from this checkout."
    echo "IMAGE_TAG=${IMAGE_TAG:-local}"
    echo
    echo "# Per-tenant resource ceilings. Lower them when packing many small"
    echo "# shops onto one host."
    echo "TENANT_BACKEND_CPUS=${TENANT_BACKEND_CPUS:-2}"
    echo "TENANT_BACKEND_MEMORY=${TENANT_BACKEND_MEMORY:-2G}"
    echo "TENANT_FRONTEND_CPUS=${TENANT_FRONTEND_CPUS:-1}"
    echo "TENANT_FRONTEND_MEMORY=${TENANT_FRONTEND_MEMORY:-512M}"
    echo
    echo "LOG_LEVEL=info"
    echo "EMAIL_ADAPTER=console"
  } >> "$env_file"

  ok "  wrote $env_file (chmod 600, 4 secrets generated)"

  cat > "$SITES_DIR/$slug.caddy" <<CADDY
# $slug - generated by scripts/tenant.sh. Edits here are lost on re-provision.
$domain {
	encode zstd gzip

	# Straight to this tenant's backend, not through its nginx: that keeps
	# exactly one proxy in front of Express, which is what TRUST_PROXY=1
	# means. Two would let a forged X-Forwarded-For past the rate limits.
	handle /api/* {
		reverse_proxy $slug-backend:3001
	}

	handle /uploads/* {
		reverse_proxy $slug-backend:3001
	}

	handle {
		reverse_proxy $slug-frontend:80
	}

	request_body {
		max_size 10MB
	}

	header {
		Strict-Transport-Security "max-age=63072000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		-Server
	}

	log {
		output stdout
		format console
	}
}
CADDY
  ok "  wrote $SITES_DIR/$slug.caddy"

  # `up -d` blocks until the backend is healthy, because the frontend declares
  # `depends_on: backend: condition: service_healthy`. That is what makes this a
  # real check rather than a hopeful one: the container's entrypoint runs the
  # migrations and refuses to start the server if they fail, so a stack that
  # comes up here has a schema matching its code.
  #
  # Deliberately NOT `npm run migrate`. That script is `tsx src/...`, and the
  # production image ships neither tsx (a devDependency) nor src/ - it migrates
  # with `node dist/services/migrator.js` from docker-entrypoint.sh. Calling the
  # npm script here would fail on every provision.
  info "Starting the stack (this migrates, and waits for health)"
  tc "$slug" up -d

  reload_edge

  echo
  ok "Tenant $slug is up at https://$domain"
  cat <<NEXT

  Next:
    1. Point $domain at this host. Caddy issues the certificate on the
       first request, and cannot before DNS resolves.
    2. Have them create the first administrator through the setup wizard at
       https://$domain/setup - there is no seeded account, on purpose, and
       AUTO_SEED is off because what it writes is an admin whose password is
       published in this repository.
    3. Back it up:  ./scripts/tenant.sh backup $slug

NEXT
}

# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------

cmd_list() {
  local slugs; slugs="$(list_slugs)"
  [ -n "$slugs" ] || { info "No tenants yet. Create one: $0 new <slug> <domain>"; return 0; }

  printf '%-16s %-32s %-10s %s\n' SLUG DOMAIN STATE CONTAINERS
  for slug in $slugs; do
    local domain state running total
    domain="$(grep -m1 '^TENANT_DOMAIN=' "$(tenant_env "$slug")" | cut -d= -f2-)"
    total="$(tc "$slug" ps --services 2>/dev/null | wc -l | tr -d ' ')"
    running="$(tc "$slug" ps --status running --services 2>/dev/null | wc -l | tr -d ' ')"
    if [ "$running" = "0" ]; then state="stopped"
    elif [ "$running" = "$total" ]; then state="up"
    else state="partial"; fi
    printf '%-16s %-32s %-10s %s/%s\n' "$slug" "$domain" "$state" "$running" "$total"
  done

  echo
  if edge_running; then ok "edge: running"; else warn "edge: NOT running - no tenant is reachable"; fi
}

# ---------------------------------------------------------------------------
# lifecycle
# ---------------------------------------------------------------------------

cmd_up()   { require_tenant "${1:-}"; tc "$1" up -d; reload_edge; ok "$1 up"; }
cmd_down() { require_tenant "${1:-}"; tc "$1" down;  ok "$1 stopped (volumes kept)"; }

cmd_exec() {
  local slug="${1:-}"; shift || true
  require_tenant "$slug"
  [ $# -gt 0 ] || die "Usage: $0 exec <slug> <command...>"
  tc "$slug" exec backend "$@"
}

cmd_upgrade() {
  local target="${1:-}"
  [ -n "$target" ] || die "Usage: $0 upgrade <slug>|--all"

  local slugs
  if [ "$target" = "--all" ]; then slugs="$(list_slugs)"; else require_tenant "$target"; slugs="$target"; fi

  for slug in $slugs; do
    info "Upgrading $slug"
    # Backup first, always. An upgrade that runs migrations is the single most
    # likely moment to want the previous state back.
    cmd_backup "$slug" >/dev/null
    ok "  backed up"
    tc "$slug" pull --quiet 2>/dev/null || true
    # Recreating the backend re-runs its entrypoint, which migrates and refuses
    # to serve on a schema mismatch. No separate migrate step, and no window in
    # which new code runs against an old schema.
    tc "$slug" up -d
    ok "  $slug upgraded"
  done
  reload_edge
}

# ---------------------------------------------------------------------------
# backup
# ---------------------------------------------------------------------------

cmd_backup() {
  local target="${1:-}"
  [ -n "$target" ] || die "Usage: $0 backup <slug>|--all"

  local slugs
  if [ "$target" = "--all" ]; then slugs="$(list_slugs)"; else require_tenant "$target"; slugs="$target"; fi

  local stamp; stamp="$(date -u +%Y%m%d-%H%M%SZ)"

  for slug in $slugs; do
    local dest="backups/$slug/$stamp"
    mkdir -p "$dest"

    # Three things, because any one alone is not a restore: the data, the files
    # that are not in the database, and the secrets without which neither can be
    # read. CREDENTIALS_KEY especially - a dump restored without it leaves the
    # customer's payment credentials permanently undecryptable.
    # From the tenant's env rather than hardcoded: POSTGRES_USER and
    # POSTGRES_DB are overridable per tenant, and a backup that silently dumps
    # the wrong database is worse than one that fails.
    local db_user db_name
    db_user="$(grep -m1 '^POSTGRES_USER=' "$(tenant_env "$slug")" | cut -d= -f2-)"
    db_name="$(grep -m1 '^POSTGRES_DB=' "$(tenant_env "$slug")" | cut -d= -f2-)"
    db_user="${db_user:-stewardpos_user}"
    db_name="${db_name:-stewardpos}"

    tc "$slug" exec -T postgres pg_dump -U "$db_user" "$db_name" | gzip > "$dest/database.sql.gz"
    tc "$slug" exec -T backend tar czf - -C /app uploads > "$dest/uploads.tar.gz" 2>/dev/null || true
    cp "$(tenant_env "$slug")" "$dest/env.txt"
    chmod 600 "$dest/env.txt"

    {
      echo "tenant:    $slug"
      echo "taken:     $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "image_tag: $(grep -m1 '^IMAGE_TAG=' "$(tenant_env "$slug")" | cut -d= -f2-)"
      echo "schema:    $(tc "$slug" exec -T postgres psql -U "$db_user" -d "$db_name" -tAc 'SELECT max(version) FROM schema_migrations' 2>/dev/null | tr -d '\r')"
      echo
      echo "env.txt holds this tenant's secrets. Restoring the dump without it"
      echo "signs out every user (JWT_SECRET) and leaves the saved payment"
      echo "credentials undecryptable (CREDENTIALS_KEY)."
    } > "$dest/MANIFEST"

    ok "$slug backed up to $dest"
  done
}

# ---------------------------------------------------------------------------
# rotate-jwt
# ---------------------------------------------------------------------------

cmd_rotate_jwt() {
  local slug="${1:-}"
  require_tenant "$slug"

  warn "Rotating JWT_SECRET signs out every user of $slug immediately,"
  warn "including any cashier mid-shift. Do it between shifts."
  printf 'Continue? [y/N] '
  read -r reply
  [ "$reply" = "y" ] || { info "Cancelled."; return 0; }

  local env_file; env_file="$(tenant_env "$slug")"
  cp "$env_file" "$env_file.bak.$(date -u +%Y%m%d-%H%M%SZ)"

  local new; new="$(generate_secret)"
  # A temp file plus mv, rather than sed -i: an interrupted in-place edit on the
  # only copy of a tenant's secrets is not a risk worth taking to save a line.
  local tmp; tmp="$(mktemp)"
  sed "s|^JWT_SECRET=.*|JWT_SECRET=$new|" "$env_file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$env_file"

  tc "$slug" up -d --force-recreate backend
  ok "$slug: JWT_SECRET rotated; everyone must sign in again."
}

# ---------------------------------------------------------------------------
# rm
# ---------------------------------------------------------------------------

cmd_rm() {
  local slug="${1:-}"
  require_tenant "$slug"

  warn "This deletes $slug's database, uploads and secrets. It is not reversible."
  printf "Type the slug to confirm: "
  read -r reply
  [ "$reply" = "$slug" ] || { info "Cancelled."; return 0; }

  # Unconditional final backup. Someone will run this against the wrong slug.
  info "Taking a final backup first"
  cmd_backup "$slug"

  tc "$slug" down -v
  rm -f "$SITES_DIR/$slug.caddy"
  rm -rf "$(tenant_dir "$slug")"
  reload_edge

  ok "$slug removed. Its final backup is under backups/$slug/."
}

# ---------------------------------------------------------------------------

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^#\{1,2\} \{0,1\}//'
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    new)        cmd_new "$@" ;;
    list|ls)    cmd_list "$@" ;;
    up)         cmd_up "$@" ;;
    down)       cmd_down "$@" ;;
    exec)       cmd_exec "$@" ;;
    upgrade)    cmd_upgrade "$@" ;;
    backup)     cmd_backup "$@" ;;
    rotate-jwt) cmd_rotate_jwt "$@" ;;
    rm|remove)  cmd_rm "$@" ;;
    ""|-h|--help|help) usage ;;
    *)          die "Unknown command: $cmd (try: $0 --help)" ;;
  esac
}

main "$@"
