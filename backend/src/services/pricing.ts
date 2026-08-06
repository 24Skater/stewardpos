import { ValidationError } from '../utils/errors';

/**
 * Server-side repricing for a sale.
 *
 * The register posts what it believes a sale costs. Before this existed the API
 * simply stored those numbers, so anyone able to shape a request — a tampered
 * client, a stale one, curl — could buy a $40 item for a penny. Nothing the
 * client sends about money is trusted here: prices come from the catalog, tax
 * from settings, and the totals are recomputed.
 *
 * **Integer cents throughout.** Floating-point dollars do not survive the
 * arithmetic a receipt needs: `0.1 + 0.2 !== 0.3`, and a percentage tax over a
 * dozen lines drifts by a cent or two, which is exactly the sort of discrepancy
 * that shows up in a till count and nowhere else. Amounts convert back to
 * dollars only at the boundary, because that is what the DTOs and the DECIMAL
 * columns speak.
 */

/**
 * Dollars (as JSON carries them) to integer cents.
 *
 * The multiplication is itself floating-point, so this is not exact for every
 * conceivable input - `0.145 * 100` is `14.4999...` and rounds down to 14. That
 * is unavoidable while the wire format is a JSON number of dollars, and it does
 * not matter in practice because prices carry at most two decimals. What the
 * cents representation buys is that everything *after* this point - multiplying
 * by quantity, summing lines, applying tax - is exact integer arithmetic, which
 * is where the drift that shows up in a till count actually comes from.
 */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Integer cents back to dollars for the API boundary. */
export function toDollars(cents: number): number {
  return cents / 100;
}

/** A catalog variant as the pricing rules need it. */
export interface PriceableVariant {
  id: string;
  size?: string | null;
  color?: string | null;
  priceOverride?: number | null;
  priceDelta?: number | null;
  stock: number;
  enabled?: boolean;
}

export interface PriceableProduct {
  id: string;
  name: string;
  basePrice: number;
  variants?: PriceableVariant[];
}

/** What the client asks to buy. Only the identifiers and quantity are believed. */
export interface RequestedLine {
  productId: string;
  variantId?: string;
  quantity: number;
  notes?: string;
}

export interface PricedLine {
  productId: string;
  variantId?: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  quantity: number;
  /** Dollars, for the DTO boundary. */
  unitPrice: number;
  lineDiscount: number;
  lineTotal: number;
  notes?: string;
}

export interface PricedOrder {
  items: PricedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

/**
 * A variant's price in cents.
 *
 * An override replaces the base price outright; otherwise the delta is added.
 * Mirrors `calculateVariantPrice` on the client, which previews the same figure
 * in the cart — the two must agree or the register shows one price and charges
 * another.
 */
export function variantPriceCents(product: PriceableProduct, variant?: PriceableVariant): number {
  const baseCents = toCents(product.basePrice);
  if (!variant) return baseCents;

  if (variant.priceOverride !== undefined && variant.priceOverride !== null) {
    return toCents(variant.priceOverride);
  }

  return baseCents + toCents(variant.priceDelta ?? 0);
}

export interface RepriceOptions {
  /** Fractional rate, e.g. 0.08 for 8%. Taken from store settings, never the client. */
  taxRate: number;
  /**
   * Discount the caller asks to apply, in dollars.
   *
   * Still client-supplied: validating each applied discount against the discount
   * catalog is the remaining half of this work. It is clamped to the subtotal so
   * a sale can never go negative, but a caller able to forge a request can still
   * ask for a full discount. Treat as "not yet authoritative".
   */
  requestedDiscount?: number;
}

/**
 * Reprice a sale from the catalog.
 *
 * Throws {@link ValidationError} — a 400, not a 500 — when a line references
 * something that is not sellable: an unknown product or variant, a disabled
 * variant, or more units than are in stock. Refusing to oversell here is what
 * keeps two registers from selling the same last item.
 */
export function repriceOrder(
  requested: RequestedLine[],
  products: Map<string, PriceableProduct>,
  options: RepriceOptions
): PricedOrder {
  if (requested.length === 0) {
    throw new ValidationError('An order needs at least one item');
  }

  // Quantities are summed per variant first: two lines for the same variant must
  // be checked against stock together, or each passes on its own and the pair
  // oversells.
  const totalPerVariant = new Map<string, number>();
  for (const line of requested) {
    const key = `${line.productId}:${line.variantId ?? ''}`;
    totalPerVariant.set(key, (totalPerVariant.get(key) ?? 0) + line.quantity);
  }

  const items: PricedLine[] = [];
  let subtotalCents = 0;

  for (const line of requested) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new ValidationError('Item quantity must be a whole number of at least 1');
    }

    const product = products.get(line.productId);
    if (!product) {
      throw new ValidationError(`Product ${line.productId} is no longer available`);
    }

    let variant: PriceableVariant | undefined;
    if (line.variantId) {
      variant = (product.variants ?? []).find((candidate) => candidate.id === line.variantId);
      if (!variant) {
        throw new ValidationError(`That option of "${product.name}" is no longer available`);
      }
      if (variant.enabled === false) {
        throw new ValidationError(`That option of "${product.name}" is not for sale`);
      }

      const wanted = totalPerVariant.get(`${line.productId}:${line.variantId}`) ?? line.quantity;
      if (wanted > variant.stock) {
        throw new ValidationError(
          `Only ${variant.stock} of "${product.name}" left in stock`
        );
      }
    }

    const unitCents = variantPriceCents(product, variant);
    const lineCents = unitCents * line.quantity;
    subtotalCents += lineCents;

    items.push({
      productId: product.id,
      variantId: line.variantId,
      // Snapshotted from the catalog, not from the request: the receipt has to
      // name what was actually sold. Size and colour come from the variant for
      // the same reason - they are what distinguishes one line from another on a
      // printed receipt.
      nameSnapshot: product.name,
      size: variant?.size ?? undefined,
      color: variant?.color ?? undefined,
      quantity: line.quantity,
      unitPrice: toDollars(unitCents),
      lineDiscount: 0,
      lineTotal: toDollars(lineCents),
      notes: line.notes,
    });
  }

  const discountCents = Math.min(
    Math.max(toCents(options.requestedDiscount ?? 0), 0),
    subtotalCents
  );
  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.round(taxableCents * options.taxRate);

  return {
    items,
    subtotal: toDollars(subtotalCents),
    discountTotal: toDollars(discountCents),
    taxTotal: toDollars(taxCents),
    total: toDollars(taxableCents + taxCents),
  };
}
