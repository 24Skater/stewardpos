import { describe, it, expect } from 'vitest';
import {
  repriceOrder,
  toCents,
  toDollars,
  variantPriceCents,
  type PriceableProduct,
} from '../pricing';

const TEA: PriceableProduct = {
  id: 'p-tea',
  name: 'Loose Leaf Tea',
  basePrice: 3.5,
  variants: [
    { id: 'v-small', priceDelta: 0, stock: 10, enabled: true },
    { id: 'v-large', size: 'Large', color: 'Green', priceDelta: 1.25, stock: 4, enabled: true },
    { id: 'v-tin', priceOverride: 12, priceDelta: 99, stock: 2, enabled: true },
    { id: 'v-retired', priceDelta: 0, stock: 50, enabled: false },
  ],
};

const catalog = new Map<string, PriceableProduct>([[TEA.id, TEA]]);
const noTax = { taxRate: 0 };

describe('cents conversion', () => {
  it('round-trips a dollar amount', () => {
    expect(toDollars(toCents(19.99))).toBe(19.99);
  });

  it('rounds rather than truncating', () => {
    expect(toCents(2.999)).toBe(300);
    expect(toCents(2.994)).toBe(299);
  });

  it('is exact for the two-decimal prices a catalog actually holds', () => {
    for (const dollars of [0.01, 0.99, 1, 3.5, 19.99, 1234.56]) {
      expect(toDollars(toCents(dollars))).toBe(dollars);
    }
  });
});

describe('variantPriceCents', () => {
  it('uses the base price when there is no variant', () => {
    expect(variantPriceCents(TEA)).toBe(350);
  });

  it('adds the delta', () => {
    expect(variantPriceCents(TEA, TEA.variants![1])).toBe(475);
  });

  it('lets an override replace the base price and ignore the delta', () => {
    expect(variantPriceCents(TEA, TEA.variants![2])).toBe(1200);
  });
});

describe('repriceOrder', () => {
  it('ignores the price the caller asked for', () => {
    // The whole point: a request claiming a penny gets the catalog's price.
    const priced = repriceOrder(
      [{ productId: 'p-tea', variantId: 'v-small', quantity: 1 }],
      catalog,
      noTax
    );

    expect(priced.items[0].unitPrice).toBe(3.5);
    expect(priced.total).toBe(3.5);
  });

  it('snapshots the name from the catalog, not the request', () => {
    const priced = repriceOrder([{ productId: 'p-tea', quantity: 1 }], catalog, noTax);

    expect(priced.items[0].nameSnapshot).toBe('Loose Leaf Tea');
  });

  it('carries the variant size and colour onto the line for the receipt', () => {
    const priced = repriceOrder(
      [{ productId: 'p-tea', variantId: 'v-large', quantity: 1 }],
      catalog,
      noTax
    );

    expect(priced.items[0].size).toBe('Large');
    expect(priced.items[0].color).toBe('Green');
  });

  it('multiplies by quantity', () => {
    const priced = repriceOrder(
      [{ productId: 'p-tea', variantId: 'v-large', quantity: 3 }],
      catalog,
      noTax
    );

    expect(priced.items[0].lineTotal).toBe(14.25);
    expect(priced.subtotal).toBe(14.25);
  });

  it('applies tax to the discounted subtotal', () => {
    const priced = repriceOrder([{ productId: 'p-tea', quantity: 2 }], catalog, {
      taxRate: 0.08,
      requestedDiscount: 1,
    });

    // 7.00 - 1.00 = 6.00 taxable, 8% = 0.48
    expect(priced.subtotal).toBe(7);
    expect(priced.discountTotal).toBe(1);
    expect(priced.taxTotal).toBe(0.48);
    expect(priced.total).toBe(6.48);
  });

  it('stays exact where floating-point dollars would drift', () => {
    // 3 x $0.10 at 10% is a case where naive float arithmetic lands on
    // 0.30000000000000004 and a cent goes missing in the rounding.
    const dime: PriceableProduct = { id: 'p-dime', name: 'Dime', basePrice: 0.1 };
    const priced = repriceOrder([{ productId: 'p-dime', quantity: 3 }], new Map([['p-dime', dime]]), {
      taxRate: 0.1,
    });

    expect(priced.subtotal).toBe(0.3);
    expect(priced.taxTotal).toBe(0.03);
    expect(priced.total).toBe(0.33);
  });

  it('never lets a discount take the total below zero', () => {
    const priced = repriceOrder([{ productId: 'p-tea', quantity: 1 }], catalog, {
      taxRate: 0,
      requestedDiscount: 1000,
    });

    expect(priced.discountTotal).toBe(3.5);
    expect(priced.total).toBe(0);
  });

  it('rejects an unknown product', () => {
    expect(() => repriceOrder([{ productId: 'nope', quantity: 1 }], catalog, noTax)).toThrow(
      /no longer available/
    );
  });

  it('rejects an unknown variant', () => {
    expect(() =>
      repriceOrder([{ productId: 'p-tea', variantId: 'nope', quantity: 1 }], catalog, noTax)
    ).toThrow(/no longer available/);
  });

  it('rejects a disabled variant', () => {
    expect(() =>
      repriceOrder([{ productId: 'p-tea', variantId: 'v-retired', quantity: 1 }], catalog, noTax)
    ).toThrow(/not for sale/);
  });

  it('refuses to oversell', () => {
    expect(() =>
      repriceOrder([{ productId: 'p-tea', variantId: 'v-tin', quantity: 3 }], catalog, noTax)
    ).toThrow(/Only 2 .* left in stock/);
  });

  it('sums duplicate lines for the same variant before checking stock', () => {
    // Two lines of 2 against a stock of 2: each passes alone, the pair must not.
    expect(() =>
      repriceOrder(
        [
          { productId: 'p-tea', variantId: 'v-tin', quantity: 2 },
          { productId: 'p-tea', variantId: 'v-tin', quantity: 2 },
        ],
        catalog,
        noTax
      )
    ).toThrow(/left in stock/);
  });

  it('rejects a fractional quantity', () => {
    expect(() =>
      repriceOrder([{ productId: 'p-tea', quantity: 1.5 }], catalog, noTax)
    ).toThrow(/whole number/);
  });

  it('rejects an empty order', () => {
    expect(() => repriceOrder([], catalog, noTax)).toThrow(/at least one item/);
  });
});
