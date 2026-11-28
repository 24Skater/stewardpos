import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMessageTemplates = vi.fn();
vi.mock('../database', () => ({ default: { getAdapter: () => ({ getMessageTemplates }) } }));

const { renderTemplate, renderParts, TEMPLATE_KEYS } = await import('../templates');

describe('templates', () => {
  beforeEach(() => {
    getMessageTemplates.mockReset();
    getMessageTemplates.mockResolvedValue([]);
  });

  it('escapes variable values in html but not in text', () => {
    const out = renderParts('email', 's', 'Hi {{name}}', { name: '<script>' });
    expect(out.html).toBe('Hi &lt;script&gt;');
    expect(out.text).toBe('Hi <script>');
  });

  it('renders unknown variables blank', () => {
    expect(renderParts('sms', '', 'a{{nope}}b', {}).text).toBe('ab');
  });

  it('gives sms no html', () => {
    expect(renderParts('sms', '', 'x', {}).html).toBeUndefined();
  });

  it('falls back to the built-in default when no row exists', async () => {
    const out = await renderTemplate('pickup_ready', 'email', { customerName: 'Ann', orderId: '7' });
    expect(out.enabled).toBe(true);
    expect(out.text).toContain('Hello Ann, order 7');
  });

  it('uses the stored row and reports a disabled one', async () => {
    getMessageTemplates.mockResolvedValue([
      { key: 'quote', channel: 'email', subject: 'S', body: 'B {{number}}', enabled: false },
    ]);
    const out = await renderTemplate('quote', 'email', { number: 'Q1' });
    expect(out).toMatchObject({ enabled: false, subject: 'S', text: 'B Q1' });
  });

  it('defines every required key', () => {
    expect(Object.keys(TEMPLATE_KEYS)).toEqual([
      'receipt', 'gift_card', 'invoice', 'quote', 'purchase_order', 'membership_reminder', 'pickup_ready',
    ]);
  });
});
