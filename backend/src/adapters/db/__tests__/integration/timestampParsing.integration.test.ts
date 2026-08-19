import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connect, type Harness } from './harness';

/**
 * Instants must survive a round trip through a bare `TIMESTAMP` column.
 *
 * `TIMESTAMP WITHOUT TIME ZONE` carries no offset, and node-postgres uses the
 * *process* timezone on both sides: it serialises a JS Date into one using
 * local components, and parses one back the same way. The two shifts cancel, so
 * a round trip is correct on any host — which is why nothing had ever caught
 * this.
 *
 * What does not cancel is a client-written value meeting one Postgres computed
 * itself (`NOW()`, `EXTRACT`); those disagree by the host's offset, and that is
 * how a register's hourly sales landed four hours out on a development machine
 * here. Deployment pins `TZ=UTC` so the question cannot arise; these tests hold
 * the properties that pinning is supposed to guarantee.
 */

let h: Harness;

beforeAll(async () => {
  h = await connect();
}, 30_000);

afterAll(async () => {
  await h.close();
});

describe('TIMESTAMP round trips', () => {
  it('returns the same instant that was written', async () => {
    const instant = Date.UTC(2026, 0, 2, 23, 45, 12);

    const { rows } = await h.query('SELECT $1::timestamp AS t', [new Date(instant)]);

    expect((rows[0].t as Date).getTime()).toBe(instant);
  });

  it('agrees with a value Postgres computed for itself', async () => {
    // The comparison that does NOT survive a non-UTC process: a client-written
    // timestamp against a server-computed one. Under TZ=UTC they match; under a
    // shifted clock they differ by the offset.
    const { rows } = await h.query(
      "SELECT EXTRACT(EPOCH FROM '2026-08-19 10:00:00'::timestamp) * 1000 AS server_ms, " +
        "'2026-08-19 10:00:00'::timestamp AS client_date"
    );

    const serverMs = Number(rows[0].server_ms);
    const clientMs = (rows[0].client_date as Date).getTime();

    expect(clientMs).toBe(serverMs);
  });

  it('still parses a timestamptz, which carries its own offset', async () => {
    const { rows } = await h.query("SELECT '2026-08-19 10:00:00+00'::timestamptz AS t");

    expect((rows[0].t as Date).getTime()).toBe(Date.UTC(2026, 7, 19, 10, 0, 0));
  });

  it('leaves a null timestamp null rather than an epoch date', async () => {
    const { rows } = await h.query('SELECT NULL::timestamp AS t');

    expect(rows[0].t).toBeNull();
  });
});
