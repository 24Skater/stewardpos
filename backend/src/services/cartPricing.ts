import db from './database';
import {
  repriceOrder,
  toCents,
  toDollars,
  type PriceableProduct,
} from './pricing';
import {
  validateAppliedDiscounts,
  type AppliedDiscountRequest,
  type ValidatedDiscount,
} from './discountPricing';

/**
 * Pricing a cart authoritatively, for every caller that needs a total.
 *
 * Lifted out of the orders route so the card terminal can use it too. That
 * matters more than tidiness: the register used to compute the charge amount in
 * the browser and post it, and the route accepted any positive integer. Pricing
 * here means the figure quoted, the figure charged, and the figure recorded all
 * come from one function by construction — two implementations would drift, and
 * the failure mode is a card charged one amount while the order records another.
 *
 * Everything the client said about money is discarded: prices come from the
 * catalog, tax from settings, and each claimed discount is resolved against the
 * discount catalog.
 */

export interface CartLine {
  productId: string;
  variantId?: string;
  quantity: number;
  notes?: string;
}

/**
 * Who is asking, in the only two respects pricing cares about.
 *
 * Passed explicitly rather than as the request, so this can be called from
 * anywhere and tested without one.
 */
export interface PricingActor {
  actingUserId?: string;
  /**
   * Whether this caller may apply an ad-hoc discount. A manual discount has no
   * catalog entry to validate against, so who may grant one is the only control
   * there is.
   */
  mayGrantManualDiscount: boolean;
}

export interface PricedCart {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  appliedDiscounts: ValidatedDiscount[];
}

export async function priceCart(
  items: CartLine[],
  appliedDiscounts: AppliedDiscountRequest[],
  actor: PricingActor
): Promise<PricedCart> {
  const adapter = db.getAdapter();

  const catalog = new Map<string, PriceableProduct>();
  for (const productId of new Set(items.map((item) => item.productId))) {
    const product = await adapter.getProductById(productId);
    if (product) catalog.set(productId, product as unknown as PriceableProduct);
  }

  const settings = await adapter.getSettings();
  const taxRate = Number((settings as { taxRateDefault?: number } | null)?.taxRateDefault ?? 0);

  const lines = items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    quantity: item.quantity,
    notes: item.notes,
  }));

  // Priced once without discounts first: a percentage discount needs a subtotal
  // to apply to, and that subtotal has to come from the catalog too.
  const undiscounted = repriceOrder(lines, catalog, { taxRate });

  const validated = await validateAppliedDiscounts(appliedDiscounts, adapter, {
    subtotalCents: toCents(undiscounted.subtotal),
    actingUserId: actor.actingUserId,
    mayGrantManualDiscount: actor.mayGrantManualDiscount,
  });

  return {
    ...repriceOrder(lines, catalog, {
      taxRate,
      requestedDiscount: toDollars(validated.totalCents),
    }),
    appliedDiscounts: validated.discounts,
  };
}

/**
 * The two things about a caller that pricing depends on.
 *
 * Typed structurally rather than against the express request, so a service can
 * stay a service and this can be exercised without one.
 */
export function pricingActor(user?: {
  id?: string;
  roles?: Array<{ systemRole?: string; permissions?: { discounts?: { write?: boolean } } }>;
}): PricingActor {
  return {
    actingUserId: user?.id,
    mayGrantManualDiscount: (user?.roles ?? []).some(
      (role) => role.systemRole === 'admin' || role.permissions?.discounts?.write === true
    ),
  };
}
