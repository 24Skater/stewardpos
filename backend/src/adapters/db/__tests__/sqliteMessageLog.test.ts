import { expect, it } from 'vitest';
import { describeSqlite, useFreshSqlite } from './sqliteHarness';

describeSqlite('message log on SQLite', () => {
  const h = useFreshSqlite();

  it('writes one row per attempt and lists them newest first', async () => {
    await h.adapter.createMessageLog({ channel: 'email', template: 'receipt', recipient: 'a@example.com', status: 'sent', providerMessageId: 'm1' });
    await h.adapter.createMessageLog({ channel: 'email', template: 'test', recipient: 'b@example.com', status: 'failed', error: 'Email is off' });

    const rows = await h.adapter.getMessageLogs(10, 0);

    expect(rows.map((r) => [r.recipient, r.status, r.providerMessageId, r.error])).toEqual([
      ['b@example.com', 'failed', null, 'Email is off'],
      ['a@example.com', 'sent', 'm1', null],
    ]);
  });

  it('refuses a status outside the allowed set', async () => {
    await expect(
      h.adapter.createMessageLog({ channel: 'email', template: 'x', recipient: 'a@example.com', status: 'delivered' as 'sent' })
    ).rejects.toThrow();
  });
});
