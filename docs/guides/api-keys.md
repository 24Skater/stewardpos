# API keys

StewardPOS can be driven by a machine as well as by a person. An API key
authenticates a script, an integration, or a scheduled job without giving it a
staff login.

Manage keys in **Admin → API Keys**, or through `/api/admin/api-keys`.

---

## Authenticating

Send the key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: spk_1a2b3c4d_<secret>" https://your-store.example/api/products
```

**Not `Authorization: Bearer`.** That header carries a signed-in user's session
token; a key sent that way is rejected as a malformed JWT, which surfaces as a
plain `401` with nothing pointing at the header.

A key that is present but wrong is refused outright. The request does not fall
back to anonymous access — a typo in a key should fail as a bad key, not
reappear as a confusing error somewhere further in.

## What a key can do

Keys carry **scopes**, not roles:

| Scope    | Grants |
|----------|--------|
| `read`   | Read products, orders, customers, quotes, services, reports |
| `write`  | Create and update those resources (implies `read`) |
| `delete` | Delete them |
| `admin`  | Everything a scope can grant |

A key created without an explicit scope gets `read` only. That is deliberate:
the least useful default is the safest one, and widening a key later is a
smaller problem than discovering an integration could delete the catalog.

### Keys cannot manage keys

Even an `admin`-scoped key is refused on `/api/admin/api-keys`. A leaked key can
do damage bounded by its scopes; a key that can mint keys can grant itself wider
scopes, issue successors, and revoke the ones an operator would use to shut it
down. Key management requires a signed-in administrator.

## How keys are stored

A key looks like `spk_<8 hex>_<64 hex>`:

- The **prefix** (`spk_1a2b3c4d`) is stored in the clear and indexed, so a key
  can be found, listed and identified without being known.
- The **whole key** is stored only as a bcrypt hash. The plaintext is returned
  **once**, in the response that creates it, and never again — not by the list
  endpoint, not by the detail endpoint, and not in the database.

If a key is lost, it cannot be recovered. Revoke it and issue another.

## Expiry and revocation

- `expiresAt` (epoch milliseconds) is optional. An expired key is refused from
  the moment it lapses; nothing has to run to enforce it.
- Deleting a key revokes it immediately. There is no grace period.
- Every accepted request stamps the key's `lastUsedAt`, so an unused key is
  visible as one and can be retired.

## Rate limits

Rate limiting is applied **per client address** across all of `/api`, and is
shared with any session traffic from the same address — it is not a per-key
budget. Size retries accordingly: several integrations behind one NAT share a
bucket. The window and ceiling come from `RATE_LIMIT_WINDOW_MS` and
`RATE_LIMIT_MAX_REQUESTS`; see the deployment guide.

Responses carry the standard `RateLimit-*` headers.

## Endpoint reference

`GET /api/admin/api-keys/docs/reference` returns the machine-readable list of
endpoints with the scope each one needs. The **Admin → API Keys** screen renders
the same document.

## If a key leaks

1. Delete it in **Admin → API Keys**. It stops working on the next request.
2. Issue a replacement and deploy it to the integration.
3. Check **Admin → Audit Log**, filtered to the period in question, for writes
   you do not recognise.

Nothing else needs rotating: keys are independent of each other and of the JWT
signing secret.
