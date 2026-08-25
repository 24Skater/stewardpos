import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from './config';
import { errorHandler } from './api/middleware/errorHandler';
import { requestLogger } from './api/middleware/requestLogger';
import logger from './utils/logger';
import { storage } from './storage';

// Import routes
import authRoutes from './api/routes/auth';
import webhookRoutes from './api/routes/webhooks';
import productsRoutes from './api/routes/products';
import categoriesRoutes from './api/routes/categories';
import ordersRoutes from './api/routes/orders';
import customersRoutes from './api/routes/customers';
import servicesRoutes from './api/routes/services';
import quotesRoutes from './api/routes/quotes';
import returnsRoutes from './api/routes/returns';
import storeCreditsRoutes from './api/routes/storeCredits';
import drawerRoutes from './api/routes/drawer';
import receiptsRoutes from './api/routes/receipts';
import discountsRoutes from './api/routes/discounts';
import reportsRoutes from './api/routes/reports';
import uploadRoutes from './api/routes/upload';
import apiKeysRoutes from './api/routes/apikeys';
import adminRoutes from './api/routes/admin';
import healthRoutes from './api/routes/health';
import setupRoutes from './api/routes/setup';
import terminalRoutes from './api/routes/terminal';
import locationsRoutes from './api/routes/locations';
import registersRoutes from './api/routes/registers';

/**
 * Builds the Express application.
 *
 * Kept separate from `server.ts` so tests can import the app without opening a
 * port or requiring a live database connection.
 */
const app: Application = express();

// Security middleware
app.use(helmet());

// CORS configuration - handle multiple origins
const allowedOrigins = config.cors.origin
  .split(',')
  .map(origin => origin.trim())
  .filter(origin => origin.length > 0);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Refuse by omitting the CORS headers rather than raising. Throwing here
    // reached the error handler as an unclassified Error and surfaced as a 500,
    // which reads as "the server broke" in logs and monitoring when the truth is
    // that a caller was turned away by policy. The browser blocks the response
    // either way; this just stops a policy decision looking like an outage.
    logger.warn(`Blocked cross-origin request from ${origin}`);
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  /**
   * Every header the client is allowed to send cross-origin.
   *
   * This list must name every custom header the app actually reads, or the
   * browser blocks the request at preflight before it reaches a route. It
   * omitted the register headers, and because `api-client.ts` attaches
   * `X-Register-Id` to *every* request once a till has been selected, that
   * broke sign-in itself for any origin not served through the same proxy as
   * the API — the preflight for `POST /api/auth/login` was refused over a
   * header the login route never even looks at.
   *
   * Keep it in step with what the middleware reads: `X-Register-Id` and
   * `X-Register-Token` (`registerContext.ts`), `X-Override-Token`
   * (`registerContext.ts`), and `X-Api-Key` (`auth.ts`).
   */
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Register-Id',
    'X-Register-Token',
    'X-Override-Token',
    'X-Api-Key',
  ],
}));

// Only when configured: see the note on `trustProxy` in config. Rate limiting
// depends on this to see the real client, and it is unsafe to assume.
if (config.trustProxy > 0) {
  app.set('trust proxy', config.trustProxy);
}

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

/**
 * Brute-force protection for sign-in.
 *
 * The global limiter is sized for a busy shop, which makes it useless against
 * password guessing - thousands of attempts would fit inside it. This is a
 * separate, much smaller budget in front of `/api/auth/login` only.
 *
 * `skipSuccessfulRequests` is what makes a tight limit safe: only failures
 * count, so a shift change where six cashiers sign in one after another spends
 * nothing, while an attacker gets ten guesses a quarter-hour.
 */
const loginLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxLoginAttempts,
  skipSuccessfulRequests: true,
  message: 'Too many sign-in attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', loginLimiter);

/**
 * Brute-force protection for device pairing.
 *
 * `POST /api/registers/pair` mints a real device credential (a
 * `X-Register-Token`) and, unlike almost every other write in this API, is
 * reachable with no session at all — the device pairing it has no user
 * logged in yet. That combination (credential-issuing + unauthenticated) is
 * exactly what brute-force protection exists for, same reasoning as
 * `loginLimiter` above. `skipSuccessfulRequests` for the same reason too: a
 * shop pairing several new terminals in a row must not exhaust a budget
 * meant for someone guessing codes.
 */
const pairLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxPairAttempts,
  skipSuccessfulRequests: true,
  message: 'Too many pairing attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/registers/pair', pairLimiter);

/**
 * Stripe webhooks, mounted ahead of the JSON parser.
 *
 * Signature verification hashes the exact bytes Stripe sent, so this route has
 * to see the raw body. Once `express.json()` has parsed and the handler
 * reserialises, the bytes differ — the object is identical, the signature is
 * not — and every event is rejected. Ordering here is the whole mechanism, so
 * it must stay above the parser below.
 */
app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), webhookRoutes);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Serve uploaded images from whichever store is configured.
 *
 * This was `express.static`, which is only correct while uploads are files on
 * this machine. Routing reads through the storage port instead means the same
 * `/uploads/logos/x.png` resolves under either adapter, so a shop can move to a
 * bucket without rewriting the URLs already saved against its settings and
 * products — and the bucket never has to be public.
 *
 * Deliberately before `requestLogger` and outside `/api`, matching where the
 * static mount sat: an image request is not an API call and does not need a log
 * line each.
 */
app.get('/uploads/:prefix/:filename', async (req, res, next) => {
  try {
    const { prefix, filename } = req.params;
    const found = await storage().get(prefix, filename);
    if (!found) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }
    res.setHeader('Content-Type', found.contentType);
    if (found.contentLength !== undefined) {
      res.setHeader('Content-Length', String(found.contentLength));
    }
    // A logo changes rarely and its filename is a uuid, so a new one is a new
    // URL. Long-lived immutable caching costs nothing and keeps the API out of
    // the path for every page view.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    found.body.on('error', next);
    found.body.pipe(res);
  } catch (error) {
    // An invalid key is a bad request, not a missing file — but either way the
    // caller learns nothing about the store's layout.
    next(error);
  }
});

// Request logging
app.use(requestLogger);

// Health check (no auth required)
app.use('/api/health', healthRoutes);

// Setup routes (no auth required - must be before other routes)
app.use('/api/setup', setupRoutes);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/store-credits', storeCreditsRoutes);
app.use('/api/drawer', drawerRoutes);
app.use('/api/receipts', receiptsRoutes);
app.use('/api/discounts', discountsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin/api-keys', apiKeysRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/terminal', terminalRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/registers', registersRoutes);

// 404 handler
app.use('*', (_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

export default app;
