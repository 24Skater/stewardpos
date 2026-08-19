import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authenticate, AuthRequest, DEFAULT_ORG_ID } from '../middleware/auth';
import {
  authorize,
  requirePermission,
  PERMISSION_RESOURCES,
  type PermissionResource,
} from '../middleware/authorize';
import { Seeder } from '../../services/seeder';
import { setPin, clearPin } from '../../services/pins';
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';
import { audit, SINGLETON_ENTITY_ID } from '../../services/audit';
import config from '../../config';
import componentsRoutes from './components';

const router = Router();
router.use(authenticate);

// Component management routes
router.use('/components', componentsRoutes);

// ===== User Management =====

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  roleIds: z.array(z.string()).min(1),
  status: z.enum(['active', 'inactive']).default('active'),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  roleIds: z.array(z.string()).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  /**
   * Whether this person may approve a manager override at a till.
   *
   * Separate from any role permission on purpose: approving an exception is
   * about who a store trusts to stand behind a decision, which is not the same
   * question as which admin screens someone may open.
   */
  canOverride: z.boolean().optional(),
});

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', requirePermission('users', 'read'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const users = await adapter.getAllUsers();

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/users
 * Create new user
 */
router.post('/users', requirePermission('users', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userData = createUserSchema.parse(req.body);
    const adapter = db.getAdapter();

    // Hash password
    const passwordHash = await bcrypt.hash(userData.password, 10);

    const user = await adapter.createUser({
      name: userData.name,
      email: userData.email,
      passwordHash,
      roleIds: userData.roleIds,
      status: userData.status,
    });

    logger.info(`Created user: ${user.email} (${user.id})`);
    await audit(req, { action: 'create', entity: 'user', entityId: String(user.id), after: user });

    res.status(201).json({
      success: true,
      data: user,
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
 * PUT /api/admin/users/:id
 * Update user
 */
router.put('/users/:id', requirePermission('users', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userData = updateUserSchema.parse(req.body);
    const adapter = db.getAdapter();

    const updateData: Record<string, unknown> = { ...userData };
    
    // Hash password if provided
    if (userData.password) {
      updateData.passwordHash = await bcrypt.hash(userData.password, 10);
      delete updateData.password;
    }

    const user = await adapter.updateUser(id, updateData);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    logger.info(`Updated user: ${id}`);
    await audit(req, { action: 'update', entity: 'user', entityId: id, after: user });

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

const setPinSchema = z.object({
  pin: z.string().trim(),
});

/**
 * PUT /api/admin/users/:id/pin
 *
 * Set an employee's till PIN.
 *
 * `users:write` rather than `users:delete`: issuing a PIN is granting an
 * ability, and it is the same authority that creates the employee in the first
 * place. The PIN itself is never echoed back, here or anywhere — the response
 * says only that one is now set. `services/audit.ts` redacts the field from the
 * snapshot, so the audit row records that a PIN changed without recording what
 * it changed to.
 */
router.put('/users/:id/pin', requirePermission('users', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { pin } = setPinSchema.parse(req.body);
    const adapter = db.getAdapter();

    const user = await adapter.getUserById(id);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const result = await setPin(adapter, req.orgId ?? DEFAULT_ORG_ID, id, pin);

    if (result === 'not_numeric') {
      throw new ValidationError('A PIN must be digits only');
    }
    if (result === 'too_short') {
      throw new ValidationError('That PIN is shorter than this store allows');
    }
    if (result === 'in_use') {
      // Deliberately does not say who holds it. Naming them would turn this
      // endpoint into a way to discover a colleague's PIN by guessing.
      throw new ConflictError('That PIN is already in use. Choose a different one.');
    }

    await audit(req, { action: 'update', entity: 'user', entityId: id, after: { pinSet: true } });

    res.json({ success: true, data: { id, pinSet: true } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

/**
 * DELETE /api/admin/users/:id/pin
 *
 * Clear an employee's PIN, revoking their ability to sign on to a till.
 *
 * Does not end any shift they currently have open: that is a separate act, and
 * silently dropping a cashier mid-sale to revoke a credential would lose a cart.
 * The next sign-on is what fails.
 */
router.delete('/users/:id/pin', requirePermission('users', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();

    const cleared = await clearPin(adapter, id);
    if (!cleared) {
      throw new NotFoundError('User not found');
    }

    await audit(req, { action: 'update', entity: 'user', entityId: id, after: { pinSet: false } });

    res.json({ success: true, data: { id, pinSet: false } });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete user
 */
router.delete('/users/:id', requirePermission('users', 'delete'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const deleted = await adapter.deleteUser(id);

    if (!deleted) {
      throw new NotFoundError('User not found');
    }

    logger.info(`Deleted user: ${id}`);
    await audit(req, { action: 'delete', entity: 'user', entityId: id });

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ===== Role Management =====

const createRoleSchema = z.object({
  name: z.string().min(1),
  systemRole: z.enum(['admin', 'supervisor', 'reporter', 'standard']).optional(),
  // Built from PERMISSION_RESOURCES rather than listed by hand. The hand-written
  // version had drifted: it named seven resources and omitted `orders`,
  // `returns`, and `discounts`, and because Zod strips unknown keys those were
  // silently discarded. A cashier role created through the admin UI came out
  // unable to take orders, with nothing to say why.
  permissions: z.object(
    Object.fromEntries(
      PERMISSION_RESOURCES.map((resource) => [
        resource,
        z.object({ read: z.boolean(), write: z.boolean(), delete: z.boolean() }),
      ])
    ) as Record<
      PermissionResource,
      z.ZodObject<{ read: z.ZodBoolean; write: z.ZodBoolean; delete: z.ZodBoolean }>
    >
  ),
});

const updateRoleSchema = createRoleSchema.partial();

/**
 * GET /api/admin/roles
 * List all roles
 */
router.get('/roles', requirePermission('users', 'read'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const roles = await adapter.getAllRoles();

    res.json({
      success: true,
      data: roles,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/roles
 * Create new role
 */
router.post('/roles', requirePermission('users', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const roleData = createRoleSchema.parse(req.body);
    const adapter = db.getAdapter();
    const role = await adapter.createRole(roleData);

    logger.info(`Created role: ${role.name} (${role.id})`);
    await audit(req, { action: 'create', entity: 'role', entityId: String(role.id), after: role });

    res.status(201).json({
      success: true,
      data: role,
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
 * PUT /api/admin/roles/:id
 * Update role
 */
router.put('/roles/:id', requirePermission('users', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const roleData = updateRoleSchema.parse(req.body);
    const adapter = db.getAdapter();
    // Captured first so the audit row can show what the permissions were.
    const before = await adapter.getRoleById(id);
    const role = await adapter.updateRole(id, roleData);

    if (!role) {
      throw new NotFoundError('Role not found');
    }

    logger.info(`Updated role: ${id}`);
    await audit(req, { action: 'update', entity: 'role', entityId: id, before, after: role });

    res.json({
      success: true,
      data: role,
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
 * DELETE /api/admin/roles/:id
 * Delete role
 */
router.delete('/roles/:id', requirePermission('users', 'delete'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const before = await adapter.getRoleById(id);
    const deleted = await adapter.deleteRole(id);

    if (!deleted) {
      throw new NotFoundError('Role not found');
    }

    logger.info(`Deleted role: ${id}`);
    await audit(req, { action: 'delete', entity: 'role', entityId: id, before });

    res.json({
      success: true,
      message: 'Role deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ===== Settings Management =====

// Helper to validate URLs more flexibly (allows empty strings, full URLs, and relative paths)
const flexibleUrl = z.string()
  .refine(
    (val) => !val || val.startsWith('http://') || val.startsWith('https://') || val.startsWith('data:') || val.startsWith('/'),
    { message: 'Must be a valid URL starting with http://, https://, data:, or /' }
  )
  .optional()
  .nullable();

const updateSettingsSchema = z.object({
  taxRateDefault: z.number().min(0).max(1).optional(),
  storeName: z.string().optional(),
  storeEmail: z.string().email().optional().nullable().or(z.literal('')),
  storePhone: z.string().optional().nullable(),
  timezone: z.string().optional(),
  logoUrl: flexibleUrl,
  iconUrl: flexibleUrl,
  brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable().or(z.literal('')),
  // Freeform, but the one key the catalog reads back is checked here rather than
  // defended against at read time: a store that stores `"5"` and sees no change
  // to its low-stock list has been given no reason why.
  config: z
    .record(z.any())
    .optional()
    .refine(
      (config) => {
        const threshold = config?.lowStockThreshold;
        return (
          threshold === undefined ||
          threshold === null ||
          (typeof threshold === 'number' && Number.isInteger(threshold) && threshold >= 0)
        );
      },
      { message: 'lowStockThreshold must be a whole number of units' }
    ),
  // Receipt branding
  storeAddress: z.string().optional().nullable(),
  storeCity: z.string().optional().nullable(),
  storeState: z.string().optional().nullable(),
  storeZip: z.string().optional().nullable(),
  storeNumber: z.string().optional().nullable(),
  receiptLogoUrl: flexibleUrl,
  receiptHeaderText: z.string().optional().nullable(),
  receiptFooterText: z.string().optional().nullable(),
  receiptShowLogo: z.boolean().optional(),
  receiptShowBarcode: z.boolean().optional(),
});

/**
 * GET /api/admin/settings
 * Get settings
 */
/**
 * Strip payment-processor secrets out of a settings payload.
 *
 * `config.terminalCredentials` holds live API keys - a Stripe secret key, a
 * Square access token. They are write-only by design: the settings form needs to
 * know *whether* a provider is configured, never what the key is, and anyone who
 * can read settings would otherwise walk away with the store's payment
 * credentials in a plain GET.
 *
 * The replacement flag is what the UI renders as "configured".
 */
function withoutSecrets(settings: Record<string, unknown>): Record<string, unknown> {
  const config = settings.config as Record<string, unknown> | undefined;
  if (!config || !('terminalCredentials' in config)) return settings;

  const credentials = config.terminalCredentials as Record<string, unknown> | null | undefined;
  const { terminalCredentials: _omitted, ...rest } = config;

  return {
    ...settings,
    config: {
      ...rest,
      terminalCredentialsConfigured: Boolean(
        credentials && Object.values(credentials).some((value) => value)
      ),
    },
  };
}

router.get('/settings', requirePermission('settings', 'read'), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const settings = await adapter.getSettings();

    res.json({
      success: true,
      data: settings
        ? withoutSecrets(settings as Record<string, unknown>)
        : {
            taxRateDefault: 0,
            storeName: 'StewardPOS',
            storeEmail: '',
            storePhone: '',
            timezone: 'UTC',
          },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/admin/settings
 * Update settings
 */
/**
 * Carry existing terminal credentials through an update that omits them.
 *
 * Consequence of {@link withoutSecrets}: the settings form never receives the
 * stored keys, so it cannot send them back. `config` is replaced wholesale on
 * write, which without this would mean every save of an unrelated setting - the
 * store's phone number - silently wiped the payment credentials and took card
 * payments offline.
 *
 * Sending a non-empty `terminalCredentials` still overwrites, which is how a key
 * gets rotated. Omitting it, or sending an empty object, means "leave as is".
 */
async function preserveSecrets(
  incoming: Record<string, unknown>,
  adapter: ReturnType<typeof db.getAdapter>
): Promise<Record<string, unknown>> {
  const config = incoming.config as Record<string, unknown> | undefined;
  if (!config) return incoming;

  const submitted = config.terminalCredentials as Record<string, unknown> | undefined;
  const hasNewCredentials = Boolean(submitted && Object.values(submitted).some((value) => value));
  if (hasNewCredentials) return incoming;

  const existing = (await adapter.getSettings()) as Record<string, unknown> | null;
  const storedConfig = existing?.config as Record<string, unknown> | undefined;
  const stored = storedConfig?.terminalCredentials;

  if (!stored) {
    // Nothing to carry over; drop the empty placeholder rather than storing it.
    const { terminalCredentials: _unset, ...rest } = config;
    return { ...incoming, config: rest };
  }

  return { ...incoming, config: { ...config, terminalCredentials: stored } };
}

router.put('/settings', requirePermission('settings', 'write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const settingsData = updateSettingsSchema.parse(req.body);
    const adapter = db.getAdapter();
    const before = await adapter.getSettings();
    const settings = await adapter.updateSettings(
      await preserveSecrets(settingsData as Record<string, unknown>, adapter)
    );

    logger.info('Settings updated');
    await audit(req, {
      action: 'update',
      entity: 'settings',
      entityId: SINGLETON_ENTITY_ID,
      before,
      after: settings,
    });

    res.json({
      success: true,
      data: withoutSecrets(settings as Record<string, unknown>),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ValidationError(error.errors[0].message));
    } else {
      next(error);
    }
  }
});

// ===== Audit Logs =====

/**
 * The audit trail's filters.
 *
 * Everything arrives as a string on the query, so the numbers are coerced here
 * and the failure is a 400. `limit` is capped rather than refused: a caller
 * asking for everything gets a page, not an error, and the server does not have
 * to hold an unbounded result set to answer.
 */
const AUDIT_LIMIT_DEFAULT = 50;
const AUDIT_LIMIT_MAX = 200;

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(AUDIT_LIMIT_MAX).default(AUDIT_LIMIT_DEFAULT),
  offset: z.coerce.number().int().min(0).default(0),
  userId: z.string().min(1).optional(),
  entity: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  /** Epoch milliseconds, both ends inclusive. */
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
});

/**
 * GET /api/admin/audit
 *
 * Filterable by who, what, which action and when, and paginated with a real
 * total. The screen above this used to fetch the newest hundred rows and filter
 * them in the browser, which meant its search box searched one page of the log
 * while looking like it searched the log.
 */
router.get('/audit', requirePermission('settings', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = auditQuerySchema.parse(req.query);

    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      throw new ValidationError('The start of the range must not be after its end');
    }

    const { logs, total } = await db.getAdapter().getAuditLogs(query);

    res.json({
      success: true,
      data: logs,
      meta: {
        total,
        limit: query.limit,
        offset: query.offset,
        page: Math.floor(query.offset / query.limit) + 1,
        hasMore: query.offset + logs.length < total,
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

// ===== Database Reset =====

/**
 * POST /api/admin/reset-database
 * Reset database - clears all data and re-seeds with default data
 */
router.post('/reset-database', authorize(['admin']), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Only allow admin users to reset database
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Check if user has admin role
    const adapter = db.getAdapter();
    const user = await adapter.getUserByEmail(req.user.email);
    if (!user || !(user as { roles?: Array<{ systemRole?: string }> }).roles?.some((r) => r.systemRole === 'admin')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    // Refuse outright in production.
    //
    // This truncates orders and order_items - a POS's sales ledger, which a shop
    // is generally obliged to keep - then runs
    // `DELETE FROM users WHERE email != 'admin@demo.local'`, removing every real
    // staff account, and finally reseeds the demo admin whose password is
    // published in this repository. On a live install one click would destroy
    // the trading history and leave a single account with known credentials.
    //
    // It is a development affordance, and it is reachable from a button in the
    // admin UI, so the gate belongs here rather than in the caller.
    if (config.nodeEnv === 'production') {
      throw new ForbiddenError('The database cannot be reset in production');
    }

    // A second, deliberate step: this is destructive and irreversible, and the
    // button sits next to ordinary inventory actions.
    if (req.body?.confirm !== 'RESET') {
      throw new ValidationError(
        'Resetting the database destroys all orders and staff accounts. Send { "confirm": "RESET" } to proceed.'
      );
    }

    logger.warn(`Database reset initiated by ${req.user.email}`);

    // Initialize seeder (it initializes itself in constructor)
    const seeder = new Seeder();

    // Clear existing data (in reverse order of dependencies)
    const adapterType = config.database.adapter as 'postgres' | 'sqlite';
    
    if (adapterType === 'postgres') {
      const pool = (adapter as any).pool;
      await pool.query('TRUNCATE TABLE order_items CASCADE');
      await pool.query('TRUNCATE TABLE orders CASCADE');
      await pool.query('TRUNCATE TABLE product_variants CASCADE');
      await pool.query('TRUNCATE TABLE products CASCADE');
      await pool.query('TRUNCATE TABLE user_roles CASCADE');
      // Keep users and roles, but reset their associations
      await pool.query('DELETE FROM users WHERE email != $1', ['admin@demo.local']);
    } else if (adapterType === 'sqlite') {
      const sqliteDb = (adapter as any).db;
      sqliteDb.exec(`
        DELETE FROM order_items;
        DELETE FROM orders;
        DELETE FROM product_variants;
        DELETE FROM products;
        DELETE FROM user_roles WHERE user_id NOT IN (SELECT id FROM users WHERE email = 'admin@demo.local');
      `);
    }

    // Forced: this has just emptied the tables on purpose, and the retained
    // demo administrator would otherwise make the database look "not empty".
    // The production refusal inside the seeder still applies, as does the one
    // at the top of this route.
    await seeder.seed(true);
    await seeder.close();

    logger.info('Database reset completed successfully');

    res.json({
      success: true,
      message: 'Database reset successfully. Fresh inventory loaded.',
    });
  } catch (error) {
    logger.error('Database reset failed:', error);
    next(error);
  }
});

export default router;
