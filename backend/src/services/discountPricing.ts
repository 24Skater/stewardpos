import { ValidationError } from '../utils/errors';
import { toCents, toDollars } from './pricing';

/**
 * Server-side validation of the discounts applied to a sale.
 *
 * The register used to send a single `discountTotal` number, which the API
 * stored. Clamping it to the subtotal (see `repriceOrder`) stops a sale going
 * negative, but a forged request could still ask for 100% off. This resolves
 * each applied discount against the catalog instead: the *identity* comes from
 * the request, everything about its value comes from the database.
 *
 * A discount the server cannot account for is rejected outright rather than
 * quietly dropped — silently charging more than the cashier was shown is worse
 * than refusing the sale and making them retry.
 */

export type DiscountSource = 'quick_discount' | 'promo_code' | 'manual' | 'employee';

/** What the register says it applied. Only the source and identifier are trusted. */
export interface AppliedDiscountRequest {
  source: DiscountSource;
  id?: string;
  code?: string;
  /** Only consulted for `manual`, and only from a caller allowed to grant one. */
  type?: 'percentage' | 'fixed';
  /** Only consulted for `manual`. */
  value?: number;
  reason?: string;
}

interface CatalogDiscount {
  id: string;
  name?: string;
  discountType: string;
  discountValue: number;
  minPurchase?: number;
  maxDiscount?: number | null;
  isActive?: boolean;
  showInPos?: boolean;
  startsAt?: number;
  expiresAt?: number | null;
  maxUses?: number | null;
  currentUses?: number;
}

/** The catalog lookups this needs, so it can be tested without a database. */
export interface DiscountLookups {
  getDiscountTypeById(id: string): Promise<CatalogDiscount | null>;
  getPromoCodeById(id: string): Promise<CatalogDiscount | null>;
  getPromoCodeByCode(code: string): Promise<CatalogDiscount | null>;
}

export interface ValidateDiscountsOptions {
  subtotalCents: number;
  /**
   * Whether the acting user may grant an ad-hoc discount.
   *
   * Manual discounts are the one kind with no catalog entry to check against, so
   * the only meaningful control is who may apply one. A cashier holding just
   * `orders.write` cannot; `discounts.write` can.
   */
  mayGrantManualDiscount: boolean;
  now?: number;
}

export interface ValidatedDiscount {
  source: DiscountSource;
  id?: string;
  code?: string;
  name: string;
  type: 'percentage' | 'fixed';
  value: number;
  /** Dollars, computed here — never taken from the request. */
  amount: number;
}

export interface ValidatedDiscounts {
  discounts: ValidatedDiscount[];
  totalCents: number;
}

/**
 * Amount a discount takes off, in cents, given what is left to discount.
 *
 * `remainingCents` rather than the subtotal because discounts stack: the second
 * percentage applies to what the first left behind, which is the behaviour the
 * register previews.
 */
function amountCents(discount: CatalogDiscount, remainingCents: number): number {
  if (discount.discountType === 'percentage') {
    const raw = Math.round(remainingCents * (discount.discountValue / 100));
    const cap = discount.maxDiscount == null ? raw : toCents(discount.maxDiscount);
    return Math.min(raw, cap, remainingCents);
  }

  if (discount.discountType === 'fixed') {
    return Math.min(toCents(discount.discountValue), remainingCents);
  }

  // free_shipping, buy_x_get_y, free_item: no cart-level amount to apply, and
  // guessing one would take money off for a benefit never delivered.
  throw new ValidationError(
    `"${discount.name ?? discount.id}" cannot be applied at the register`
  );
}

export async function validateAppliedDiscounts(
  requested: AppliedDiscountRequest[],
  lookups: DiscountLookups,
  options: ValidateDiscountsOptions
): Promise<ValidatedDiscounts> {
  const now = options.now ?? Date.now();
  const discounts: ValidatedDiscount[] = [];
  let remainingCents = options.subtotalCents;

  for (const request of requested) {
    if (remainingCents <= 0) break;

    if (request.source === 'manual') {
      if (!options.mayGrantManualDiscount) {
        throw new ValidationError('You are not allowed to apply a manual discount');
      }
      if (request.type !== 'percentage' && request.type !== 'fixed') {
        throw new ValidationError('A manual discount must be a percentage or a fixed amount');
      }
      if (typeof request.value !== 'number' || request.value <= 0) {
        throw new ValidationError('A manual discount needs a positive amount');
      }

      const manual: CatalogDiscount = {
        id: 'manual',
        name: request.reason || 'Manual discount',
        discountType: request.type,
        discountValue: request.value,
      };
      const cents = amountCents(manual, remainingCents);
      remainingCents -= cents;
      discounts.push({
        source: 'manual',
        name: manual.name!,
        type: request.type,
        value: request.value,
        amount: toDollars(cents),
      });
      continue;
    }

    if (request.source === 'employee') {
      // Employee entitlements are per-user and carry their own approval
      // thresholds; wiring that up is separate work. Refusing is the safe
      // reading - the alternative is honouring an unverified number.
      throw new ValidationError('Employee discounts cannot be applied to a sale yet');
    }

    const catalog =
      request.source === 'quick_discount'
        ? request.id
          ? await lookups.getDiscountTypeById(request.id)
          : null
        : request.id
          ? await lookups.getPromoCodeById(request.id)
          : request.code
            ? await lookups.getPromoCodeByCode(request.code)
            : null;

    if (!catalog) {
      throw new ValidationError('That discount is no longer available');
    }
    if (catalog.isActive === false) {
      throw new ValidationError(`"${catalog.name ?? 'That discount'}" is no longer active`);
    }
    if (request.source === 'quick_discount' && catalog.showInPos === false) {
      throw new ValidationError(`"${catalog.name}" is not available at the register`);
    }
    if (catalog.startsAt != null && catalog.startsAt > now) {
      throw new ValidationError(`"${catalog.name}" is not valid yet`);
    }
    if (catalog.expiresAt != null && catalog.expiresAt < now) {
      throw new ValidationError(`"${catalog.name}" has expired`);
    }
    if (catalog.maxUses != null && (catalog.currentUses ?? 0) >= catalog.maxUses) {
      throw new ValidationError(`"${catalog.name}" has reached its usage limit`);
    }
    if (catalog.minPurchase != null && options.subtotalCents < toCents(catalog.minPurchase)) {
      throw new ValidationError(
        `"${catalog.name}" needs a minimum purchase of $${catalog.minPurchase.toFixed(2)}`
      );
    }

    const cents = amountCents(catalog, remainingCents);
    remainingCents -= cents;
    discounts.push({
      source: request.source,
      id: catalog.id,
      code: request.code,
      name: catalog.name ?? 'Discount',
      type: catalog.discountType as 'percentage' | 'fixed',
      value: catalog.discountValue,
      amount: toDollars(cents),
    });
  }

  return { discounts, totalCents: options.subtotalCents - remainingCents };
}
