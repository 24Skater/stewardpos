import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/authorize';
import { resolveCallerRegister, readOverrideToken } from '../middleware/registerContext';
import { SHIFT_REQUIRED, OVERRIDE_REQUIRED } from '../middleware/registerErrorCodes';
import { ValidationError, NotFoundError, ConflictError, UnprocessableEntityError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit } from '../../services/audit';
import { getOpenShift, touchShift } from '../../services/registerShifts';
import { consumeOverride, describeOverrideFailure } from '../../services/registerOverrides';
import { calculateChange, toCents, toDollars } from '../../services/pricing';
import {
  type AppliedDiscountRequest,
  type ValidatedDiscount,
} from '../../services/discountPricing';
import { cardPortion, cashPortion, singleTender, validateTender } from '../../services/tender';
import { priceCart as priceCartService, type CartLine } from '../../services/cartPricing';

const router = Router();

// All order routes require authentication (orders contain sensitive data)
router.use(authenticate);

/**
 * Whether this caller may apply an ad-hoc discount.
 *
 * A manual discount has no catalog entry to validate against, so who may grant
 * one is the only control there is. A cashier holding `orders.write` cannot; an
 * admin, or anyone with `discounts.write`, can.
 */
function grantsManualDiscount(req: AuthRequest): boolean {
  return (req.user?.roles ?? []).some(
    (role) => role.systemRole === 'admin' || role.permissions?.discounts?.write === true
  );
}

/**
 * Order API Routes
 * 
 * GET    /api/orders          - List all orders
 * GET    /api/orders/:id      - Get order by ID
 * POST   /api/orders          - Create new order
 */

// Validation schemas
const orderItemSchema = z.object({
  productId: z.string(),
  variantId: z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : val),
    z.string().optional()
  ),
  nameSnapshot: z.string().optional(),
  size: z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : val),
    z.string().optional()
  ),
  color: z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : val),
    z.string().optional()
  ),
  quantity: z.number().int().min(1),
  // Accepted and discarded - the server prices the line. Optional because
  // requiring a figure that is then ignored forces every caller to compute
  // something it is not trusted on.
  unitPrice: z.number().min(0).optional(),
  lineDiscount: z.number().min(0).default(0),
  lineTotal: z.number().min(0).optional(),
  notes: z.preprocess(
    (val) => (val === null || val === undefined || val === '' ? undefined : val),
    z.string().optional()
  ),
});

/** A discount the register says it applied. Its value is resolved server-side. */
const appliedDiscountSchema = z.object({
  source: z.enum(['quick_discount', 'promo_code', 'manual', 'employee']),
  id: z.string().optional(),
  code: z.string().optional(),
  type: z.enum(['percentage', 'fixed']).optional(),
  value: z.number().optional(),
  reason: z.string().optional(),
});

/**
 * The money fields here are accepted for backward compatibility and then
 * ignored: the server reprices from the catalog.
 *
 * `discountTotal` included. A caller that wants a discount applied must say
 * *which* discounts, via `appliedDiscounts`, so each can be checked against the
 * catalog. A bare `discountTotal` is an unverifiable claim and is now worth
 * nothing.
 */
/**
 * What pricing needs, and nothing more.
 *
 * Deliberately not `createOrderSchema.partial()`: a quote has no payment method,
 * no customer, and no totals to ignore, and asking for them would suggest they
 * mattered.
 */
const quoteSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string(),
        variantId: z.preprocess(
          (val) => (val === null || val === undefined || val === '' ? undefined : val),
          z.string().optional()
        ),
        quantity: z.number().int().min(1),
        notes: z.string().optional(),
      })
    )
    .min(1),
  appliedDiscounts: z.array(appliedDiscountSchema).default([]),
});

const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  subtotal: z.number().min(0).optional(),
  discountTotal: z.number().min(0).default(0),
  taxTotal: z.number().min(0).default(0),
  total: z.number().min(0).optional(),
  appliedDiscounts: z.array(appliedDiscountSchema).default([]),
  paymentMethod: z.string(),
  /** Cash handed over. The server computes the change and rejects a shortfall. */
  cashTendered: z.number().min(0).optional(),
  /**
   * How the sale was paid, when it was split across tenders. Omit for a single
   * tender and `paymentMethod` covers it.
   */
  payments: z
    .array(
      z.object({
        method: z.enum(['cash', 'card', 'store_credit', 'zelle', 'other']),
        amount: z.number(),
        reference: z.string().optional(),
      })
    )
    .optional(),
  // Customer information is optional - can be omitted, empty string, or valid email
  customerEmail: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.string().email().optional()
  ),
  customerPhone: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.string().optional()
  ),
  cardTransactionId: z.string().optional(),
  cardAuthCode: z.string().optional(),
  /**
   * The payment attempt this sale is settling, from `POST /api/terminal/charge`.
   *
   * Present on any card sale rung through a reader. It is what turns "a card
   * was charged" and "an order exists" into one fact rather than two hopeful
   * ones, and it is checked against the tender before the order is written.
   */
  attemptId: z.string().uuid().optional(),
});

/**
 * GET /api/orders
 * List all orders
 */
router.get('/', requirePermission('orders', 'read'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const orders = await adapter.getAllOrders();

    logger.info(`Retrieved ${orders.length} orders`);

    res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/customer/:email
 * Get orders by customer email
 */
router.get('/customer/:email', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email } = req.params;
    const adapter = db.getAdapter();
    const orders = await adapter.getOrdersByCustomerEmail(email);

    logger.info(`Retrieved ${orders.length} orders for customer: ${email}`);

    res.json({
      success: true,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orders/:id
 * Get order by ID
 */
router.get('/:id', requirePermission('orders', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const order = await adapter.getOrderById(id);

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Price a cart for whoever is making this request.
 *
 * The pricing itself lives in `services/cartPricing` so the card terminal can
 * price the same cart the same way; this only supplies the two things about the
 * caller that pricing depends on.
 */
function priceCart(
  req: AuthRequest,
  items: CartLine[],
  appliedDiscounts: AppliedDiscountRequest[]
) {
  return priceCartService(items, appliedDiscounts, {
    actingUserId: req.user?.id,
    mayGrantManualDiscount: grantsManualDiscount(req),
  });
}

/**
 * POST /api/orders/quote
 * Price a cart without committing to it.
 */
router.post('/quote', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { items, appliedDiscounts } = quoteSchema.parse(req.body);
    const priced = await priceCart(req, items, appliedDiscounts);

    res.json({ success: true, data: priced });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')));
    } else {
      next(error);
    }
  }
});


/**
 * Log each discount this sale used, and burn a promo code's redemption.
 *
 * Server-side, from the amounts the server itself computed. The register used to
 * do both after checkout, which was wrong twice over: it logged its own figure
 * rather than the one actually applied, and a client that simply skipped the
 * call could redeem a single-use promo code indefinitely.
 *
 * Failures are logged, not thrown. The sale is already committed; losing a usage
 * row is a reporting gap, while failing the request here would leave the caller
 * believing a completed order did not happen.
 */
async function recordDiscountUsage(
  req: AuthRequest,
  orderId: string,
  discounts: ValidatedDiscount[],
  customerEmail?: string
): Promise<void> {
  const adapter = db.getAdapter();

  for (const discount of discounts) {
    try {
      await adapter.logDiscountUsage({
        orderId,
        discountSource: discount.source,
        discountTypeId: discount.source === 'quick_discount' ? discount.id : undefined,
        promoCodeId: discount.source === 'promo_code' ? discount.id : undefined,
        employeeDiscountId: undefined,
        discountCode: discount.code,
        discountName: discount.name,
        discountType: discount.type,
        discountValue: discount.value,
        discountAmount: discount.amount,
        manualReason: discount.source === 'manual' ? discount.name : undefined,
        customerEmail,
        appliedBy: req.user?.id,
      });

      if (discount.source === 'promo_code' && discount.id) {
        await adapter.incrementPromoCodeUsage(discount.id);
      }
    } catch (error) {
      logger.error(`Failed to record discount usage for order ${orderId}:`, error);
    }
  }
}

/**
 * POST /api/orders
 * Create new order
 */
router.post('/', requirePermission('orders', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orderData = createOrderSchema.parse(req.body);
    const adapter = db.getAdapter();

    const register = await resolveCallerRegister(req);
    // resolveCallerRegister only ever returns an active register today: an
    // X-Register-Id naming an inactive register is rejected inside it (400),
    // and the no-header fallback only ever considers active registers. This
    // check is defense in depth for if that guarantee ever loosens - the same
    // redundant pattern already exists in drawer.ts's POST /open - not because
    // it is reachable through the current resolution path.
    if (register.status !== 'active') {
      throw new ConflictError(`Register ${register.displayCode} is not active`);
    }

    // A shift, when one is open, is the actual person standing at this till
    // right now — not merely whoever's browser session this is. A register
    // that requires sign-in has nothing to fall back to, so it refuses
    // outright rather than guess.
    const openShift = await getOpenShift(adapter, register.id);
    if (!openShift && register.requireSignIn) {
      throw new ConflictError(
        `Register ${register.displayCode} requires a cashier to sign in with a PIN before ringing a sale`,
        SHIFT_REQUIRED
      );
    }

    const priced = await priceCart(req, orderData.items, orderData.appliedDiscounts);

    // A discount whose catalog entry demands approval, or whose amount blew
    // past `approval_threshold` (migration 004, unenforced until now), needs
    // a manager override before checkout can proceed. The grant travels as
    // `X-Override-Token` — see `middleware/registerContext.ts`'s
    // `readOverrideToken` for why a header rather than a body field.
    const discountNeedingOverride = priced.appliedDiscounts.find((discount) => discount.requiresOverride);
    let discountOverrideApproverId: string | null = null;
    if (discountNeedingOverride) {
      const overrideToken = readOverrideToken(req);
      if (!overrideToken) {
        throw new ConflictError(
          `"${discountNeedingOverride.name}" needs a supervisor override before checkout can proceed`,
          OVERRIDE_REQUIRED,
          { action: 'discount_approval' }
        );
      }

      const consumed = await consumeOverride(adapter, {
        token: overrideToken,
        action: 'discount_approval',
        registerId: register.id,
        // The discount itself, not the not-yet-created order — see
        // `services/registerOverrides.ts`'s doc comment on why the row
        // records what was actually done.
        entity: 'discount',
        entityId: discountNeedingOverride.id ?? discountNeedingOverride.code ?? discountNeedingOverride.name,
        afterValue: discountNeedingOverride.amount,
      });
      if (typeof consumed === 'string') {
        throw new ConflictError(describeOverrideFailure(consumed), OVERRIDE_REQUIRED, {
          action: 'discount_approval',
        });
      }

      discountOverrideApproverId = String(consumed.override.approverUserId);
    }

    // The tender has to add up to the repriced total, whether it is one payment
    // or five. A single `paymentMethod` becomes one payment covering the sale,
    // so existing callers are unchanged.
    const tender = orderData.payments
      ? validateTender(orderData.payments, priced.total)
      : singleTender(orderData.paymentMethod, priced.total);

    // A card-only lane (accepts_cash = false) must refuse a cash leg of a split
    // tender, not just a wholly-cash sale - so this checks the tender's actual
    // cash component, never the caller's chosen `paymentMethod` label.
    if (!register.acceptsCash && cashPortion(tender.payments) > 0) {
      throw new UnprocessableEntityError(
        `Register ${register.displayCode} does not accept cash`
      );
    }

    // Change is computed against the *cash portion*, not the whole total - on a
    // split, only the cash part can produce change, and giving change against
    // the full total would hand back money the card already covered.
    const cash =
      orderData.cashTendered === undefined
        ? {}
        : {
            amountTendered: orderData.cashTendered,
            changeGiven: calculateChange(cashPortion(tender.payments), orderData.cashTendered),
          };

    // Only a cash sale needs to link to a drawer session: a card-only sale is
    // legitimate on a register with no drawer open at all, and linking it to
    // an unrelated session would misattribute someone else's till. A cash sale
    // into a register with nothing open is not blocked - it just links to
    // nothing, same as before this existed - but a cash sale into an *open*
    // session must link, or the expected-cash join (orders.drawer_session_id =
    // session.id) silently understates that till by this sale's amount.
    const drawerSession =
      cashPortion(tender.payments) > 0 ? await adapter.getOpenDrawerSession(register.id) : null;

    /**
     * Check the sale against the money that was actually taken.
     *
     * The card has already been charged by the time this runs, so the order
     * must record the same figure the processor was given. Verified before
     * `createOrder` rather than after: a sale that disagrees with the charge is
     * one nobody can reconcile, and refusing to write it leaves the attempt
     * open and visible instead of producing a wrong record that looks settled.
     */
    const attempt = orderData.attemptId
      ? await adapter.getPaymentAttemptById(orderData.attemptId)
      : null;

    if (orderData.attemptId) {
      if (!attempt) {
        throw new NotFoundError('That card payment could not be found');
      }
      if (attempt.orderId) {
        throw new ConflictError('That card payment has already been recorded against a sale');
      }
      const chargedCents = attempt.amountCents;
      const onCardCents = toCents(cardPortion(tender.payments));
      if (chargedCents !== onCardCents) {
        throw new UnprocessableEntityError(
          `This sale puts $${toDollars(onCardCents).toFixed(2)} on a card, but $${toDollars(chargedCents).toFixed(2)} was charged. Refund the payment and ring the sale again.`
        );
      }
    }

    const order = await adapter.createOrder({
      ...orderData,
      ...priced,
      ...cash,
      paymentMethod: tender.summaryMethod,
      payments: tender.payments,
      registerId: register.id,
      // The signed-in cashier's shift, when one is open, is who actually rang
      // this sale. Falls back to req.user.id only when no shift is open and
      // the register does not require one — the pre-Phase-4 behavior, kept
      // for registers that have not turned PIN sign-in on.
      cashierUserId: openShift ? String(openShift.userId) : req.user?.id,
      drawerSessionId: drawerSession?.id ?? null,
      // The supervisor who approved the discount override above, when one
      // was needed. Null on every sale that never touched an approval gate.
      overrideByUserId: discountOverrideApproverId,
    });

    // The attempt is settled: this is what moves it out of the reconciliation
    // list. Failing here would leave a completed sale looking unreconciled,
    // which is the safe direction to be wrong in — somebody checks and finds
    // the order, rather than money going unnoticed.
    if (attempt) {
      try {
        await adapter.updatePaymentAttempt(attempt.id, {
          status: 'completed',
          orderId: String(order.id),
        });
      } catch (error) {
        logger.error(`Order ${order.id} created but attempt ${attempt.id} not linked:`, error);
      }
    }

    // If this was a card payment, link the terminal transaction to the order
    if (orderData.cardTransactionId) {
      await adapter.updateTerminalTransactionByChargeId(orderData.cardTransactionId, {
        orderId: order.id as string,
        status: 'approved',
        authCode: orderData.cardAuthCode,
      });
    }

    // A completed sale is activity: postpone this shift's idle clock so a
    // busy till mid-shift is not force-signed-out from under the cashier.
    if (openShift) {
      await touchShift(adapter, String(openShift.id));
    }

    await recordDiscountUsage(req, String(order.id), priced.appliedDiscounts, orderData.customerEmail);

    logger.info(`Created order: ${order.id} - Total: $${order.total}`);
    // Orders are immutable, so one create row is the whole story for a sale.
    await audit(req, { action: 'create', entity: 'order', entityId: String(order.id), after: order });

    res.status(201).json({
      success: true,
      data: order,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error('Order validation error', { issues: error.errors });
      const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      next(new ValidationError(errorMessage));
    } else {
      next(error);
    }
  }
});

export default router;