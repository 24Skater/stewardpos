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

### 1. **Browser-Based Storage (IndexedDB/LocalStorage)**

Default setup uses browser storage, which:
- ✅ Works offline
- ✅ No backend required
- ❌ Accessible to all browser scripts
- ❌ Not encrypted by default
- ❌ Limited to single device

**Recommendation**: Use server-based database (Postgres) for sensitive data.

### 2. **Local Auth Adapter**

Built-in auth uses bcrypt + sessions:
- ✅ No external dependencies
- ✅ Passwords properly hashed
- ❌ Sessions stored in sessionStorage (browser)
- ❌ No automatic session refresh
- ❌ No 2FA support (yet)

**Recommendation**: Use OIDC provider (Azure AD, Okta) for enterprise deployments.

### 3. **File Upload Security**

When using storage adapters:
- Validate file types
- Limit file sizes
- Scan for malware (if applicable)
- Use signed URLs for downloads
- Implement access controls

### 4. **CORS Configuration**

Configure CORS appropriately:
```typescript
// Production - restrict origins
const allowedOrigins = ['https://yourapp.com'];

// Development - localhost only
const allowedOrigins = ['http://localhost:5173'];
```

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

## Security Headers

Configure these headers in your web server:

```nginx
# Nginx example
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'";
add_header X-Frame-Options "DENY";
add_header X-Content-Type-Options "nosniff";
add_header Referrer-Policy "strict-origin-when-cross-origin";
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
```

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
