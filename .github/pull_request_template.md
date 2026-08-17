<!--
Keep this short. The useful parts are what changed and how you know it works.
-->

## What and why

<!-- What this does, and the problem it solves. If it fixes an issue: "Fixes #123". -->

## How it was verified

<!--
Not "should work" — what you actually ran, and what it said. Paste the output.

  backend:   npm run typecheck && npm run lint && npm test
  frontend:  npm run typecheck && npm run lint && npm test

Adapter SQL also needs `npm run test:integration` against a real Postgres.
-->

## Checks

- [ ] Tests cover the change, and a bug fix has a test that fails without it
- [ ] Typecheck, lint and tests pass locally
- [ ] Anything deliberately left undone is stated below, not left to be discovered

<!--
If this touches any of the following, say so — they get read more carefully:

  · money         totals, tax, discounts, change, refunds, reports
  · auth / RBAC   who can reach what
  · migrations    forward-only, and both postgres/ and sqlite/
  · deployment    compose files, the entrypoint, secrets

Two standing rules, both of which this project has been bitten by:
  · The client is never believed — about money or about names. The server
    reprices, and it does not store a filename a caller supplied.
  · A feature is not done because it compiles. Several here looked live and
    were inert end to end.
-->

## Deliberately not done

<!-- Optional, and better here than discovered later. -->
