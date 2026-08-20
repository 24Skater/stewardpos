import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Receipt from '../Receipt';
import type { Order, OrderItem, Settings } from '@/lib/api';

/**
 * A receipt has to say which till produced it and who served.
 *
 * That is the line a customer points at when they come back to argue, and the
 * one a manager traces when a drawer is short. It is also the first place the
 * whole register estate becomes visible to someone who never opens the admin.
 */

const SETTINGS = {
  storeName: 'Church Coffee',
  storeEmail: 'hello@example.com',
  storePhone: '555-0100',
  taxRateDefault: 0,
} as Settings;

const ITEMS: OrderItem[] = [
  {
    id: 'oi1',
    productId: 'p1',
    nameSnapshot: 'Flat White',
    quantity: 1,
    unitPrice: 3.5,
    lineTotal: 3.5,
  } as OrderItem,
];

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'ord-1',
    createdAt: Date.UTC(2026, 7, 19, 10, 0, 0),
    subtotal: 3.5,
    discountTotal: 0,
    taxTotal: 0,
    total: 3.5,
    paymentMethod: 'cash',
    ...over,
  } as Order;
}

describe('Receipt', () => {
  it('names the till and the cashier when the order carries them', () => {
    render(
      <Receipt
        order={order({ registerDisplayCode: 'CHR-COF-01', cashierName: 'Casey' })}
        orderItems={ITEMS}
        settings={SETTINGS}
      />
    );

    expect(screen.getByText(/CHR-COF-01/)).toBeInTheDocument();
    expect(screen.getByText(/Casey/)).toBeInTheDocument();
  });

  it('omits the lines entirely on an order that predates registers', () => {
    // Rather than printing "Register: null" on years of historical receipts.
    render(<Receipt order={order()} orderItems={ITEMS} settings={SETTINGS} />);

    expect(screen.queryByText(/Register:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Served by:/)).not.toBeInTheDocument();
  });

  it('still prints a till when the sale was rung before PIN sign-in existed', () => {
    // register_id was backfilled by migration 016; cashier_user_id was not,
    // so half-populated is a real and common shape.
    render(
      <Receipt
        order={order({ registerDisplayCode: 'MAIN-01', cashierName: null })}
        orderItems={ITEMS}
        settings={SETTINGS}
      />
    );

    expect(screen.getByText(/MAIN-01/)).toBeInTheDocument();
    expect(screen.queryByText(/Served by:/)).not.toBeInTheDocument();
  });
});
