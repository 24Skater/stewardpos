# Security Policy

## Supported Versions

StewardPOS has not yet cut a `1.0.0` release. Until it does, the supported
version is **whatever is currently on `main`** — fixes land there and operators
take them with `git pull` (see [docs/guides/upgrade.md](docs/guides/upgrade.md)).

Once `1.0.0` is tagged this becomes:

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes |
| < 1.0   | No |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please follow these steps:

### 1. **DO NOT** Open a Public Issue

Security vulnerabilities should not be reported through public GitHub issues to avoid exploitation before a fix is available.

### 2. Report Privately

Use **[GitHub's private security advisories](https://github.com/24Skater/stewardpos/security/advisories/new)**.

That is deliberately the only channel. There is no `security@` mailbox, and
publishing an address nobody reads is worse than publishing none — a reporter who
emails it and hears nothing reasonably concludes the project does not care, and
may disclose publicly instead. The GitHub channel is private, notifies the
maintainers, and exists today.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### 3. What to Expect

- **Acknowledgment**: within a week
- **Assessment**: as soon as we can get to it, and we will tell you what we think
- **Status updates**: when there is something to report, rather than on a timer
- **Fix**: critical issues are prioritised over everything else
- **Public disclosure**: after a fix is released (coordinated disclosure)

These are deliberately modest, because StewardPOS is maintained by very few
people in their own time. This file used to promise acknowledgment within 48
hours and critical fixes within 7 days. Those are commitments a project this
size cannot reliably keep, and a security policy that is quietly broken is worse
than one that is modest and honoured.

### 4. Coordinated Disclosure

We believe in coordinated disclosure:
- We'll work with you to understand and fix the issue
- We'll credit you in the release notes (unless you prefer to remain anonymous)
- We'll notify you before public disclosure
- We ask for 90 days before public disclosure to allow users to update

## Security Best Practices

### For Users

#### 1. **Secrets Management**

**✅ DO:**
- Use environment variables for all secrets
- Use `.env.local` for local development (gitignored)
- Rotate credentials regularly
- Use strong, unique passwords
- Enable 2FA on all accounts

**❌ DON'T:**
- Commit secrets to Git
- Share credentials in plain text
- Reuse passwords across services
- Use default/weak passwords

#### 2. **Database Security**

**For Production:**
- Use strong database passwords
- Restrict database access by IP
- Enable SSL/TLS connections
- Use read-only users where possible
- Regularly backup data
- Keep database software updated

**PostgreSQL Example:**
```sql
-- Create app user with limited permissions
CREATE USER pos_app WITH PASSWORD 'strong_password';
GRANT CONNECT ON DATABASE stewardpos TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;

-- Don't grant DROP, CREATE, or ALTER permissions
```

#### 3. **Authentication Security**

- Use HTTPS in production (never HTTP)
- Enable CORS only for trusted origins
- Set appropriate session timeouts
- Implement rate limiting on auth endpoints
- Use secure, httpOnly cookies for sessions
- Hash passwords with bcrypt (cost factor ≥ 10)

#### 4. **API Security**

- Validate all input
- Sanitize output to prevent XSS
- Use parameterized queries to prevent SQL injection
- Implement proper RBAC (Role-Based Access Control)
- Log security events
- Monitor for suspicious activity

#### 5. **Deployment Security**

**Environment Variables:**
```bash
# Production checklist
VITE_APP_ENV=production
VITE_DB_PASSWORD=<strong-unique-password>
VITE_AUTH_CLIENT_SECRET=<never-commit-this>
VITE_EMAIL_PASSWORD=<app-specific-password>
# etc.
```

**Never expose:**
- Database credentials
- API keys
- Auth secrets
- Storage credentials
- Internal endpoints

### For Contributors

#### 1. **Code Review**

All code changes require review before merge:
- Check for hardcoded secrets
- Verify input validation
- Review authorization logic
- Check for SQL injection vulnerabilities
- Review dependency updates

#### 2. **Dependencies**

- Keep dependencies updated
- Review dependency security advisories
- Use `npm audit` regularly
- Pin dependency versions in production
- Minimize dependency count

```bash
# Check for vulnerabilities
npm audit

# Auto-fix non-breaking issues
npm audit fix

# Review and fix breaking issues
npm audit fix --force
```

#### 3. **Secure Coding Guidelines**

**Input Validation:**
```typescript
// ✅ Good - validate and sanitize
import { z } from 'zod';

const schema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(100),
});

const result = schema.parse(input);
```

```typescript
// ❌ Bad - no validation
const user = await db.createUser({
  email: req.body.email,  // Could be anything!
  password: req.body.password
});
```

**SQL Injection Prevention:**
```typescript
// ✅ Good - parameterized query
const user = await db.query(
  'SELECT * FROM users WHERE email = $1',
  [email]
);
```

```typescript
// ❌ Bad - string concatenation
const user = await db.query(
  `SELECT * FROM users WHERE email = '${email}'`
);
```

**XSS Prevention:**
```typescript
// ✅ Good - React auto-escapes
<div>{user.name}</div>

// ❌ Bad - dangerous
<div dangerouslySetInnerHTML={{ __html: user.bio }} />

// ✅ OK if sanitized first
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ 
  __html: DOMPurify.sanitize(user.bio) 
}} />
```

**Authorization:**
```typescript
// ✅ Good - check permissions
if (!hasPermission(session, 'users', 'delete')) {
  throw new Error('Unauthorized');
}
await deleteUser(userId);
```

```typescript
// ❌ Bad - no auth check
await deleteUser(userId);
```

## Known Security Considerations

Deliberate trade-offs, with the reasoning. Each is a decision, not an oversight
— if you disagree with one, the reasoning is what to argue with.

### 1. Session tokens live in `localStorage`, not an httpOnly cookie

`POST /api/auth/login` returns a JWT that the browser stores in `localStorage`
and sends as `Authorization: Bearer`. The textbook advice is an httpOnly cookie,
because script cannot read one.

**Why it is this way.** Three of the four ways to authenticate against this API
are not browsers: an `X-Api-Key` for integrations, an `X-Register-Token` for a
paired terminal device, and an `X-Override-Token` for a supervisor approval.
A header-based scheme is one authentication path for all of them. Cookies would
add a second, browser-only path alongside — and with it CSRF, which a Bearer
header does not have, because the browser never attaches one automatically.
There is no CSRF token anywhere in this codebase and none is needed; that is a
consequence of this decision, not an omission.

**What it costs.** An XSS bug becomes a session-theft bug. The mitigations are
that there is no XSS surface to speak of — zero uses of
`dangerouslySetInnerHTML` or `innerHTML` in the frontend, React escaping
everywhere else, no SVG uploads — and that `script-src 'self'` with no
`'unsafe-inline'` means injected script does not run even if markup gets
through. See `nginx.conf`, and `src/test/__tests__/csp.test.ts`, which fails the
build if that guarantee is weakened.

**When to revisit.** If this app ever renders user-authored rich text, the
trade-off changes and cookies become worth their cost.

### 2. There is no database-level Row Level Security

`org_id` exists on the tenant-scoped tables (migration `014_org_tenancy`) but is
nullable and is not filtered on. Access control is entirely in the application:
`authenticate` → `requirePermission` → the route.

**Why it is this way.** Every install today is a single organisation, and every
existing row has `org_id IS NULL`. Attaching a policy such as
`USING (org_id = current_setting('app.org_id')::uuid)` to that state makes every
row in the database invisible at once, because `NULL = anything` is `NULL`. RLS
on a single-tenant install is also unverifiable: the correct implementation and
the broken one return identical results until a second organisation exists.

**What it costs.** A SQL-injection bug or a route that forgets its permission
check has nothing behind it to catch the mistake. The compensating control is
that the query layer takes no interpolated user input at all — every value in
both adapters is a bound parameter, and every column name is a literal in the
source.

**The order it has to happen in**, whenever a second tenant arrives:
backfill `org_id` on every row → make the column `NOT NULL` → scope the queries
and test them against two organisations → *then* add RLS as defence in depth.
Doing RLS first breaks the install. See `docs/guides/multi-tenant.md`.

### 3. Brute-force protection is rate limiting, not bot detection

There is no CAPTCHA and no proof-of-work. What there is: five separate
`express-rate-limit` budgets — global, sign-in, device pairing, PIN shift
start, and supervisor override — with `skipSuccessfulRequests` on the four
credential-checking ones, so normal use never spends the budget and only
failures do.

**Why it is this way.** The endpoints an attacker can reach are a staff sign-in
form, a PIN keypad, and a device-pairing code. All three are used by people
standing at a till during a shift change, on a touchscreen, sometimes in a
hurry. A CAPTCHA there fails closed against the staff and open against anyone
willing to pay a solving service.

**What it costs.** An attacker with many source addresses gets more attempts
than one address would, since the limits key on IP. Mitigations: PINs lock the
account after repeated failures (`pin_locked_until`), and sign-in is
timing-equalised so that failures reveal nothing about which addresses exist
(`burnPasswordComparison` in `api/routes/auth.ts`).

**Set `TRUST_PROXY` correctly or none of this works.** It defaults to `0`. Behind
a proxy without it, every request appears to come from the proxy and the whole
internet shares one bucket. Set too high, a forged `X-Forwarded-For` walks past
the limits entirely. It must equal the number of proxies you actually run — `1`
for the shipped `docker-compose.prod.yml`.

### 4. Payment credential encryption is opt-in

`CREDENTIALS_KEY` enables AES-256-GCM encryption of the Stripe/Square
credentials held in `settings.config.terminalCredentials`. Without it they are
stored in clear text and the server logs a warning at startup.

**Why it is opt-in.** Making it mandatory would refuse to boot every existing
install on upgrade, over a condition they have had since the day they were set
up. Taking a working shop offline is a worse outcome than the one being
prevented.

**Set it.** On a self-hosted install this is your own key in your own database.
On a VPS run on someone else's behalf it is *their* live key in *your*
database, and one leaked backup is full payment-account takeover. See
`backend/src/services/credentialCrypto.ts`.

### 5. Uploads are validated structurally, not scanned

`POST /api/upload/:type` accepts PNG, JPEG, GIF, WebP and ICO. It checks the
declared MIME type against an allowlist, checks the leading bytes against that
type's magic number (`api/routes/imageSignature.ts`), caps the size at 5MB,
names the file from a UUID, and chooses the extension itself — nothing the
caller supplies reaches the store. SVG is refused outright: it is a document
format that can carry script.

**What it does not do.** It does not decode the image or scan for malware, so a
structurally-valid but malicious file for some downstream decoder would pass.
If you process uploads with anything beyond serving them back, add a scanner.

### 6. CORS is an allowlist, and it has to be set

`CORS_ORIGIN` is a comma-separated list of exact origins; anything else is
refused without headers (see `app.ts`). It defaults to `http://localhost:8080`,
which is wrong for every real deployment. Requests with no `Origin` header at
all — curl, native apps, server-to-server — are allowed through, because CORS
is a browser mechanism and blocking them would protect nobody; those callers are
gated by `authenticate` instead.

## Security Checklist for Production

- [ ] All secrets in environment variables
- [ ] HTTPS enabled (valid certificate)
- [ ] Database passwords are strong and unique
- [ ] Database access restricted by IP/VPC
- [ ] CORS configured for specific origins
- [ ] Rate limiting enabled on auth endpoints
- [ ] Session timeout configured
- [ ] File upload validation implemented
- [ ] Input validation on all forms
- [ ] Error messages don't leak sensitive info
- [ ] Logging captures security events
- [ ] Regular backups configured
- [ ] Dependencies updated and audited
- [ ] Security headers configured (CSP, HSTS, etc.)
- [ ] `TRUST_PROXY` equals the number of proxies in front of the API (`1` for the bundled Caddy stack) — rate limiting is inert or bypassable if this is wrong
- [ ] `CREDENTIALS_KEY` set, so payment credentials are encrypted at rest
- [ ] `JWT_SECRET` generated for this install, not copied from anywhere — see [secret rotation](docs/guides/secret-rotation.md)

## Security Headers

You do not need to configure these by hand: `nginx-security-headers.conf` (the
frontend image) and `Caddyfile` (the production reverse proxy) both ship them,
and `src/test/__tests__/csp.test.ts` fails the build if the policy drifts from
the page it protects.

> **If you have forked or customised `nginx.conf`, check this.** nginx inherits
> `add_header` from an outer block *only when the inner block declares none of
> its own*. A single `add_header Cache-Control ...` inside a `location` silently
> discards every security header for that location — no warning, no error, and
> the directives still sitting correctly in the `server` block above. This
> repository had exactly that: `location = /index.html` set three cache headers,
> `location /`'s `try_files` rewrites every route into it, and so the document
> that boots the application was served with **no** CSP, HSTS, nosniff or frame
> protection. Confirm with `curl -I`, never by reading the config.

What is sent, and why each one is there:

| Header | Value | What it stops |
|---|---|---|
| `Content-Security-Policy` | `script-src 'self'`, no `'unsafe-inline'` | Injected `<script>` running at all |
| | `frame-ancestors 'none'` | Clickjacking, including where `X-Frame-Options` is ignored |
| | `object-src 'none'` | Plugin-based script execution |
| | `base-uri 'self'` | A `<base>` tag rewriting every relative URL on the page |
| | `form-action 'self'` | An injected form posting credentials elsewhere |
| `Strict-Transport-Security` | `max-age` 1–2 years, `includeSubDomains` | Downgrade to plaintext after the first visit |
| `X-Content-Type-Options` | `nosniff` | A file being executed as a type other than its `Content-Type` |
| `X-Frame-Options` | `DENY` | Clickjacking on older browsers |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Leaking full URLs to third parties |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Silent access to hardware a POS never needs |

`style-src` keeps `'unsafe-inline'`, and that is not an oversight: React and
Radix set `style=` on the elements they position, and a static file server has
no nonce to hand them. `script-src` is where the value of a CSP actually is,
and it is strict.

If you terminate TLS somewhere other than the bundled Caddy, replicate the
`header` block from `Caddyfile` there — and make sure `TRUST_PROXY` still equals
the number of proxies in front of Express, or rate limiting silently stops
working.

## Incident Response

If a security incident occurs:

1. **Isolate**: Take affected systems offline if needed
2. **Assess**: Determine scope and impact
3. **Contain**: Prevent further damage
4. **Remediate**: Fix vulnerability
5. **Notify**: Inform affected users
6. **Review**: Conduct post-mortem
7. **Improve**: Update security practices

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [React Security Best Practices](https://react.dev/learn/security)

## Contact

- **Report a vulnerability**: [private security advisory](https://github.com/24Skater/stewardpos/security/advisories/new)
- **Everything else**: [open an issue](https://github.com/24Skater/stewardpos/issues)

---

Thank you for helping keep StewardPOS secure! 🔒
