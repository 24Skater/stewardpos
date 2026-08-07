import { ValidationError } from '../utils/errors';
import { toCents, toDollars } from './pricing';

/**
 * How a sale was paid for.
 *
 * A sale used to carry one `payment_method` string, so it could only be paid one
 * way — no $20 cash with the rest on a card, and no way to spend a store credit
 * at all, despite refunds being able to issue one.
 *
 * The rule this enforces is simple and worth stating plainly: **the applied
 * amounts must add up to the total.** Not less, which would record a sale as
 * paid when it was not; not more, which would overstate revenue. Cash is the one
 * tender where the customer may hand over more than their share — that surplus
 * is change, and it lives on the order rather than on the payment.
 */

export type TenderMethod = 'cash' | 'card' | 'store_credit' | 'zelle' | 'other';

export interface RequestedPayment {
  method: TenderMethod;
  /** Amount applied to the sale. For cash, its share — not what was handed over. */
  amount: number;
  /** A store credit code, a card transaction id, a Zelle confirmation. */
  reference?: string;
}

export interface ValidatedPayment {
  method: TenderMethod;
  amount: number;
  reference?: string;
}

export interface ValidatedTender {
  payments: ValidatedPayment[];
  /** What `orders.payment_method` should say: the single method, or 'Split'. */
  summaryMethod: string;
}

const METHOD_LABELS: Record<TenderMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  store_credit: 'Store Credit',
  zelle: 'Zelle',
  other: 'Other',
};

/**
 * Turn a single legacy `paymentMethod` into one payment covering the whole sale.
 *
 * Every existing caller sends only a method name, so this keeps them working
 * without pretending they described a split.
 */
export function singleTender(method: string, totalDollars: number): ValidatedTender {
  const normalised = method.trim().toLowerCase().replace(/\s+/g, '_');
  const known = (Object.keys(METHOD_LABELS) as TenderMethod[]).includes(normalised as TenderMethod)
    ? (normalised as TenderMethod)
    : 'other';

  return {
    payments: [{ method: known, amount: totalDollars }],
    // The caller's own wording is kept: a store may label a tender "Zelle" or
    // something of its own, and a receipt should say what they call it.
    summaryMethod: method,
  };
}

/**
 * Check a split against the priced total.
 *
 * Throws {@link ValidationError} — a 400 — rather than adjusting anything.
 * Silently correcting a mismatch would mean the payment rows disagreed with what
 * the cashier was shown, which is exactly the discrepancy this table exists to
 * make visible.
 */
export function validateTender(
  requested: RequestedPayment[],
  totalDollars: number
): ValidatedTender {
  if (requested.length === 0) {
    throw new ValidationError('A sale needs at least one payment');
  }

  const totalCents = toCents(totalDollars);
  let appliedCents = 0;

  const payments: ValidatedPayment[] = requested.map((payment) => {
    const amountCents = toCents(payment.amount);

    if (!Number.isFinite(payment.amount) || amountCents <= 0) {
      throw new ValidationError(
        `A ${METHOD_LABELS[payment.method] ?? payment.method} payment needs a positive amount`
      );
    }
    if (payment.method === 'store_credit' && !payment.reference) {
      throw new ValidationError('A store credit payment needs its code');
    }

    appliedCents += amountCents;

    return {
      method: payment.method,
      amount: toDollars(amountCents),
      reference: payment.reference,
    };
  });

  if (appliedCents !== totalCents) {
    const difference = toDollars(Math.abs(appliedCents - totalCents));
    throw new ValidationError(
      appliedCents < totalCents
        ? `Payments are $${difference.toFixed(2)} short of the $${totalDollars.toFixed(2)} total`
        : `Payments exceed the $${totalDollars.toFixed(2)} total by $${difference.toFixed(2)}`
    );
  }

  const methods = [...new Set(payments.map((payment) => payment.method))];
  const summaryMethod = methods.length === 1 ? METHOD_LABELS[methods[0]] : 'Split';

  return { payments, summaryMethod };
}

/** The cash share of a tender, for change calculation. */
export function cashPortion(payments: ValidatedPayment[]): number {
  return toDollars(
    payments
      .filter((payment) => payment.method === 'cash')
      .reduce((sum, payment) => sum + toCents(payment.amount), 0)
  );
}
