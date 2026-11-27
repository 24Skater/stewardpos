# User accounts

Staff accounts are managed under **Admin → Roles & Users → Users**. A user is a
person who signs in to the admin screens; the till itself is unlocked with a
cashier PIN (see [register-management.md](./register-management.md)).

## Adding and managing users

- **Add User** takes a name, email, starting password and one or more roles.
  The password must pass the same policy the sign-in screen enforces.
- **Edit** changes name, email, roles or password (leave the password blank to
  keep it), and whether the person may approve manager overrides at the till.
- **Deactivate** stops a user signing in from their next request onward. Their
  sales, shifts and audit history stay attached to them; **Reactivate** undoes it.
- New users appear in **Cashier PINs** below, where they can be given a PIN.

### Lockout protection

The server refuses any change that would leave the store with nobody able to
administer it (`backend/src/services/adminLockout.ts`):

- you cannot deactivate, delete, or remove the admin role from your own account;
- nobody can deactivate, delete or demote the last active admin.

## Google sign-in and OIDC (planned)

Not built yet. This is how it is meant to fit, so that today's accounts carry
over unchanged.

**Google is one OIDC provider.** Sign-in is implemented once against OpenID
Connect (issuer `https://accounts.google.com` for Google; Microsoft Entra,
Okta, Authentik, Keycloak and the rest by issuer URL). There is no separate
Google integration to maintain.

**The user record stays the account.** SSO is another way of proving you are a
user that already exists, not a second kind of account. Roles, status, PIN and
override approval all stay on the user, whichever way they sign in.

**Invite-only by default.** An admin adds the person on the Users screen first,
as today. On their first SSO sign-in, the provider's *verified* email
(`email_verified: true`) is matched to an **active** user and the identity is
linked. An unknown email is refused, not auto-created. Automatic creation (for
example "anyone at `@yourshop.com` joins as Cashier") can be offered later as an
explicit, off-by-default setting.

**Linked by issuer and subject, not email.** The link stores the provider's
`iss` + `sub`, which never change; after the first sign-in the email is not used
to match again. That way a renamed mailbox does not break sign-in, and a reused
address cannot inherit someone else's account.

**Roles stay in StewardPOS.** The provider says who someone is; StewardPOS
decides what they can do. Mapping identity-provider groups to roles is a
possible later addition, not the starting point.

**What changes, concretely:**

| Piece | Change |
|---|---|
| `users.password_hash` | Becomes nullable, so a user can be SSO-only |
| `user_identities` (new) | `user_id`, `issuer`, `subject`, `linked_at`; unique on (`issuer`, `subject`) |
| Configuration | Issuer URL and client ID in settings; the client secret in the environment, never the database |
| Routes | `/api/auth/oidc/start` and `/callback` (authorization code + PKCE, `state` and `nonce` checked) issuing the same session as password sign-in |
| Users screen | A sign-in method per user (password, SSO, or both), "linked" status, and an unlink action |
| Sign-in screen | "Continue with Google" / "Sign in with SSO" beside the password form |

**What stays the same:** deactivation (checked on every request, so it applies
to SSO users too); till PINs (cashiers do not SSO into a register); audit
attribution. Password policy and password lockout apply only to password
sign-in; MFA for SSO users is the provider's job.

**Keep a way back in.** If the provider is misconfigured or down, SSO-only
admins cannot sign in. Keep at least one admin with a password. When SSO lands,
the lockout rule above should count only admins who can still sign in.
