# T-09 Sibling HTTP client and stub sibling

Tier: haiku (small helper from a full spec). Review: N. Branch: feat/T-09-stub-sibling

## Files
- New `backend/src/services/siblingClient.ts`: `callSibling({ url, token?, method, body, headers })` using `fetch` with `AbortSignal.timeout(3000)`; returns `{ ok: true, status, data }` or `{ ok: false, status?, error }`; never throws.
- New `backend/src/test/stubSibling.ts`: `startStub({ status, delayMs, body })` starts `http.createServer` on port 0, records requests, returns `{ url, requests, close() }`.

## Tests
`services/__tests__/siblingClient.test.ts` against the stub: 200 -> ok; 500 -> ok false with status; 4000 ms delay -> timeout error in under 3.5 s; refused port -> ok false.

Out of scope: anything that calls it.
