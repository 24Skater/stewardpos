import { expect, it } from 'vitest';
import { describeSqlite, useFreshSqlite } from './sqliteHarness';

describeSqlite('message templates on SQLite', () => {
  const h = useFreshSqlite();

  it('upserts one row per key and channel', async () => {
    await h.adapter.upsertMessageTemplate({ key: 'receipt', channel: 'email', subject: 'A', body: 'one', enabled: true });
    await h.adapter.upsertMessageTemplate({ key: 'receipt', channel: 'email', subject: 'B', body: 'two', enabled: false });

    const rows = await h.adapter.getMessageTemplates();

    expect(rows).toEqual([{ key: 'receipt', channel: 'email', subject: 'B', body: 'two', enabled: false }]);
  });
});
