import { describe, expect, it } from 'vitest';
import type { CartItem, Order, OrderItem, StoreCredit } from '@/lib/api';
import {
  amountDueAfterCredit,
  buildPayments,
  calculateDiscountAmount,
  calculateSubtotal,
  calculateTotals,
  changeDueFor,
  creditAppliedTo,
  getTotalDiscount,
  quickCashOptionsFor,
  receiptLinesFrom,
  toDiscountRequests,
  type AppliedDiscount,
} from '../register-math';

function line(price: number, quantity = 1, id = 'p1'): CartItem {
  return { productId: id, variantId: `${id}-v1`, quantity, price };
}

function discount(over: Partial<AppliedDiscount> = {}): AppliedDiscount {
  return {
    source: 'quick_discount',
    name: 'Staff',
    type: 'percentage',
    value: 10,
    amount: 0,
    ...over,
  };
}

function credit(remainingAmount: number, code = 'SC-1'): StoreCredit {
  return {
    id: 'sc1',
    code,
    originalAmount: remainingAmount,
    remainingAmount,
    status: 'active',
    createdAt: 0,
  } as StoreCredit;
}

describe('calculateSubtotal', () => {
  it('is zero for an empty cart', () => {
    expect(calculateSubtotal([])).toBe(0);
  });

  it('multiplies each line by its quantity', () => {
    expect(calculateSubtotal([line(9.99, 3), line(0.5, 2)])).toBeCloseTo(30.97, 10);
  });
});

describe('calculateDiscountAmount', () => {
  it('takes a percentage of the base', () => {
    expect(calculateDiscountAmount(discount({ type: 'percentage', value: 25 }), 80)).toBe(20);
  });

  it('caps a fixed discount at the base so the total cannot go negative', () => {
    // A $20 coupon against a $12 sale takes $12, not $20.
    expect(calculateDiscountAmount(discount({ type: 'fixed', value: 20 }), 12)).toBe(12);
  });
});

describe('getTotalDiscount', () => {
  it('is zero when nothing is applied', () => {
    expect(getTotalDiscount([line(50)], [])).toBe(0);
  });

  it('stacks each discount against what the one before it left', () => {
    // Two 50% discounts take 75% of the sale, not all of it.
    const cart = [line(100)];
    const half = discount({ type: 'percentage', value: 50 });

    expect(getTotalDiscount(cart, [half, half])).toBe(75);
  });

  it('applies a fixed discount to the already-reduced remainder', () => {
    const cart = [line(100)];
    const tenPercent = discount({ type: 'percentage', value: 10 });
    const fixed = discount({ type: 'fixed', value: 95 });

    // 10 off first, then the $95 coupon capped at the remaining $90.
    expect(getTotalDiscount(cart, [tenPercent, fixed])).toBe(100);
  });
});

describe('calculateTotals', () => {
  it('taxes the discounted amount, not the gross subtotal', () => {
    const totals = calculateTotals([line(100)], [discount({ value: 10 })], 0.1);

    expect(totals.subtotal).toBe(100);
    expect(totals.discountTotal).toBe(10);
    expect(totals.taxTotal).toBeCloseTo(9, 10); // (100 - 10) * 0.1, not 100 * 0.1
    expect(totals.total).toBeCloseTo(99, 10);
  });

  it('charges no tax when the store rate is zero', () => {
    const totals = calculateTotals([line(25, 2)], [], 0);

    expect(totals.taxTotal).toBe(0);
    expect(totals.total).toBe(50);
  });

  it('is all zeroes for an empty cart', () => {
    expect(calculateTotals([], [], 0.08)).toEqual({
      subtotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      total: 0,
    });
  });
});

describe('creditAppliedTo', () => {
  it('spends nothing when no credit is attached', () => {
    expect(creditAppliedTo(40, null)).toBe(0);
    expect(creditAppliedTo(40, undefined)).toBe(0);
  });

  it('spends the whole credit when the sale is larger', () => {
    expect(creditAppliedTo(40, credit(15))).toBe(15);
  });

  it('spends only the total when the credit is larger, leaving the rest on the card', () => {
    // $50 credit against a $12 sale spends $12 — the remainder stays on the
    // credit rather than coming back as cash.
    expect(creditAppliedTo(12, credit(50))).toBe(12);
  });
});

describe('amountDueAfterCredit', () => {
  it('is the total less what the credit covered', () => {
    expect(amountDueAfterCredit(40, 15)).toBe(25);
  });

  it('is zero when the credit covers the sale exactly', () => {
    expect(amountDueAfterCredit(12, 12)).toBe(0);
  });

  it('rounds to cents rather than leaving float dust', () => {
    // 19.99 - 0.1 - 0.2 in float is 19.689999999999998.
    expect(amountDueAfterCredit(19.99, 0.1 + 0.2)).toBe(19.69);
  });
});

describe('buildPayments', () => {
  it('sends no breakdown when there is no credit to split against', () => {
    expect(buildPayments('Cash', null, 0, 50)).toBeUndefined();
  });

  it('sends no breakdown when a credit is attached but covers nothing', () => {
    expect(buildPayments('Cash', credit(0), 0, 50)).toBeUndefined();
  });

  it('records the credit alone when it covers the whole sale', () => {
    expect(buildPayments('Cash', credit(12), 12, 0)).toEqual([
      { method: 'store_credit', amount: 12, reference: 'SC-1' },
    ]);
  });

  it('splits the remainder onto the chosen tender', () => {
    expect(buildPayments('Card', credit(10), 10, 25)).toEqual([
      { method: 'store_credit', amount: 10, reference: 'SC-1' },
      { method: 'card', amount: 25 },
    ]);
  });

  it.each([
    ['Card', 'card'],
    ['card', 'card'],
    ['Zelle', 'zelle'],
    ['ZELLE', 'zelle'],
    ['Cash', 'cash'],
    ['Anything else', 'cash'],
  ])('maps the %s button to the %s tender', (label, method) => {
    const payments = buildPayments(label, credit(5), 5, 10);

    expect(payments?.[1]).toEqual({ method, amount: 10 });
  });
});

describe('changeDueFor', () => {
  it('shows nothing before an amount is typed', () => {
    expect(changeDueFor('', 20)).toBeNull();
  });

  it('shows nothing for an unparseable entry', () => {
    expect(changeDueFor('abc', 20)).toBeNull();
  });

  it('shows nothing when the tender falls short', () => {
    expect(changeDueFor('19.99', 20)).toBeNull();
  });

  it('gives zero on exact tender', () => {
    expect(changeDueFor('20', 20)).toBe(0);
  });

  it('gives the difference in cents', () => {
    expect(changeDueFor('20', 19.99)).toBe(0.01);
  });

  it('does not refuse exact change when the total carries float dust', () => {
    // A cart of $0.10 and $0.20 totals 0.30000000000000004. Compared as floats
    // the register would call a $0.30 tender short and refuse the sale.
    const due = calculateTotals([line(0.1), line(0.2, 1, 'p2')], [], 0).total;

    expect(due).not.toBe(0.3);
    expect(changeDueFor('0.30', due)).toBe(0);
  });
});

describe('quickCashOptionsFor', () => {
  it('rounds the total up, then offers the notes above it', () => {
    expect(quickCashOptionsFor(17.42)).toEqual([18, 20, 50, 100]);
  });

  it('does not offer the same note twice when the total is already a note', () => {
    expect(quickCashOptionsFor(20)).toEqual([20, 50, 100]);
  });

  it('offers at most four buttons', () => {
    expect(quickCashOptionsFor(3)).toEqual([3, 5, 10, 20]);
  });

  it('never offers a note that cannot cover the sale', () => {
    for (const option of quickCashOptionsFor(63.5)) {
      expect(option).toBeGreaterThanOrEqual(63.5);
    }
  });
});

describe('toDiscountRequests', () => {
  it('carries the identifiers the server re-resolves against', () => {
    const applied = discount({ source: 'promo_code', code: 'SAVE10', id: 'd1' });

    expect(toDiscountRequests([applied])).toEqual([
      { source: 'promo_code', id: 'd1', code: 'SAVE10', type: 'percentage', value: 10, reason: undefined },
    ]);
  });

  it('sends the name as a reason only for a manual discount', () => {
    const manual = discount({ source: 'manual', name: 'Damaged box' });
    const quick = discount({ source: 'quick_discount', name: 'Staff' });

    expect(toDiscountRequests([manual])[0].reason).toBe('Damaged box');
    expect(toDiscountRequests([quick])[0].reason).toBeUndefined();
  });

  it('drops the client-computed amount, which the server does not trust', () => {
    const applied = discount({ amount: 999 });

    expect(toDiscountRequests([applied])[0]).not.toHaveProperty('amount');
  });
});

describe('receiptLinesFrom', () => {
  const orderItem: OrderItem = {
    id: 'oi1',
    orderId: 'o1',
    productId: 'p1',
    variantId: 'p1-v1',
    nameSnapshot: 'Blue Shirt',
    quantity: 2,
    unitPrice: 12.5,
    lineDiscount: 1,
    lineTotal: 24,
  };

  const order = (items?: OrderItem[]): Order =>
    ({
      id: 'o1',
      createdAt: 0,
      subtotal: 25,
      discountTotal: 1,
      taxTotal: 0,
      total: 24,
      paymentMethod: 'Cash',
      items,
    }) as Order;

  it("prints the server's line items, at the server's prices", () => {
    // The cart says $99; the receipt must show what was actually charged.
    const lines = receiptLinesFrom(order([orderItem]), [line(99, 2)]);

    expect(lines).toEqual([
      {
        productId: 'p1',
        variantId: 'p1-v1',
        quantity: 2,
        price: 12.5,
        nameSnapshot: 'Blue Shirt',
        size: undefined,
        color: undefined,
        notes: undefined,
        lineDiscount: 1,
      },
    ]);
  });

  it('falls back to the cart when the response carries no items', () => {
    expect(receiptLinesFrom(order([]), [line(99)])).toEqual([line(99)]);
    expect(receiptLinesFrom(order(undefined), [line(99)])).toEqual([line(99)]);
  });

  it('copies the cart rather than aliasing it, so clearing the cart cannot blank the receipt', () => {
    const cart = [line(99)];
    const lines = receiptLinesFrom(order([]), cart);

    cart.length = 0;

    expect(lines).toHaveLength(1);
  });
});
