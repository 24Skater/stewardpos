import { expect, it } from 'vitest';
import { describeSqlite, useFreshSqlite } from './sqliteHarness';

describeSqlite('SMS consent on SQLite', () => {
  const h = useFreshSqlite();

  it('is null until recorded, then follows the latest status', async () => {
    expect(await h.adapter.getSmsConsent('5551234567')).toBeNull();

    await h.adapter.setSmsConsent('5551234567', 'opted_in', 'customer_form');
    expect(await h.adapter.getSmsConsent('5551234567')).toBe('opted_in');

    await h.adapter.setSmsConsent('5551234567', 'opted_out', 'twilio_stop');
    expect(await h.adapter.getSmsConsent('5551234567')).toBe('opted_out');
    expect(await h.adapter.listSmsConsent()).toEqual([{ phone: '5551234567', status: 'opted_out' }]);
  });
});
