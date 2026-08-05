import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import config from './config';
import { errorHandler } from './api/middleware/errorHandler';
import { requestLogger } from './api/middleware/requestLogger';

// Import routes
import authRoutes from './api/routes/auth';
import productsRoutes from './api/routes/products';
import ordersRoutes from './api/routes/orders';
import customersRoutes from './api/routes/customers';
import servicesRoutes from './api/routes/services';
import quotesRoutes from './api/routes/quotes';
import returnsRoutes from './api/routes/returns';
import receiptsRoutes from './api/routes/receipts';
import discountsRoutes from './api/routes/discounts';
import uploadRoutes from './api/routes/upload';
import apiKeysRoutes from './api/routes/apikeys';
import adminRoutes from './api/routes/admin';
import healthRoutes from './api/routes/health';
import setupRoutes from './api/routes/setup';
import terminalRoutes from './api/routes/terminal';

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
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Request logging
app.use(requestLogger);

// Health check (no auth required)
app.use('/api/health', healthRoutes);

// Setup routes (no auth required - must be before other routes)
app.use('/api/setup', setupRoutes);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/receipts', receiptsRoutes);
app.use('/api/discounts', discountsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin/api-keys', apiKeysRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/terminal', terminalRoutes);

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
