import { ValidationError } from '../utils/errors';
import { toCents, toDollars } from './pricing';

/**
 * Server-side repricing for a return.
 *
 * The mirror of `repriceOrder`, and the more dangerous direction: a sale
 * mispriced downwards costs the store margin, a refund mispriced upwards hands
 * over cash. Return creation used to fetch the original order only to check it
 * existed, then store whatever line prices and totals the request supplied — so
 * a return against a $1 order could claim $9,999 and be paid out in full.
 *
 * Nothing about money is taken from the request here. Prices come from the
 * original order's lines, quantities are bounded by what was actually sold and
 * not already returned, and the totals are recomputed in integer cents.
 */

export interface OriginalOrderItem {
  id: string;
  productId: string;
  variantId?: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OriginalOrder {
  id: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  items?: OriginalOrderItem[];
}

/** A prior return against the same order, used to bound what is left. */
export interface PriorReturn {
  status?: string;
  items?: Array<{ originalOrderItemId?: string; returnQuantity: number }>;
}

/** What the caller asks to return. Only identifiers, quantities, and notes. */
export interface RequestedReturnLine {
  originalOrderItemId?: string;
  productId?: string;
  returnQuantity: number;
  condition?: string;
  notes?: string;
}

export interface PricedReturnLine {
  originalOrderItemId: string;
  productId: string;
  variantId?: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  originalQuantity: number;
  returnQuantity: number;
  unitPrice: number;
  lineTotal: number;
  condition: string;
  notes?: string;
}

export interface PricedReturn {
  items: PricedReturnLine[];
  subtotal: number;
  taxTotal: number;
  total: number;
}

/**
 * A return that has been rejected never happened, so it does not consume
 * quantity. Everything else — pending, approved, completed — does, which stops
 * the same item being submitted twice while the first is still awaiting
 * approval.
 */
function consumesQuantity(priorReturn: PriorReturn): boolean {
  return priorReturn.status !== 'rejected';
}

/** How much of each order line has already been returned. */
function alreadyReturned(priorReturns: PriorReturn[]): Map<string, number> {
  const used = new Map<string, number>();

  for (const priorReturn of priorReturns) {
    if (!consumesQuantity(priorReturn)) continue;

    for (const item of priorReturn.items ?? []) {
      if (!item.originalOrderItemId) continue;
      used.set(
        item.originalOrderItemId,
        (used.get(item.originalOrderItemId) ?? 0) + item.returnQuantity
      );
    }
  }

  return used;
}

/**
 * Price a return against the order it came from.
 *
 * Throws {@link ValidationError} — a 400 — when a line does not correspond to
 * something that was sold and is still returnable.
 *
 * Tax is apportioned by value rather than recomputed from the current tax rate:
 * a refund should return what the customer actually paid, and the rate may have
 * changed since the sale.
 */
export function repriceReturn(
  order: OriginalOrder,
  requested: RequestedReturnLine[],
  priorReturns: PriorReturn[] = [],
  options: { restockingFee?: number } = {}
): PricedReturn {
  const orderLines = order.items ?? [];
  if (orderLines.length === 0) {
    throw new ValidationError('That order has no items to return');
  }
  if (requested.length === 0) {
    throw new ValidationError('A return needs at least one item');
  }

  const used = alreadyReturned(priorReturns);
  const byId = new Map(orderLines.map((line) => [line.id, line]));

  // Summed per order line first, so two requested lines against the same sold
  // line cannot each pass a check the pair would fail.
  const wantedPerLine = new Map<string, number>();
  for (const line of requested) {
    const key = line.originalOrderItemId ?? '';
    wantedPerLine.set(key, (wantedPerLine.get(key) ?? 0) + line.returnQuantity);
  }

  const items: PricedReturnLine[] = [];
  let subtotalCents = 0;

  for (const line of requested) {
    if (!Number.isInteger(line.returnQuantity) || line.returnQuantity < 1) {
      throw new ValidationError('Return quantity must be a whole number of at least 1');
    }

    if (!line.originalOrderItemId) {
      throw new ValidationError('Each returned item must name the order line it came from');
    }

    const sold = byId.get(line.originalOrderItemId);
    if (!sold) {
      throw new ValidationError('That item was not part of this order');
    }

    const remaining = sold.quantity - (used.get(sold.id) ?? 0);
    if (remaining <= 0) {
      throw new ValidationError(`"${sold.nameSnapshot}" has already been returned in full`);
    }

    const wanted = wantedPerLine.get(line.originalOrderItemId) ?? line.returnQuantity;
    if (wanted > remaining) {
      throw new ValidationError(
        `Only ${remaining} of "${sold.nameSnapshot}" can still be returned`
      );
    }

    // The price paid, from the order. Not the request, and not today's catalog
    // price either - a refund returns what the customer handed over.
    const unitCents = toCents(sold.unitPrice);
    const lineCents = unitCents * line.returnQuantity;
    subtotalCents += lineCents;

    items.push({
      originalOrderItemId: sold.id,
      productId: sold.productId,
      variantId: sold.variantId,
      nameSnapshot: sold.nameSnapshot,
      size: sold.size,
      color: sold.color,
      originalQuantity: sold.quantity,
      returnQuantity: line.returnQuantity,
      unitPrice: toDollars(unitCents),
      lineTotal: toDollars(lineCents),
      condition: line.condition ?? 'good',
      notes: line.notes,
    });
  }

  // Tax apportioned by share of the order's subtotal, so a partial return gets
  // back its share of the tax that was actually charged.
  const orderSubtotalCents = toCents(order.subtotal);
  const orderTaxCents = toCents(order.taxTotal);
  const taxCents =
    orderSubtotalCents > 0
      ? Math.round((orderTaxCents * subtotalCents) / orderSubtotalCents)
      : 0;

  const feeCents = Math.min(
    Math.max(toCents(options.restockingFee ?? 0), 0),
    subtotalCents + taxCents
  );

  return {
    items,
    subtotal: toDollars(subtotalCents),
    taxTotal: toDollars(taxCents),
    total: toDollars(subtotalCents + taxCents - feeCents),
  };
}
