# IMPLEMENTATION GUARDRAIL — Complete Modernization Guide

**Purpose:** Step-by-step guide to bring stewardPOS to modern standards and production-ready deployment  
**Status:** Active Implementation Checklist  
**Last Updated:** 2025-01-27

**⚠️ CRITICAL:** Follow steps in order. Do not skip any step. Check off each item as completed.

---

## PRE-IMPLEMENTATION CHECKLIST

Before starting, ensure you have:
- [ ] Git repository cloned and up to date
- [ ] Node.js 18+ installed
- [ ] Docker and Docker Compose installed
- [ ] Backend running locally (`cd backend && npm run dev`)
- [ ] Frontend running locally (`npm run dev`)
- [ ] Database accessible (PostgreSQL or SQLite)
- [ ] All current tests passing (if any)

---

## WEEK 1: FOUNDATION & INTEGRATION

### ✅ STEP 1: Frontend-Backend API Client

**Status:** [ ] Not Started | [ ] In Progress | [ ] Complete

#### 1.1 Create API Client Base

**File:** `src/lib/api-client.ts`

```typescript
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export interface ApiError {
  message: string;
  status: number;
  errors?: Record<string, string[]>;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public message: string,
    public errors?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function getToken(): Promise<string | null> {
  return localStorage.getItem('auth_token');
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiClientError(
      response.status,
      errorData.error || errorData.message || 'An error occurred',
      errorData.errors
    );
  }
  return response.json();
}

export const apiClient = {
  async get<T>(path: string): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    });
    return handleResponse<T>(response);
  },

  async post<T>(path: string, data: any): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(data),
    });
    return handleResponse<T>(response);
  },

  async put<T>(path: string, data: any): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(data),
    });
    return handleResponse<T>(response);
  },

  async delete<T>(path: string): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    });
    return handleResponse<T>(response);
  },
};
```

**Verification:**
- [ ] File created
- [ ] Code compiles without errors
- [ ] TypeScript types are correct

---

#### 1.2 Create Auth Store

**File:** `src/lib/auth-store.ts`

```typescript
interface AuthToken {
  token: string;
  expiresAt: number;
}

const TOKEN_KEY = 'auth_token';
const TOKEN_EXPIRY_KEY = 'auth_token_expiry';
const REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes before expiry

export const authStore = {
  setToken(token: string, expiresIn: string = '7d'): void {
    const expiresAt = Date.now() + parseExpiresIn(expiresIn);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiresAt.toString());
  },

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  },

  isTokenExpired(): boolean {
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!expiry) return true;
    return Date.now() >= parseInt(expiry, 10);
  },

  shouldRefreshToken(): boolean {
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!expiry) return false;
    const timeUntilExpiry = parseInt(expiry, 10) - Date.now();
    return timeUntilExpiry < REFRESH_THRESHOLD;
  },
};

function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * (multipliers[unit] || 1);
}
```

**Verification:**
- [ ] File created
- [ ] Token storage works
- [ ] Expiry calculation works

---

#### 1.3 Create API Types

**File:** `src/lib/api-types.ts`

```typescript
// Auth Types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  data: {
    token: string;
    user: {
      id: string;
      email: string;
      name: string;
      roleIds: string[];
      roles: Array<{
        id: string;
        name: string;
        systemRole?: string;
        permissions: any;
      }>;
    };
  };
}

export interface SessionResponse {
  success: boolean;
  data: {
    user: {
      id: string;
      email: string;
      name: string;
      roleIds: string[];
      status: string;
      roles: any[];
    };
  };
}

// Product Types
export interface Product {
  id: string;
  name: string;
  description?: string;
  category: string;
  basePrice: number;
  image?: string;
  barcode?: string;
  variants: ProductVariant[];
  createdAt: number;
  updatedAt: number;
}

export interface ProductVariant {
  id: string;
  size?: string;
  color?: string;
  priceOverride?: number;
  priceDelta?: number;
  sku?: string;
  barcode?: string;
  stock: number;
  enabled: boolean;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  category?: string;
  basePrice: number;
  image?: string;
  barcode?: string;
  variants?: Omit<ProductVariant, 'id'>[];
}

export interface UpdateProductRequest {
  name?: string;
  description?: string;
  category?: string;
  basePrice?: number;
  image?: string;
  barcode?: string;
}

// Order Types
export interface Order {
  id: string;
  createdAt: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paymentMethod: string;
  customerEmail?: string;
  customerPhone?: string;
  items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  variantId: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  lineTotal: number;
  notes?: string;
}

export interface CreateOrderRequest {
  items: Array<{
    productId: string;
    variantId?: string;
    nameSnapshot: string;
    size?: string;
    color?: string;
    quantity: number;
    unitPrice: number;
    lineDiscount?: number;
    lineTotal: number;
    notes?: string;
  }>;
  subtotal: number;
  discountTotal?: number;
  taxTotal?: number;
  total: number;
  paymentMethod: string;
  customerEmail?: string;
  customerPhone?: string;
}

// Customer Types
export interface Customer {
  id: string;
  name: string;
  org?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCustomerRequest {
  name: string;
  org?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes?: string;
}

// API Response Wrapper
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}
```

**Verification:**
- [ ] File created
- [ ] All types match backend responses
- [ ] No TypeScript errors

---

#### 1.4 Update Vite Config for Development Proxy

**File:** `vite.config.ts`

**Add to existing config:**

```typescript
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  // ... rest of config
}));
```

**Verification:**
- [ ] Proxy configuration added
- [ ] Development server restarts successfully
- [ ] `/api/*` requests proxy to backend

---

#### 1.5 Update Environment Example

**File:** `.env.example` (create if doesn't exist)

```bash
# API Configuration
VITE_API_BASE_URL=http://localhost:3001
```

**Verification:**
- [ ] File created/updated
- [ ] Variable documented

---

#### 1.6 Test API Client

**Manual Testing Steps:**
1. [ ] Start backend: `cd backend && npm run dev`
2. [ ] Start frontend: `npm run dev`
3. [ ] Open browser console
4. [ ] Test: `apiClient.get('/api/health')` (should work without auth)
5. [ ] Verify response structure

**Verification Checklist:**
- [ ] API client can make GET requests
- [ ] API client can make POST requests
- [ ] Error handling works (test with invalid endpoint)
- [ ] Token is included in headers when present

---

### ✅ STEP 2: Update Frontend Pages to Use API

**Status:** [ ] Not Started | [ ] In Progress | [ ] Complete

#### 2.1 Update Login Page

**File:** `src/pages/Login.tsx`

**Changes Required:**
1. Remove `db-operations.ts` imports
2. Remove IndexedDB auth logic
3. Use `apiClient.post('/api/auth/login', ...)`
4. Use `authStore.setToken(...)`
5. Update error handling

**Example Implementation:**

```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api-client';
import { authStore } from '@/lib/auth-store';
import type { LoginRequest, LoginResponse } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await apiClient.post<LoginResponse>('/api/auth/login', {
        email,
        password,
      } as LoginRequest);

      if (response.success && response.data.token) {
        authStore.setToken(response.data.token, '7d');
        toast({
          title: 'Success',
          description: 'Logged in successfully',
        });
        navigate('/');
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Login failed',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
    </form>
  );
}
```

**Verification:**
- [ ] Login page uses API client
- [ ] Token is stored after login
- [ ] Error messages display correctly
- [ ] Navigation works after login

---

#### 2.2 Update Auth Library

**File:** `src/lib/auth.ts`

**Changes Required:**
1. Remove IndexedDB dependencies
2. Use API client for session check
3. Use `authStore` for token management

**Example Implementation:**

```typescript
import { apiClient } from './api-client';
import { authStore } from './auth-store';
import type { SessionResponse } from './api-types';

export interface AuthSession {
  user: {
    id: string;
    email: string;
    name: string;
    roleIds: string[];
    roles: any[];
  };
}

let currentSession: AuthSession | null = null;

export async function getCurrentSession(): Promise<AuthSession | null> {
  // Check if token exists and is not expired
  if (!authStore.getToken() || authStore.isTokenExpired()) {
    currentSession = null;
    return null;
  }

  // If we have a cached session, return it
  if (currentSession) {
    return currentSession;
  }

  try {
    const response = await apiClient.get<SessionResponse>('/api/auth/session');
    if (response.success && response.data.user) {
      currentSession = {
        user: response.data.user,
      };
      return currentSession;
    }
  } catch (error) {
    // Token invalid, clear it
    authStore.clearToken();
    currentSession = null;
  }

  return null;
}

export function logout(): void {
  authStore.clearToken();
  currentSession = null;
  // Optionally call backend logout endpoint
  apiClient.post('/api/auth/logout').catch(() => {
    // Ignore errors on logout
  });
}

export function hasPermission(
  session: AuthSession | null,
  domain: string,
  action: 'read' | 'write' | 'delete'
): boolean {
  if (!session) return false;
  // Implement permission checking logic
  // This depends on your role/permission structure
  return true; // Placeholder
}
```

**Verification:**
- [ ] Auth library uses API client
- [ ] Session retrieval works
- [ ] Logout clears token
- [ ] Permission checking works

---

#### 2.3 Update POS Page

**File:** `src/pages/POS.tsx`

**Changes Required:**
1. Replace `getAllProducts()` from `db.ts` with `apiClient.get('/api/products')`
2. Replace `addOrder()` with `apiClient.post('/api/orders', ...)`
3. Update loading states
4. Update error handling

**Key Changes:**

```typescript
// OLD
import { getAllProducts, addOrder } from '@/lib/db';

// NEW
import { apiClient } from '@/lib/api-client';
import type { Product, CreateOrderRequest, Order } from '@/lib/api-types';

// In component
const [products, setProducts] = useState<Product[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const fetchProducts = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: Product[] }>('/api/products');
      if (response.success) {
        setProducts(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch products:', error);
      toast({
        title: 'Error',
        description: 'Failed to load products',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
  fetchProducts();
}, []);

const handleCheckout = async (orderData: CreateOrderRequest) => {
  try {
    const response = await apiClient.post<{ success: boolean; data: Order }>('/api/orders', orderData);
    if (response.success) {
      toast({
        title: 'Success',
        description: 'Order created successfully',
      });
      // Clear cart, etc.
    }
  } catch (error: any) {
    toast({
      title: 'Error',
      description: error.message || 'Failed to create order',
      variant: 'destructive',
    });
  }
};
```

**Verification:**
- [ ] Products load from API
- [ ] Orders can be created
- [ ] Loading states work
- [ ] Error handling works

---

#### 2.4 Update Inventory Page

**File:** `src/pages/Inventory.tsx`

**Changes Required:**
1. Replace `getAllProducts()` with API call
2. Replace product CRUD operations with API calls
3. Update all data fetching

**Verification:**
- [ ] Products list loads from API
- [ ] Create product works
- [ ] Update product works
- [ ] Delete product works

---

#### 2.5 Update Reports Page

**File:** `src/pages/Reports.tsx`

**Changes Required:**
1. Replace `getAllOrders()` with API call
2. Replace `getAllOrderItems()` with API call
3. Update data fetching logic

**Verification:**
- [ ] Orders load from API
- [ ] Reports display correctly
- [ ] Date filtering works (if implemented)

---

#### 2.6 Update Admin Pages

**Files to Update:**
- `src/pages/admin/AdminInventory.tsx`
- `src/pages/admin/AdminReports.tsx`
- `src/pages/admin/AdminCustomers.tsx`
- `src/pages/admin/AdminServices.tsx`
- `src/pages/admin/Dashboard.tsx`

**Changes Required:**
1. Replace all `db.ts` imports with `api-client`
2. Replace all data operations with API calls
3. Update error handling
4. Update loading states

**Verification:**
- [ ] All admin pages use API
- [ ] CRUD operations work
- [ ] Data displays correctly

---

#### 2.7 Update Protected Route

**File:** `src/components/ProtectedRoute.tsx`

**Changes Required:**
1. Use `getCurrentSession()` from updated `auth.ts`
2. Handle loading state
3. Handle token refresh if needed

**Verification:**
- [ ] Protected routes check auth correctly
- [ ] Redirects to login when not authenticated
- [ ] Allows access when authenticated

---

#### 2.8 Remove IndexedDB Dependencies (Optional - Keep for Dev)

**Decision:** Keep IndexedDB for development, but ensure production uses API only.

**Verification:**
- [ ] Production build uses API only
- [ ] Development can optionally use IndexedDB
- [ ] No hard dependencies on IndexedDB in production code

---

### ✅ STEP 3: Backend Docker Service

**Status:** [ ] Not Started | [ ] In Progress | [ ] Complete

#### 3.1 Create Backend Dockerfile

**File:** `backend/Dockerfile`

```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production=false

# Stage 2: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Set NODE_ENV
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy migrations (needed at runtime)
COPY --chown=nodejs:nodejs migrations ./migrations

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "dist/server.js"]
```

**Verification:**
- [ ] Dockerfile created
- [ ] Multi-stage build works
- [ ] Non-root user configured
- [ ] Health check configured

---

#### 3.2 Create Backend .dockerignore

**File:** `backend/.dockerignore`

```
node_modules
dist
.env
.env.local
*.log
logs
.DS_Store
.git
.gitignore
*.md
coverage
.nyc_output
.vscode
.idea
```

**Verification:**
- [ ] File created
- [ ] Unnecessary files excluded

---

#### 3.3 Update docker-compose.yml

**File:** `docker-compose.yml`

**Add backend service:**

```yaml
services:
  # ... existing services (postgres, minio) ...

  # Backend API
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: stewardpos-backend
    restart: unless-stopped
    environment:
      # Server
      NODE_ENV: production
      PORT: 3001
      HOST: 0.0.0.0
      
      # Database
      DB_ADAPTER: postgres
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ${DB_NAME:-stewardpos}
      DB_USER: ${DB_USER:-postgres}
      DB_PASSWORD: ${DB_PASSWORD:-postgres}
      
      # JWT
      JWT_SECRET: ${JWT_SECRET}
      JWT_EXPIRES_IN: ${JWT_EXPIRES_IN:-7d}
      
      # CORS
      CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost}
      
      # Rate Limiting
      RATE_LIMIT_WINDOW_MS: ${RATE_LIMIT_WINDOW_MS:-900000}
      RATE_LIMIT_MAX_REQUESTS: ${RATE_LIMIT_MAX_REQUESTS:-100}
      
      # Logging
      LOG_LEVEL: ${LOG_LEVEL:-info}
      LOG_FILE: /app/logs/app.log
    volumes:
      - backend_logs:/app/logs
    ports:
      - "${BACKEND_PORT:-3001}:3001"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    networks:
      - stewardpos-network

volumes:
  # ... existing volumes ...
  backend_logs:
    driver: local
```

**Verification:**
- [ ] Backend service added
- [ ] Environment variables configured
- [ ] Health check configured
- [ ] Dependencies configured

---

#### 3.4 Update .env.example

**File:** `.env.example`

**Add backend variables:**

```bash
# Backend
BACKEND_PORT=3001
JWT_SECRET=CHANGE_THIS_MIN_32_CHARACTERS_SECRET
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost,http://localhost:8080
```

**Verification:**
- [ ] Variables documented
- [ ] Defaults are safe

---

#### 3.5 Test Docker Backend

**Commands:**

```bash
# Build backend
docker-compose build backend

# Start all services
docker-compose up -d

# Check status
docker-compose ps

# Check logs
docker-compose logs backend

# Test health endpoint
curl http://localhost:3001/api/health

# Test with authentication (after login)
curl -H "Authorization: Bearer <token>" http://localhost:3001/api/products
```

**Verification Checklist:**
- [ ] Backend builds successfully
- [ ] Backend starts in Docker
- [ ] Health check passes
- [ ] Database connection works
- [ ] API endpoints respond
- [ ] Authentication works

---

## WEEK 2: TESTING & QUALITY

### ✅ STEP 4: Testing Infrastructure

**Status:** [ ] Not Started | [ ] In Progress | [ ] Complete

#### 4.1 Install Frontend Testing Dependencies

**Commands:**

```bash
npm install -D vitest @vitest/ui @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

**Verification:**
- [ ] Dependencies installed
- [ ] No version conflicts

---

#### 4.2 Create Frontend Vitest Config

**File:** `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Verification:**
- [ ] Config file created
- [ ] Path aliases work
- [ ] Environment configured

---

#### 4.3 Create Test Setup File

**File:** `src/test/setup.ts`

```typescript
import '@testing-library/jest-dom';
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
global.localStorage = localStorageMock as any;
```

**Verification:**
- [ ] Setup file created
- [ ] Imports work

---

#### 4.4 Update package.json Scripts

**File:** `package.json`

**Add scripts:**

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:watch": "vitest --watch"
  }
}
```

**Verification:**
- [ ] Scripts added
- [ ] `npm run test` works

---

#### 4.5 Write Initial Tests

**File:** `src/lib/__tests__/api-client.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient, ApiClientError } from '../api-client';

// Mock fetch
global.fetch = vi.fn();

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('get', () => {
    it('should make GET request without token', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: '1' } }),
      });

      const result = await apiClient.get('/api/test');

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/test',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
      expect(result).toEqual({ success: true, data: { id: '1' } });
    });

    it('should include token in headers when available', async () => {
      localStorage.setItem('auth_token', 'test-token');
      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await apiClient.get('/api/test');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('should throw ApiClientError on error response', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      });

      await expect(apiClient.get('/api/test')).rejects.toThrow(ApiClientError);
    });
  });
});
```

**Verification:**
- [ ] Test file created
- [ ] Tests pass: `npm run test`

---

#### 4.6 Install Backend Testing Dependencies

**Commands:**

```bash
cd backend
npm install -D vitest @vitest/ui supertest @types/supertest
```

**Verification:**
- [ ] Dependencies installed

---

#### 4.7 Create Backend Vitest Config

**File:** `backend/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
  },
});
```

**Verification:**
- [ ] Config created
- [ ] Tests can run

---

#### 4.8 Write Backend Tests

**File:** `backend/src/api/routes/__tests__/auth.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../../server';

describe('POST /api/auth/login', () => {
  it('should return 400 for invalid email', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'invalid', password: 'password' });

    expect(response.status).toBe(400);
  });

  it('should return 401 for invalid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' });

    expect(response.status).toBe(401);
  });

  // Add more tests...
});
```

**Verification:**
- [ ] Test file created
- [ ] Tests pass: `cd backend && npm run test`

---

#### 4.9 Update Backend package.json Scripts

**File:** `backend/package.json`

**Add scripts:**

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage"
  }
}
```

**Verification:**
- [ ] Scripts added
- [ ] Tests run successfully

---

### ✅ STEP 5: TypeScript Strict Mode

**Status:** [ ] Not Started | [ ] In Progress | [ ] Complete

#### 5.1 Enable Strict Mode

**File:** `tsconfig.app.json`

**Change:**

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true
  }
}
```

**Verification:**
- [ ] Config updated
- [ ] Run `npm run typecheck` to see errors

---

#### 5.2 Fix Type Errors Incrementally

**Strategy:**
1. Fix one file at a time
2. Start with utility files
3. Then components
4. Then pages

**Common Fixes:**

```typescript
// Before
function processData(data: any) { }

// After
function processData(data: unknown) {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid data');
  }
  // Now TypeScript knows data is object
}

// Before
const value = obj?.prop;

// After
const value = obj?.prop ?? defaultValue;
```

**Verification:**
- [ ] Run `npm run typecheck` after each file
- [ ] No type errors remain
- [ ] Build still works: `npm run build`

---

### ✅ STEP 6: Error Handling & Logging

**Status:** [ ] Not Started | [ ] In Progress | [ ] Complete

#### 6.1 Create Error Boundary

**File:** `src/components/ErrorBoundary.tsx`

```typescript
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    // TODO: Send to error tracking service (Sentry, etc.)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <Card className="m-4">
          <CardHeader>
            <CardTitle>Something went wrong</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <Button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              Reload Page
            </Button>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}
```

**Verification:**
- [ ] Component created
- [ ] Wraps App in `App.tsx`
- [ ] Test by throwing error in component

---

#### 6.2 Create Frontend Logger

**File:** `src/lib/logger.ts`

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: any;
  timestamp: string;
}

class Logger {
  private isDevelopment = import.meta.env.DEV;
  private logLevel: LogLevel = (import.meta.env.VITE_LOG_LEVEL as LogLevel) || 'info';

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private log(level: LogLevel, message: string, data?: any) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    if (this.isDevelopment) {
      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      console[method](`[${level.toUpperCase()}] ${message}`, data || '');
    } else {
      // In production, send to logging service
      // TODO: Implement logging service integration
    }
  }

  debug(message: string, data?: any) {
    this.log('debug', message, data);
  }

  info(message: string, data?: any) {
    this.log('info', message, data);
  }

  warn(message: string, data?: any) {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error | any) {
    this.log('error', message, error);
  }
}

export const logger = new Logger();
```

**Verification:**
- [ ] Logger created
- [ ] Replace `console.log` with `logger.info`
- [ ] Replace `console.error` with `logger.error`

---

#### 6.3 Update App.tsx with Error Boundary

**File:** `src/App.tsx`

**Wrap with ErrorBoundary:**

```typescript
import { ErrorBoundary } from '@/components/ErrorBoundary';

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      {/* ... rest of app ... */}
    </QueryClientProvider>
  </ErrorBoundary>
);
```

**Verification:**
- [ ] Error boundary wraps app
- [ ] Errors are caught and displayed

---

#### 6.4 Remove console.log Statements

**Search and Replace:**
- Find all `console.log`
- Replace with `logger.debug` or `logger.info`
- Find all `console.error`
- Replace with `logger.error`

**Verification:**
- [ ] No `console.log` in production code
- [ ] All logging uses logger

---

## WEEK 3: DEVOPS & SECURITY

### ✅ STEP 7: CI/CD Pipeline

**Status:** [ ] Not Started | [ ] In Progress | [ ] Complete

#### 7.1 Create GitHub Actions Workflow

**File:** `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:coverage

  test-backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: stewardpos_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - working-directory: ./backend
      - run: npm ci
      - run: npm run migrate
      - run: npm run test:coverage
        env:
          DB_ADAPTER: postgres
          DB_HOST: localhost
          DB_PORT: 5432
          DB_NAME: stewardpos_test
          DB_USER: postgres
          DB_PASSWORD: postgres
          JWT_SECRET: test-secret-min-32-characters-long-for-ci

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - working-directory: ./backend
      - run: npm ci
      - run: npm run build

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm audit --audit-level=moderate
      - working-directory: ./backend
      - run: npm ci
      - run: npm audit --audit-level=moderate
```

**Verification:**
- [ ] Workflow file created
- [ ] Push to GitHub
- [ ] Verify CI runs
- [ ] All checks pass

---

### ✅ STEP 8: Security Improvements

**Status:** [ ] Not Started | [ ] In Progress | [ ] Complete

#### 8.1 Remove Default Passwords

**Files to Update:**
- `docker-compose.yml`
- `backend/env.example`
- All documentation

**Changes:**
- Replace all default passwords with placeholders
- Add warnings about changing passwords

**Verification:**
- [ ] No hardcoded passwords
- [ ] All examples use placeholders

---

#### 8.2 Add Security Headers

**File:** `nginx.conf` (update existing)

**Add headers:**

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

**Verification:**
- [ ] Headers added
- [ ] Test with browser dev tools
- [ ] Headers present in responses

---

#### 8.3 Implement Token Refresh

**File:** `src/lib/auth-store.ts` (update)

**Add refresh logic:**

```typescript
export const authStore = {
  // ... existing methods ...

  async refreshToken(): Promise<boolean> {
    try {
      const response = await apiClient.post<LoginResponse>('/api/auth/refresh');
      if (response.success && response.data.token) {
        this.setToken(response.data.token, '7d');
        return true;
      }
    } catch (error) {
      this.clearToken();
      return false;
    }
    return false;
  },
};

// Auto-refresh token before expiry
setInterval(async () => {
  if (authStore.shouldRefreshToken()) {
    await authStore.refreshToken();
  }
}, 60000); // Check every minute
```

**Verification:**
- [ ] Token refresh implemented
- [ ] Auto-refresh works
- [ ] Handles refresh failures

---

## WEEK 4: DOCUMENTATION & POLISH

### ✅ STEP 9-15: Remaining Steps

**Follow the same pattern:**
1. Read the step in `PHASE6-EXECUTION-PLAN.md`
2. Create/modify files as specified
3. Test thoroughly
4. Check off verification items
5. Move to next step

---

## FINAL VERIFICATION CHECKLIST

Before considering the project complete:

### Code Quality
- [ ] All tests pass
- [ ] No linting errors
- [ ] No TypeScript errors
- [ ] Code is formatted (Prettier)
- [ ] No console.log statements

### Functionality
- [ ] Frontend connects to backend
- [ ] Authentication works
- [ ] All CRUD operations work
- [ ] Error handling works
- [ ] Loading states work

### Docker
- [ ] All services build
- [ ] All services start
- [ ] Health checks pass
- [ ] Services communicate correctly
- [ ] Non-root users configured

### Security
- [ ] No default passwords
- [ ] Security headers configured
- [ ] Token refresh works
- [ ] Input validation works
- [ ] Dependencies audited

### Documentation
- [ ] README updated
- [ ] Installation guide updated
- [ ] API documented
- [ ] Configuration documented
- [ ] Contributing guide updated

### CI/CD
- [ ] CI pipeline works
- [ ] Tests run automatically
- [ ] Build verification works
- [ ] Security scanning works

---

## TROUBLESHOOTING

### Common Issues

**Issue:** API calls fail with CORS error
**Solution:** Check CORS_ORIGIN in backend .env matches frontend URL

**Issue:** Token not included in requests
**Solution:** Verify authStore.getToken() returns token, check localStorage

**Issue:** Docker build fails
**Solution:** Check Dockerfile syntax, verify all files exist

**Issue:** Tests fail
**Solution:** Check test setup, verify mocks are correct

---

## PROGRESS TRACKING

**Week 1 Progress:** ___/3 steps complete
**Week 2 Progress:** ___/3 steps complete
**Week 3 Progress:** ___/2 steps complete
**Week 4 Progress:** ___/7 steps complete

**Overall Progress:** ___/15 steps complete

---

## NOTES

Use this section to track any issues, decisions, or deviations from the plan:

---

**Last Updated:** [Date]
**Current Step:** [Step Number and Name]
**Blockers:** [List any blockers]

---

**⚠️ REMEMBER:** Do not skip steps. Each step builds on the previous one. Complete verification before moving to the next step.

