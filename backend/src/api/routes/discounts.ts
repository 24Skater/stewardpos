import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

// All discount routes require authentication
router.use(authenticate);

/**
 * Discounts & Promotions API Routes
 * 
 * === Quick Discounts (Discount Types) ===
 * GET    /api/discounts/types           - List all discount types
 * GET    /api/discounts/types/pos       - Get discount types for POS (active, show_in_pos)
 * GET    /api/discounts/types/:id       - Get discount type by ID
 * POST   /api/discounts/types           - Create discount type (admin)
 * PUT    /api/discounts/types/:id       - Update discount type (admin)
 * DELETE /api/discounts/types/:id       - Delete discount type (admin)
 * 
 * === Promo Codes ===
 * GET    /api/discounts/promos          - List all promo codes
 * GET    /api/discounts/promos/:id      - Get promo code by ID
 * POST   /api/discounts/promos          - Create promo code (admin)
 * PUT    /api/discounts/promos/:id      - Update promo code (admin)
 * DELETE /api/discounts/promos/:id      - Delete promo code (admin)
 * POST   /api/discounts/promos/validate - Validate a promo code
 * POST   /api/discounts/promos/:id/use  - Record promo code usage
 * 
 * === Employee Discounts ===
 * GET    /api/discounts/employee        - Get employee discounts (admin)
 * GET    /api/discounts/employee/:userId - Get employee discount for user
 * POST   /api/discounts/employee        - Create/update employee discount (admin)
 * DELETE /api/discounts/employee/:userId - Remove employee discount (admin)
 * 
 * === Manual Discounts ===
 * POST   /api/discounts/manual/validate - Validate manual discount (check limits/approval)
 * 
 * === Discount Usage ===
 * GET    /api/discounts/usage           - Get discount usage history
 * POST   /api/discounts/usage           - Log discount usage
 */

// ========================================
// Validation Schemas
// ========================================

const discountTypeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  code: z.string().optional(),
  discountType: z.enum(['percentage', 'fixed', 'buy_x_get_y']),
  discountValue: z.number().min(0),
  minPurchase: z.number().min(0).default(0),
  maxDiscount: z.number().min(0).optional().nullable(),
  appliesTo: z.enum(['all', 'products', 'services', 'categories']).default('all'),
  applicableIds: z.array(z.string()).optional(),
  requiresApproval: z.boolean().default(false),
  approvalThreshold: z.number().min(0).optional().nullable(),
  requiresEmployeeId: z.boolean().default(false),
  displayOrder: z.number().int().default(0),
  color: z.string().default('gray'),
  icon: z.string().optional(),
  showInPos: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

const promoCodeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1),
  description: z.string().optional(),
  discountType: z.enum(['percentage', 'fixed', 'free_shipping', 'buy_x_get_y', 'free_item']),
  discountValue: z.number().min(0),
  buyQuantity: z.number().int().min(1).optional(),
  getQuantity: z.number().int().min(1).optional(),
  getProductId: z.string().optional(),
  minPurchase: z.number().min(0).default(0),
  maxDiscount: z.number().min(0).optional().nullable(),
  minItems: z.number().int().min(0).default(0),
  appliesTo: z.enum(['all', 'products', 'services', 'categories', 'specific_items']).default('all'),
  applicableIds: z.array(z.string()).optional(),
  excludedIds: z.array(z.string()).optional(),
  firstOrderOnly: z.boolean().default(false),
  specificCustomers: z.array(z.string()).optional(),
  customerGroups: z.array(z.string()).optional(),
  maxUses: z.number().int().min(1).optional().nullable(),
  maxUsesPerCustomer: z.number().int().min(1).default(1),
  startsAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional().nullable(),
  stackable: z.boolean().default(false),
  priority: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

const employeeDiscountSchema = z.object({
  userId: z.string(),
  discountPercentage: z.number().min(0).max(100).default(10),
  maxDiscountAmount: z.number().min(0).optional().nullable(),
  requiresManagerApprovalAbove: z.number().min(0).optional().nullable(),
  allowedCategories: z.array(z.string()).optional(),
  isActive: z.boolean().default(true),
});

const validatePromoSchema = z.object({
  code: z.string().min(1),
  cartTotal: z.number().min(0),
  itemCount: z.number().int().min(0),
  customerId: z.string().optional(),
  customerEmail: z.string().email().optional(),
  isFirstOrder: z.boolean().optional(),
  productIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
});

const discountUsageSchema = z.object({
  orderId: z.string().optional(),
  quoteId: z.string().optional(),
  discountSource: z.enum(['promo_code', 'quick_discount', 'employee', 'manual', 'loyalty']),
  discountTypeId: z.string().optional(),
  promoCodeId: z.string().optional(),
  employeeDiscountId: z.string().optional(),
  discountCode: z.string().optional(),
  discountName: z.string().optional(),
  discountType: z.enum(['percentage', 'fixed']).optional(),
  discountValue: z.number().optional(),
  discountAmount: z.number().min(0),
  manualReason: z.string().optional(),
  customerId: z.string().optional(),
  customerEmail: z.string().optional(),
  requiresApproval: z.boolean().default(false),
  approvalStatus: z.enum(['none', 'pending', 'approved', 'rejected']).default('none'),
});

// ========================================
// DISCOUNT TYPES (Quick Discounts)
// ========================================

/**
 * GET /api/discounts/types
 * List all discount types
 */
router.get('/types', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const types = await adapter.getAllDiscountTypes();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/discounts/types/pos
 * Get discount types for POS display
 */
router.get('/types/pos', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const types = await adapter.getDiscountTypesForPOS();
    res.json({ success: true, data: types });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/discounts/types/:id
 */
router.get('/types/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const type = await adapter.getDiscountTypeById(req.params.id);
    if (!type) {
      throw new NotFoundError('Discount type not found');
    }
    res.json({ success: true, data: type });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/discounts/types
 */
router.post('/types', authorize(['admin', 'manager']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = discountTypeSchema.parse(req.body);
    const adapter = db.getAdapter();
    const created = await adapter.createDiscountType(data);
    logger.info(`Created discount type: ${created.name}`);
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * PUT /api/discounts/types/:id
 */
router.put('/types/:id', authorize(['admin', 'manager']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = discountTypeSchema.partial().parse(req.body);
    const adapter = db.getAdapter();
    const updated = await adapter.updateDiscountType(req.params.id, data);
    if (!updated) {
      throw new NotFoundError('Discount type not found');
    }
    logger.info(`Updated discount type: ${updated.id}`);
    res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * DELETE /api/discounts/types/:id
 */
router.delete('/types/:id', authorize(['admin']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const success = await adapter.deleteDiscountType(req.params.id);
    if (!success) {
      throw new NotFoundError('Discount type not found');
    }
    logger.info(`Deleted discount type: ${req.params.id}`);
    res.json({ success: true, message: 'Discount type deleted' });
  } catch (error) {
    next(error);
  }
});

// ========================================
// PROMO CODES
// ========================================

/**
 * GET /api/discounts/promos
 */
router.get('/promos', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const promos = await adapter.getAllPromoCodes();
    res.json({ success: true, data: promos });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/discounts/promos/:id
 */
router.get('/promos/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const promo = await adapter.getPromoCodeById(req.params.id);
    if (!promo) {
      throw new NotFoundError('Promo code not found');
    }
    res.json({ success: true, data: promo });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/discounts/promos
 */
router.post('/promos', authorize(['admin', 'manager']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = promoCodeSchema.parse(req.body);
    const adapter = db.getAdapter();
    const created = await adapter.createPromoCode({
      ...data,
      createdBy: req.user?.id,
    });
    logger.info(`Created promo code: ${created.code}`);
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * PUT /api/discounts/promos/:id
 */
router.put('/promos/:id', authorize(['admin', 'manager']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = promoCodeSchema.partial().parse(req.body);
    const adapter = db.getAdapter();
    const updated = await adapter.updatePromoCode(req.params.id, data);
    if (!updated) {
      throw new NotFoundError('Promo code not found');
    }
    logger.info(`Updated promo code: ${updated.id}`);
    res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * DELETE /api/discounts/promos/:id
 */
router.delete('/promos/:id', authorize(['admin']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const success = await adapter.deletePromoCode(req.params.id);
    if (!success) {
      throw new NotFoundError('Promo code not found');
    }
    logger.info(`Deleted promo code: ${req.params.id}`);
    res.json({ success: true, message: 'Promo code deleted' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/discounts/promos/validate
 * Validate a promo code for the current cart
 */
router.post('/promos/validate', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = validatePromoSchema.parse(req.body);
    const adapter = db.getAdapter();

    // Get promo code
    const promo = await adapter.getPromoCodeByCode(data.code.toUpperCase());
    if (!promo) {
      return res.json({
        success: false,
        valid: false,
        message: 'Invalid promo code',
      });
    }

    // Check if active
    if (!promo.isActive) {
      return res.json({ success: false, valid: false, message: 'This promo code is no longer active' });
    }

    // Check dates
    const now = Date.now();
    if (promo.startsAt > now) {
      return res.json({ success: false, valid: false, message: 'This promo code is not yet valid' });
    }
    if (promo.expiresAt && promo.expiresAt < now) {
      return res.json({ success: false, valid: false, message: 'This promo code has expired' });
    }

    // Check usage limits
    if (promo.maxUses && promo.currentUses >= promo.maxUses) {
      return res.json({ success: false, valid: false, message: 'This promo code has reached its usage limit' });
    }

    // Check per-customer usage
    if (data.customerId && promo.maxUsesPerCustomer) {
      const customerUsage = await adapter.getPromoCodeUsageByCustomer(promo.id, data.customerId);
      if (customerUsage >= promo.maxUsesPerCustomer) {
        return res.json({ success: false, valid: false, message: 'You have already used this promo code' });
      }
    }

    // Check first order only
    if (promo.firstOrderOnly && !data.isFirstOrder) {
      return res.json({ success: false, valid: false, message: 'This promo code is only valid for first orders' });
    }

    // Check minimum purchase
    if (promo.minPurchase && data.cartTotal < promo.minPurchase) {
      return res.json({
        success: false,
        valid: false,
        message: `Minimum purchase of $${promo.minPurchase.toFixed(2)} required`,
      });
    }

    // Check minimum items
    if (promo.minItems && data.itemCount < promo.minItems) {
      return res.json({
        success: false,
        valid: false,
        message: `Minimum of ${promo.minItems} items required`,
      });
    }

    // Check specific customers
    if (promo.specificCustomers?.length > 0 && data.customerId) {
      if (!promo.specificCustomers.includes(data.customerId)) {
        return res.json({ success: false, valid: false, message: 'This promo code is not available for your account' });
      }
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (promo.discountType === 'percentage') {
      discountAmount = data.cartTotal * (promo.discountValue / 100);
      if (promo.maxDiscount && discountAmount > promo.maxDiscount) {
        discountAmount = promo.maxDiscount;
      }
    } else if (promo.discountType === 'fixed') {
      discountAmount = Math.min(promo.discountValue, data.cartTotal);
    }

    res.json({
      success: true,
      valid: true,
      promo: {
        id: promo.id,
        code: promo.code,
        name: promo.name,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        discountAmount,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * POST /api/discounts/promos/:id/use
 * Increment promo code usage
 */
router.post('/promos/:id/use', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    await adapter.incrementPromoCodeUsage(req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ========================================
// EMPLOYEE DISCOUNTS
// ========================================

/**
 * GET /api/discounts/employee
 */
router.get('/employee', authorize(['admin', 'manager']), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const discounts = await adapter.getAllEmployeeDiscounts();
    res.json({ success: true, data: discounts });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/discounts/employee/:userId
 */
router.get('/employee/:userId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const discount = await adapter.getEmployeeDiscountByUser(req.params.userId);
    if (!discount) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: discount });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/discounts/employee
 */
router.post('/employee', authorize(['admin']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = employeeDiscountSchema.parse(req.body);
    const adapter = db.getAdapter();
    const created = await adapter.upsertEmployeeDiscount({
      ...data,
      approvedBy: req.user?.id,
      approvedAt: Date.now(),
    });
    logger.info(`Created/updated employee discount for user: ${data.userId}`);
    res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * DELETE /api/discounts/employee/:userId
 */
router.delete('/employee/:userId', authorize(['admin']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const success = await adapter.deleteEmployeeDiscount(req.params.userId);
    if (!success) {
      throw new NotFoundError('Employee discount not found');
    }
    logger.info(`Deleted employee discount for user: ${req.params.userId}`);
    res.json({ success: true, message: 'Employee discount removed' });
  } catch (error) {
    next(error);
  }
});

// ========================================
// DISCOUNT USAGE
// ========================================

/**
 * GET /api/discounts/usage
 */
router.get('/usage', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const { orderId, customerId, startDate, endDate } = req.query;
    const usage = await adapter.getDiscountUsage({
      orderId: orderId as string,
      customerId: customerId as string,
      startDate: startDate ? parseInt(startDate as string) : undefined,
      endDate: endDate ? parseInt(endDate as string) : undefined,
    });
    res.json({ success: true, data: usage });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/discounts/usage
 */
router.post('/usage', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = discountUsageSchema.parse(req.body);
    const adapter = db.getAdapter();
    const logged = await adapter.logDiscountUsage({
      ...data,
      appliedBy: req.user?.id,
    });
    res.status(201).json({ success: true, data: logged });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * GET /api/discounts/stats
 * Get discount usage statistics
 */
router.get('/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const { startDate, endDate } = req.query;
    const stats = await adapter.getDiscountStats({
      startDate: startDate ? parseInt(startDate as string) : undefined,
      endDate: endDate ? parseInt(endDate as string) : undefined,
    });
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

export default router;

