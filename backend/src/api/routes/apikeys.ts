import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { ValidationError, NotFoundError } from '../../utils/errors';
import db from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

// All routes require admin authentication
router.use(authenticate);
router.use(authorize(['admin']));

/**
 * API Key Management Routes (Admin Only)
 * 
 * GET    /api/admin/api-keys          - List all API keys
 * GET    /api/admin/api-keys/:id      - Get API key details
 * POST   /api/admin/api-keys          - Create new API key
 * PUT    /api/admin/api-keys/:id      - Update API key
 * DELETE /api/admin/api-keys/:id      - Delete/revoke API key
 * GET    /api/admin/api-docs          - Get API documentation
 */

// Validation schemas
const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  scopes: z.array(z.enum(['read', 'write', 'delete', 'admin'])).default(['read']),
  rateLimit: z.number().int().min(1).max(100000).default(1000),
  expiresAt: z.number().optional(), // Unix timestamp
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  scopes: z.array(z.enum(['read', 'write', 'delete', 'admin'])).optional(),
  rateLimit: z.number().int().min(1).max(100000).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.number().optional(),
});

/**
 * Generate a secure API key
 */
function generateApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = 'spk_' + crypto.randomBytes(4).toString('hex'); // 8 char prefix
  const secret = crypto.randomBytes(32).toString('hex'); // 64 char secret
  const key = `${prefix}_${secret}`;
  const hash = bcrypt.hashSync(key, 10);
  return { key, prefix, hash };
}

/**
 * GET /api/admin/api-keys
 * List all API keys (secrets are not returned)
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adapter = db.getAdapter();
    const apiKeys = await adapter.getAllApiKeys();
    
    // Never return the hash
    const sanitizedKeys = apiKeys.map(({ keyHash, ...rest }: any) => rest);
    
    res.json({
      success: true,
      data: sanitizedKeys,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/api-keys/:id
 * Get API key details
 */
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    const apiKey = await adapter.getApiKeyById(id);
    
    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }
    
    // Never return the hash
    const { keyHash, ...sanitizedKey } = apiKey;
    
    res.json({
      success: true,
      data: sanitizedKey,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/api-keys
 * Create a new API key
 */
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = createApiKeySchema.parse(req.body);
    const adapter = db.getAdapter();
    
    // Generate the key
    const { key, prefix, hash } = generateApiKey();
    
    const apiKey = await adapter.createApiKey({
      name: data.name,
      description: data.description,
      keyPrefix: prefix,
      keyHash: hash,
      scopes: data.scopes,
      rateLimit: data.rateLimit,
      expiresAt: data.expiresAt,
      createdBy: req.user?.id,
    });
    
    logger.info(`API key created: ${apiKey.id} by user ${req.user?.id}`);
    
    // Return the full key ONLY on creation - this is the only time it's visible
    res.status(201).json({
      success: true,
      data: {
        ...apiKey,
        key, // Only returned on creation!
      },
      message: 'API key created. Save the key now - it cannot be retrieved later.',
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
 * PUT /api/admin/api-keys/:id
 * Update an API key
 */
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const data = updateApiKeySchema.parse(req.body);
    const adapter = db.getAdapter();
    
    const apiKey = await adapter.updateApiKey(id, data);
    
    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }
    
    logger.info(`API key updated: ${id} by user ${req.user?.id}`);
    
    // Never return the hash
    const { keyHash, ...sanitizedKey } = apiKey;
    
    res.json({
      success: true,
      data: sanitizedKey,
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
 * DELETE /api/admin/api-keys/:id
 * Delete/revoke an API key
 */
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const adapter = db.getAdapter();
    
    const deleted = await adapter.deleteApiKey(id);
    
    if (!deleted) {
      throw new NotFoundError('API key not found');
    }
    
    logger.info(`API key deleted: ${id} by user ${req.user?.id}`);
    
    res.json({
      success: true,
      message: 'API key revoked successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/api-docs
 * Get API documentation
 */
router.get('/docs/reference', async (_req: AuthRequest, res: Response) => {
  const docs = {
    version: '1.0.0',
    baseUrl: '/api',
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization',
      format: 'Bearer <api_key>',
      example: 'Authorization: Bearer spk_abc12345_...',
    },
    scopes: {
      read: 'Read access to products, orders, customers, quotes, services',
      write: 'Create and update resources',
      delete: 'Delete resources',
      admin: 'Full administrative access',
    },
    rateLimiting: {
      header: 'X-RateLimit-Remaining',
      windowMs: 900000,
      description: 'Rate limit is per API key, configurable per key',
    },
    endpoints: [
      {
        group: 'Products',
        routes: [
          { method: 'GET', path: '/api/products', scope: 'read', description: 'List all products' },
          { method: 'GET', path: '/api/products/:id', scope: 'read', description: 'Get product by ID' },
          { method: 'POST', path: '/api/products', scope: 'write', description: 'Create a product' },
          { method: 'PUT', path: '/api/products/:id', scope: 'write', description: 'Update a product' },
          { method: 'DELETE', path: '/api/products/:id', scope: 'delete', description: 'Delete a product' },
        ],
      },
      {
        group: 'Orders',
        routes: [
          { method: 'GET', path: '/api/orders', scope: 'read', description: 'List all orders' },
          { method: 'GET', path: '/api/orders/:id', scope: 'read', description: 'Get order by ID' },
          { method: 'POST', path: '/api/orders', scope: 'write', description: 'Create an order' },
        ],
      },
      {
        group: 'Customers',
        routes: [
          { method: 'GET', path: '/api/customers', scope: 'read', description: 'List all customers' },
          { method: 'GET', path: '/api/customers/:id', scope: 'read', description: 'Get customer by ID' },
          { method: 'POST', path: '/api/customers', scope: 'write', description: 'Create a customer' },
          { method: 'PUT', path: '/api/customers/:id', scope: 'write', description: 'Update a customer' },
          { method: 'DELETE', path: '/api/customers/:id', scope: 'delete', description: 'Delete a customer' },
        ],
      },
      {
        group: 'Services',
        routes: [
          { method: 'GET', path: '/api/services', scope: 'read', description: 'List all services' },
          { method: 'GET', path: '/api/services/:id', scope: 'read', description: 'Get service by ID' },
          { method: 'POST', path: '/api/services', scope: 'write', description: 'Create a service' },
          { method: 'PUT', path: '/api/services/:id', scope: 'write', description: 'Update a service' },
          { method: 'DELETE', path: '/api/services/:id', scope: 'delete', description: 'Delete a service' },
        ],
      },
      {
        group: 'Quotes',
        routes: [
          { method: 'GET', path: '/api/quotes', scope: 'read', description: 'List all quotes' },
          { method: 'GET', path: '/api/quotes/:id', scope: 'read', description: 'Get quote by ID' },
          { method: 'POST', path: '/api/quotes', scope: 'write', description: 'Create a quote' },
          { method: 'PUT', path: '/api/quotes/:id', scope: 'write', description: 'Update a quote' },
          { method: 'PUT', path: '/api/quotes/:id/status', scope: 'write', description: 'Update quote status' },
          { method: 'DELETE', path: '/api/quotes/:id', scope: 'delete', description: 'Delete a quote' },
        ],
      },
    ],
    examples: {
      listProducts: {
        request: {
          method: 'GET',
          url: '/api/products',
          headers: {
            Authorization: 'Bearer spk_abc12345_...',
          },
        },
        response: {
          success: true,
          data: [
            {
              id: 'uuid',
              name: 'Product Name',
              category: 'Category',
              basePrice: 19.99,
              variants: [],
            },
          ],
        },
      },
      createOrder: {
        request: {
          method: 'POST',
          url: '/api/orders',
          headers: {
            Authorization: 'Bearer spk_abc12345_...',
            'Content-Type': 'application/json',
          },
          body: {
            items: [
              {
                productId: 'uuid',
                nameSnapshot: 'Product Name',
                quantity: 2,
                unitPrice: 19.99,
                lineTotal: 39.98,
              },
            ],
            subtotal: 39.98,
            taxTotal: 3.2,
            total: 43.18,
            paymentMethod: 'card',
          },
        },
      },
    },
    errors: {
      '400': 'Bad Request - Invalid request body or parameters',
      '401': 'Unauthorized - Missing or invalid API key',
      '403': 'Forbidden - API key does not have required scope',
      '404': 'Not Found - Resource not found',
      '429': 'Too Many Requests - Rate limit exceeded',
      '500': 'Internal Server Error',
    },
  };
  
  res.json({
    success: true,
    data: docs,
  });
});

export default router;

