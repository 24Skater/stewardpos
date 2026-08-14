/**
 * The register's arithmetic, as pure functions.
 *
 * These lived inside `POS.tsx` as closures over component state, which is why
 * none of them had ever been executed by a test: reaching them meant rendering
 * a 1,500-line screen. They are the figures a cashier reads off the till and
 * counts into someone's hand, so they are exactly the code that should be
 * cheapest to test.
 *
 * The server recomputes all of this and refuses a mismatch — the client is
 * never believed about amounts. These functions decide what is *shown*, and a
 * register that displays the wrong change is a real problem even when the
 * recorded order is correct.
 */

import type { CartItem, Order, PaymentRequest, StoreCredit } from '@/lib/api';

export interface AppliedDiscount {
  source: 'quick_discount' | 'promo_code' | 'manual' | 'employee';
  id?: string;
  code?: string;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  amount: number;
}

export interface CartTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

/** Note denominations offered as quick-tender buttons. */
const CASH_NOTES = [5, 10, 20, 50, 100] as const;

/** How many quick-cash buttons the register has room for. */
const QUICK_CASH_LIMIT = 4;

export function calculateSubtotal(cart: readonly CartItem[]): number {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

/**
 * One discount's value against a given base.
 *
 * A fixed discount is capped at the base so a $20 coupon on a $12 sale takes
 * $12 rather than turning the total negative.
 */
export function calculateDiscountAmount(discount: AppliedDiscount, subtotal: number): number {
  if (discount.type === 'percentage') {
    return subtotal * (discount.value / 100);
  }
  return Math.min(discount.value, subtotal);
}

/**
 * Every applied discount, stacked.
 *
 * Each one prices against what is left after the ones before it, so two 50%
 * discounts take 75% and not 100%.
 */
export function getTotalDiscount(
  cart: readonly CartItem[],
  appliedDiscounts: readonly AppliedDiscount[],
): number {
  const subtotal = calculateSubtotal(cart);
  return appliedDiscounts.reduce((total, discount) => {
    return total + calculateDiscountAmount(discount, subtotal - total);
  }, 0);
}

/**
 * The money on the current cart.
 *
 * Single definition so cash checkout, card authorisation, and the order posted
 * after a card approval cannot drift apart - they previously each recomputed
 * this, and each hard-coded a 0% tax rate regardless of store settings.
 */
export function calculateTotals(
  cart: readonly CartItem[],
  appliedDiscounts: readonly AppliedDiscount[],
  taxRate: number,
): CartTotals {
  const subtotal = calculateSubtotal(cart);
  const discountTotal = getTotalDiscount(cart, appliedDiscounts);
  const taxTotal = (subtotal - discountTotal) * taxRate;

  return { subtotal, discountTotal, taxTotal, total: subtotal - discountTotal + taxTotal };
}

/**
 * How much of the sale the applied credit can cover.
 *
 * Capped at the total: a $50 credit against a $12 sale spends $12 and leaves
 * the rest on the card. The remainder stays as change on the credit, not as
 * cash back.
 */
export function creditAppliedTo(total: number, credit: StoreCredit | null | undefined): number {
  if (!credit) return 0;
  const totalCents = Math.round(total * 100);
  return Math.min(Math.round(credit.remainingAmount * 100), totalCents) / 100;
}

/** What is still owed after the credit, and therefore due on the chosen tender. */
export function amountDueAfterCredit(total: number, creditApplied: number): number {
  return Math.round((total - creditApplied) * 100) / 100;
}

/**
 * The tender breakdown to send, or `undefined` when there is nothing to split.
 *
 * Omitting it lets `paymentMethod` describe the whole sale, which is what
 * every sale without a credit is.
 */
export function buildPayments(
  method: string,
  credit: StoreCredit | null | undefined,
  creditApplied: number,
  amountDue: number,
): PaymentRequest[] | undefined {
  if (!credit || creditApplied <= 0) return undefined;

  const payments: PaymentRequest[] = [
    { method: 'store_credit', amount: creditApplied, reference: credit.code },
  ];

  if (amountDue > 0) {
    const lowered = method.toLowerCase();
    payments.push({
      method: lowered === 'card' ? 'card' : lowered === 'zelle' ? 'zelle' : 'cash',
      amount: amountDue,
    });
  }

  return payments;
}

/**
 * Change owed, or `null` when the tender does not cover the sale.
 *
 * A preview only - the server recomputes it against its own total and refuses
 * a shortfall, because the figure a cashier counts into someone's hand has to
 * match what was actually charged.
 *
 * Compared in cents: `0.1 + 0.2 > 0.3` in float, and a register that refuses
 * exact change is a support call.
 */
export function changeDueFor(cashTendered: string, amountDue: number): number | null {
  if (cashTendered === '') return null;
  const tendered = parseFloat(cashTendered);
  if (Number.isNaN(tendered)) return null;

  // Against what is *due* - a credit may already have covered part of it.
  const owed = Math.round(amountDue * 100);
  const given = Math.round(tendered * 100);
  return given < owed ? null : (given - owed) / 100;
}

/**
 * Note denominations a customer is likely to hand over.
 *
 * Rounded up from the total, so a $17.42 sale offers $20 rather than a list of
 * amounts that cannot cover it.
 */
export function quickCashOptionsFor(amountDue: number): number[] {
  const above = CASH_NOTES.filter(note => note >= amountDue);

  return [Math.ceil(amountDue), ...above]
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, QUICK_CASH_LIMIT);
}

/** Strip an applied discount down to what the server needs to re-resolve it. */
export function toDiscountRequests(applied: readonly AppliedDiscount[]) {
  return applied.map((discount) => ({
    source: discount.source,
    id: discount.id,
    code: discount.code,
    type: discount.type,
    value: discount.value,
    reason: discount.source === 'manual' ? discount.name : undefined,
  }));
}

/**
 * The receipt's line items, taken from the created order.
 *
 * Not the local cart: the totals on the receipt come from the server now, and
 * pairing those with client-side line prices would print a receipt whose lines
 * do not add up to its own total whenever the server repriced something.
 * Falls back to the cart only if the response carries no items.
 */
export function receiptLinesFrom(order: Order, cart: readonly CartItem[]): CartItem[] {
  const items = order.items ?? [];
  if (items.length === 0) return [...cart];

  return items.map(item => ({
    productId: item.productId,
    variantId: item.variantId,
    quantity: item.quantity,
    price: item.unitPrice,
    nameSnapshot: item.nameSnapshot,
    size: item.size,
    color: item.color,
    notes: item.notes,
    lineDiscount: item.lineDiscount,
  }));
}
