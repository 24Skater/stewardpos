import { describe, expect, it } from 'vitest';
import { mapOrderItemRow, mapOrderRow, mapPaymentRow, mapVariantRow } from '../PostgresAdapter';
import { centsToDollars, centsToDollarsOrNull, toCentsOrNull } from '../types';

/**
 * A representative `order_items` row as `pg` hands it back: snake_case columns,
 * and BIGINT cent values as strings rather than numbers.
 */
const itemRow = {
  id: 'item-1',
  order_id: 'order-1',
  product_id: 'prod-1',
  variant_id: 'var-1',
  name_snapshot: 'Apple Juice',
  size: null,
  color: null,
  quantity: 2,
  unit_price_cents: '150',
  line_discount_cents: '25',
  line_total_cents: '275',
  notes: null,
};

const orderRow = {
  id: 'order-1',
  created_at: '2026-08-06T05:20:48.502Z',
  subtotal_cents: '275',
  discount_total_cents: '25',
  tax_total_cents: '22',
  total_cents: '272',
  payment_method: 'Cash',
  customer_email: null,
  customer_phone: null,
  card_transaction_id: null,
  card_auth_code: null,
};

describe('mapOrderItemRow', () => {
  it('renames every snake_case column to the published camelCase field', () => {
    const mapped = mapOrderItemRow(itemRow);

    expect(Object.keys(mapped).sort()).toEqual([
      'color',
      'id',
      'lineDiscount',
      'lineTotal',
      'nameSnapshot',
      'notes',
      'orderId',
      'productId',
      'quantity',
      'size',
      'unitPrice',
      'variantId',
    ]);
  });

  it('leaks no snake_case keys', () => {
    expect(Object.keys(mapOrderItemRow(itemRow)).filter(key => key.includes('_'))).toEqual([]);
  });

  it('converts BIGINT cent strings into dollar numbers', () => {
    const mapped = mapOrderItemRow(itemRow);

    expect(mapped.unitPrice).toBe(1.5);
    expect(mapped.lineDiscount).toBe(0.25);
    expect(mapped.lineTotal).toBe(2.75);
  });
});

describe('mapOrderRow', () => {
  it('renames every snake_case column and parses the money fields', () => {
    const mapped = mapOrderRow(orderRow);

    expect(Object.keys(mapped).filter(key => key.includes('_'))).toEqual([]);
    expect(mapped.paymentMethod).toBe('Cash');
    expect(mapped.subtotal).toBe(2.75);
    expect(mapped.taxTotal).toBe(0.22);
  });

  it('converts created_at to epoch milliseconds', () => {
    expect(mapOrderRow(orderRow).createdAt).toBe(Date.parse('2026-08-06T05:20:48.502Z'));
  });

  it('carries the card fields so a create response matches a later read', () => {
    const mapped = mapOrderRow({ ...orderRow, card_transaction_id: 'ch_1', card_auth_code: 'A42' });

    expect(mapped.cardTransactionId).toBe('ch_1');
    expect(mapped.cardAuthCode).toBe('A42');
  });
});

describe('cents helpers and the other money mappers', () => {
  it('coerces BIGINT strings and keeps nulls', () => {
    expect(centsToDollars('1999')).toBe(19.99);
    expect(centsToDollars(null)).toBe(0);
    expect(centsToDollarsOrNull(undefined)).toBeNull();
    expect(centsToDollarsOrNull('5')).toBe(0.05);
    expect(toCentsOrNull(undefined)).toBeNull();
    expect(toCentsOrNull(0.1 + 0.2)).toBe(30);
    expect(toCentsOrNull('12.5')).toBe(1250);
  });

  it('maps a payment and a variant row from cents', () => {
    expect(
      mapPaymentRow({ id: 'p', order_id: 'o', method: 'cash', amount_cents: '370', created_at: '2026-01-01' }).amount
    ).toBe(3.7);
    const variant = mapVariantRow({ id: 'v', price_override_cents: '1250', price_delta_cents: null });
    expect(variant.priceOverride).toBe(12.5);
    expect(variant.priceDelta).toBeNull();
  });
});
