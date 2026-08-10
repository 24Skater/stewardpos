import { describe, it, expect } from 'vitest';
import { repriceReturn, type OriginalOrder } from '../returnPricing';

const ORDER: OriginalOrder = {
  id: 'o1',
  subtotal: 30,
  taxTotal: 3,
  total: 33,
  items: [
    {
      id: 'oi-tea',
      productId: 'p-tea',
      variantId: 'v-large',
      nameSnapshot: 'Loose Leaf Tea',
      size: 'Large',
      quantity: 4,
      unitPrice: 5,
      lineTotal: 20,
    },
    {
      id: 'oi-mug',
      productId: 'p-mug',
      nameSnapshot: 'Mug',
      quantity: 1,
      unitPrice: 10,
      lineTotal: 10,
    },
  ],
};

describe('repriceReturn', () => {
  it('prices from the order, not the request', () => {
    const priced = repriceReturn(ORDER, [{ originalOrderItemId: 'oi-tea', returnQuantity: 2 }]);

    expect(priced.items[0].unitPrice).toBe(5);
    expect(priced.subtotal).toBe(10);
  });

  it('carries the sold name and options onto the return line', () => {
    const priced = repriceReturn(ORDER, [{ originalOrderItemId: 'oi-tea', returnQuantity: 1 }]);

    expect(priced.items[0].nameSnapshot).toBe('Loose Leaf Tea');
    expect(priced.items[0].size).toBe('Large');
    expect(priced.items[0].variantId).toBe('v-large');
  });

  it('gives back the tax share that was actually charged', () => {
    // Half the order's value comes back, so half its $3 tax does too.
    const priced = repriceReturn(ORDER, [
      { originalOrderItemId: 'oi-tea', returnQuantity: 1 },
      { originalOrderItemId: 'oi-mug', returnQuantity: 1 },
    ]);

    expect(priced.subtotal).toBe(15);
    expect(priced.taxTotal).toBe(1.5);
    expect(priced.total).toBe(16.5);
  });

  it('subtracts a restocking fee', () => {
    const priced = repriceReturn(
      ORDER,
      [{ originalOrderItemId: 'oi-mug', returnQuantity: 1 }],
      [],
      { restockingFee: 2 }
    );

    expect(priced.total).toBe(9);
  });

  it('never lets a restocking fee make the refund negative', () => {
    const priced = repriceReturn(
      ORDER,
      [{ originalOrderItemId: 'oi-mug', returnQuantity: 1 }],
      [],
      { restockingFee: 999 }
    );

    expect(priced.total).toBe(0);
  });

  it('rejects a line that was not on the order', () => {
    expect(() =>
      repriceReturn(ORDER, [{ originalOrderItemId: 'oi-ghost', returnQuantity: 1 }])
    ).toThrow(/not part of this order/);
  });

  it('rejects a line that names no order line at all', () => {
    expect(() => repriceReturn(ORDER, [{ productId: 'p-tea', returnQuantity: 1 }])).toThrow(
      /must name the order line/
    );
  });

  it('refuses to return more than was sold', () => {
    expect(() =>
      repriceReturn(ORDER, [{ originalOrderItemId: 'oi-tea', returnQuantity: 5 }])
    ).toThrow(/Only 4 .* can still be returned/);
  });

  it('counts what earlier returns already took', () => {
    const priced = repriceReturn(
      ORDER,
      [{ originalOrderItemId: 'oi-tea', returnQuantity: 1 }],
      [{ status: 'completed', items: [{ originalOrderItemId: 'oi-tea', returnQuantity: 3 }] }]
    );

    expect(priced.subtotal).toBe(5);

    expect(() =>
      repriceReturn(
        ORDER,
        [{ originalOrderItemId: 'oi-tea', returnQuantity: 2 }],
        [{ status: 'completed', items: [{ originalOrderItemId: 'oi-tea', returnQuantity: 3 }] }]
      )
    ).toThrow(/Only 1 .* can still be returned/);
  });

  it('refuses a line already returned in full', () => {
    expect(() =>
      repriceReturn(
        ORDER,
        [{ originalOrderItemId: 'oi-mug', returnQuantity: 1 }],
        [{ status: 'approved', items: [{ originalOrderItemId: 'oi-mug', returnQuantity: 1 }] }]
      )
    ).toThrow(/already been returned in full/);
  });

  it('counts a pending return, so the same item cannot be submitted twice', () => {
    expect(() =>
      repriceReturn(
        ORDER,
        [{ originalOrderItemId: 'oi-mug', returnQuantity: 1 }],
        [{ status: 'pending', items: [{ originalOrderItemId: 'oi-mug', returnQuantity: 1 }] }]
      )
    ).toThrow(/already been returned in full/);
  });

  it('ignores a rejected return, which never happened', () => {
    const priced = repriceReturn(
      ORDER,
      [{ originalOrderItemId: 'oi-mug', returnQuantity: 1 }],
      [{ status: 'rejected', items: [{ originalOrderItemId: 'oi-mug', returnQuantity: 1 }] }]
    );

    expect(priced.subtotal).toBe(10);
  });

  it('sums duplicate lines for the same order line before checking', () => {
    expect(() =>
      repriceReturn(ORDER, [
        { originalOrderItemId: 'oi-mug', returnQuantity: 1 },
        { originalOrderItemId: 'oi-mug', returnQuantity: 1 },
      ])
    ).toThrow(/can still be returned/);
  });

  it('rejects a fractional quantity', () => {
    expect(() =>
      repriceReturn(ORDER, [{ originalOrderItemId: 'oi-tea', returnQuantity: 0.5 }])
    ).toThrow(/whole number/);
  });

  it('rejects an empty return', () => {
    expect(() => repriceReturn(ORDER, [])).toThrow(/at least one item/);
  });

  it('rejects a return against an order with no items', () => {
    expect(() =>
      repriceReturn({ ...ORDER, items: [] }, [{ originalOrderItemId: 'oi-tea', returnQuantity: 1 }])
    ).toThrow(/no items to return/);
  });
});
