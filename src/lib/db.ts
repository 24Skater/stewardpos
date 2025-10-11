import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface Category {
  id: string;
  name: string;
  icon?: string;
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

export interface CartItem {
  productId: string;
  variantId: string;
  quantity: number;
  price: number;
  nameSnapshot?: string;
  size?: string;
  color?: string;
  notes?: string;
  lineDiscount?: number;
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
}

export interface Settings {
  taxRateDefault: number;
  storeName: string;
  storeEmail: string;
  storePhone: string;
  timezone?: string;
  logoUrl?: string;
  iconUrl?: string;
  brandColor?: string;
  storageProvider?: 'indexeddb' | 'supabase';
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export type AppRole = 'admin' | 'supervisor' | 'reporter' | 'standard';

export interface Permission {
  read: boolean;
  write: boolean;
  delete: boolean;
}

export interface RolePermissions {
  inventory: Permission;
  reports: Permission;
  exports: Permission;
  settings: Permission;
  users: Permission;
  services: Permission;
  customers: Permission;
}

export interface Role {
  id: string;
  name: string;
  systemRole?: AppRole;
  permissions: RolePermissions;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  roleIds: string[];
  status: 'active' | 'inactive';
  lastLoginAt?: number;
  createdAt: number;
}

export interface AuditLog {
  id: string;
  timestamp: number;
  userId: string;
  action: string;
  entity: string;
  entityId: string;
  before?: any;
  after?: any;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  description: string;
  basePrice?: number;
  unitType?: 'flat' | 'hourly' | 'per-item';
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Customer {
  id: string;
  name: string;
  org?: string;
  email?: string;
  phone?: string;
  notes: string;
  tags: string[];
  lastOrderAt?: number;
  lifetimeValue: number;
  createdAt: number;
  updatedAt: number;
}

export interface QuoteItem {
  itemId?: string;
  variantId?: string;
  serviceId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Quote {
  id: string;
  customerId: string;
  items: QuoteItem[];
  subtotal: number;
  taxTotal: number;
  total: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  createdAt: number;
  updatedAt: number;
}

interface PersonaPOSDB extends DBSchema {
  categories: {
    key: string;
    value: Category;
  };
  products: {
    key: string;
    value: Product;
    indexes: { 'by-category': string; 'by-barcode': string };
  };
  orders: {
    key: string;
    value: Order;
    indexes: { 'by-date': number };
  };
  orderItems: {
    key: string;
    value: OrderItem;
    indexes: { 'by-order': string };
  };
  settings: {
    key: string;
    value: Settings;
  };
  users: {
    key: string;
    value: User;
    indexes: { 'by-email': string };
  };
  roles: {
    key: string;
    value: Role;
  };
  auditLogs: {
    key: string;
    value: AuditLog;
    indexes: { 'by-user': string; 'by-timestamp': number };
  };
  services: {
    key: string;
    value: Service;
    indexes: { 'by-category': string };
  };
  customers: {
    key: string;
    value: Customer;
    indexes: { 'by-email': string };
  };
  quotes: {
    key: string;
    value: Quote;
    indexes: { 'by-customer': string; 'by-status': string };
  };
}

let dbInstance: IDBPDatabase<PersonaPOSDB> | null = null;

export async function getDB() {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<PersonaPOSDB>('persona-pos', 3, {
    upgrade(db, oldVersion) {
      // Categories store
      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id' });
      }

      // Products store
      if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', { keyPath: 'id' });
        productStore.createIndex('by-category', 'category');
        productStore.createIndex('by-barcode', 'barcode');
      }

      // Orders store
      if (!db.objectStoreNames.contains('orders')) {
        const orderStore = db.createObjectStore('orders', { keyPath: 'id' });
        orderStore.createIndex('by-date', 'createdAt');
      }

      // Order Items store
      if (!db.objectStoreNames.contains('orderItems')) {
        const orderItemsStore = db.createObjectStore('orderItems', { keyPath: 'id' });
        orderItemsStore.createIndex('by-order', 'orderId');
      }

      // Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'storeName' });
      }

      // Users store
      if (!db.objectStoreNames.contains('users')) {
        const userStore = db.createObjectStore('users', { keyPath: 'id' });
        userStore.createIndex('by-email', 'email');
      }

      // Roles store
      if (!db.objectStoreNames.contains('roles')) {
        db.createObjectStore('roles', { keyPath: 'id' });
      }

      // Audit logs store
      if (!db.objectStoreNames.contains('auditLogs')) {
        const auditStore = db.createObjectStore('auditLogs', { keyPath: 'id' });
        auditStore.createIndex('by-user', 'userId');
        auditStore.createIndex('by-timestamp', 'timestamp');
      }

      // Services store
      if (!db.objectStoreNames.contains('services')) {
        const serviceStore = db.createObjectStore('services', { keyPath: 'id' });
        serviceStore.createIndex('by-category', 'category');
      }

      // Customers store
      if (!db.objectStoreNames.contains('customers')) {
        const customerStore = db.createObjectStore('customers', { keyPath: 'id' });
        customerStore.createIndex('by-email', 'email');
      }

      // Quotes store
      if (!db.objectStoreNames.contains('quotes')) {
        const quoteStore = db.createObjectStore('quotes', { keyPath: 'id' });
        quoteStore.createIndex('by-customer', 'customerId');
        quoteStore.createIndex('by-status', 'status');
      }
    },
  });

  return dbInstance;
}

// Product operations
export async function addProduct(product: Product) {
  const db = await getDB();
  await db.add('products', product);
}

export async function updateProduct(product: Product) {
  const db = await getDB();
  await db.put('products', product);
}

export async function deleteProduct(id: string) {
  const db = await getDB();
  await db.delete('products', id);
}

export async function getProduct(id: string) {
  const db = await getDB();
  return db.get('products', id);
}

export async function getAllProducts() {
  const db = await getDB();
  return db.getAll('products');
}

export async function getProductsByCategory(category: string) {
  const db = await getDB();
  return db.getAllFromIndex('products', 'by-category', category);
}

export async function getProductByBarcode(barcode: string) {
  const db = await getDB();
  const products = await db.getAllFromIndex('products', 'by-barcode', barcode);
  return products[0];
}

// Category operations
export async function getAllCategories() {
  const db = await getDB();
  return db.getAll('categories');
}

export async function addCategory(category: Category) {
  const db = await getDB();
  await db.add('categories', category);
}

// Order operations
export async function addOrder(order: Order) {
  const db = await getDB();
  await db.add('orders', order);
}

export async function getAllOrders() {
  const db = await getDB();
  return db.getAll('orders');
}

export async function getOrdersByDateRange(startDate: number, endDate: number) {
  const db = await getDB();
  const allOrders = await db.getAll('orders');
  return allOrders.filter(o => o.createdAt >= startDate && o.createdAt <= endDate);
}

// Order Items operations
export async function addOrderItem(item: OrderItem) {
  const db = await getDB();
  await db.add('orderItems', item);
}

export async function getOrderItems(orderId: string) {
  const db = await getDB();
  return db.getAllFromIndex('orderItems', 'by-order', orderId);
}

export async function getAllOrderItems() {
  const db = await getDB();
  return db.getAll('orderItems');
}

// Service operations
export async function getAllServices() {
  const db = await getDB();
  return db.getAll('services');
}

// Customer operations
export async function getAllCustomers() {
  const db = await getDB();
  return db.getAll('customers');
}

// Settings operations
export async function getSettings() {
  const db = await getDB();
  const allSettings = await db.getAll('settings');
  return allSettings[0];
}

export async function saveSettings(settings: Settings) {
  const db = await getDB();
  await db.put('settings', settings);
}

// Helper: Calculate variant price
export function calculateVariantPrice(basePrice: number, variant: ProductVariant): number {
  if (variant.priceOverride !== undefined && variant.priceOverride !== null) {
    return variant.priceOverride;
  }
  return basePrice + (variant.priceDelta || 0);
}

// Initialize with sample data
export async function initializeSampleData() {
  const db = await getDB();
  const existingProducts = await db.getAll('products');
  const existingUsers = await db.getAll('users');
  
  if (existingProducts.length === 0) {
    // Categories
    const categories: Category[] = [
      { id: 'cat-1', name: 'Chips & Snacks' },
      { id: 'cat-2', name: 'Drinks' },
      { id: 'cat-3', name: 'Candy' },
    ];
    for (const cat of categories) {
      await db.add('categories', cat);
    }

    // Products with variants
    const sampleProducts: Product[] = [
      // Chips & Snacks
      {
        id: '1',
        name: 'Takis',
        description: 'Spicy rolled tortilla chips',
        category: 'Chips & Snacks',
        basePrice: 1.00,
        barcode: '101',
        variants: [
          { id: '1-std', priceDelta: 0, barcode: '101', stock: 100, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '2',
        name: 'Pringles',
        description: 'Stackable potato chips',
        category: 'Chips & Snacks',
        basePrice: 2.00,
        barcode: '102',
        variants: [
          { id: '2-std', priceDelta: 0, barcode: '102', stock: 75, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '3',
        name: 'Oreo',
        description: 'Chocolate sandwich cookies',
        category: 'Chips & Snacks',
        basePrice: 1.00,
        barcode: '103',
        variants: [
          { id: '3-std', priceDelta: 0, barcode: '103', stock: 120, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '4',
        name: 'Cookies (2 for $1)',
        description: 'Assorted cookies',
        category: 'Chips & Snacks',
        basePrice: 0.50,
        barcode: '104',
        variants: [
          { id: '4-std', priceDelta: 0, barcode: '104', stock: 200, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '5',
        name: 'Peanut',
        description: 'Roasted peanuts',
        category: 'Chips & Snacks',
        basePrice: 1.00,
        barcode: '105',
        variants: [
          { id: '5-std', priceDelta: 0, barcode: '105', stock: 80, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      // Drinks
      {
        id: '6',
        name: 'SunnyD',
        description: 'Orange citrus punch',
        category: 'Drinks',
        basePrice: 1.00,
        barcode: '201',
        variants: [
          { id: '6-std', priceDelta: 0, barcode: '201', stock: 90, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '7',
        name: 'Apple Juice',
        description: '100% apple juice',
        category: 'Drinks',
        basePrice: 1.00,
        barcode: '202',
        variants: [
          { id: '7-std', priceDelta: 0, barcode: '202', stock: 95, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '8',
        name: 'Small Juice',
        description: 'Small juice box',
        category: 'Drinks',
        basePrice: 1.00,
        barcode: '203',
        variants: [
          { id: '8-std', priceDelta: 0, barcode: '203', stock: 150, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '9',
        name: 'Payaso',
        description: 'Chocolate drink',
        category: 'Drinks',
        basePrice: 2.00,
        barcode: '204',
        variants: [
          { id: '9-std', priceDelta: 0, barcode: '204', stock: 60, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      // Candy
      {
        id: '10',
        name: 'Ring Pop',
        description: 'Lollipop ring candy',
        category: 'Candy',
        basePrice: 1.00,
        barcode: '301',
        variants: [
          { id: '10-std', priceDelta: 0, barcode: '301', stock: 110, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '11',
        name: 'Chocolate (2 for $1)',
        description: 'Chocolate candy bars',
        category: 'Candy',
        basePrice: 0.50,
        barcode: '302',
        variants: [
          { id: '11-std', priceDelta: 0, barcode: '302', stock: 180, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '12',
        name: 'Lollipop (2 for $1)',
        description: 'Assorted lollipops',
        category: 'Candy',
        basePrice: 0.50,
        barcode: '303',
        variants: [
          { id: '12-std', priceDelta: 0, barcode: '303', stock: 250, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    for (const product of sampleProducts) {
      await db.add('products', product);
    }

    // Settings
    const defaultSettings: Settings = {
      taxRateDefault: 0.08,
      storeName: 'Persona Store',
      storeEmail: 'store@persona.com',
      storePhone: '(555) 123-4567',
    };
    await db.put('settings', defaultSettings);

    // Seed some orders for reports
    const now = Date.now();
    const sampleOrders: Order[] = [
      {
        id: 'ORD-1',
        createdAt: now - 86400000 * 2, // 2 days ago
        subtotal: 83,
        discountTotal: 0,
        taxTotal: 6.64,
        total: 89.64,
        paymentMethod: 'Cash',
      },
      {
        id: 'ORD-2',
        createdAt: now - 86400000, // 1 day ago
        subtotal: 55,
        discountTotal: 0,
        taxTotal: 4.4,
        total: 59.4,
        paymentMethod: 'Card',
      },
      {
        id: 'ORD-3',
        createdAt: now - 3600000, // 1 hour ago
        subtotal: 30,
        discountTotal: 0,
        taxTotal: 2.4,
        total: 32.4,
        paymentMethod: 'Card',
      },
    ];

    const sampleOrderItems: OrderItem[] = [
      { id: 'OI-1', orderId: 'ORD-1', productId: '1', variantId: '1-m-black', nameSnapshot: 'Classic T-Shirt', size: 'M', color: 'Black', quantity: 2, unitPrice: 25, lineDiscount: 0, lineTotal: 50 },
      { id: 'OI-2', orderId: 'ORD-1', productId: '3', variantId: '3-standard', nameSnapshot: 'Logo Sticker Pack', quantity: 1, unitPrice: 8, lineDiscount: 0, lineTotal: 8 },
      { id: 'OI-3', orderId: 'ORD-1', productId: '1', variantId: '1-2xl-black', nameSnapshot: 'Classic T-Shirt', size: '2XL', color: 'Black', quantity: 1, unitPrice: 30, lineDiscount: 0, lineTotal: 30 },
      { id: 'OI-4', orderId: 'ORD-2', productId: '2', variantId: '2-l-grey', nameSnapshot: 'Premium Hoodie', size: 'L', color: 'Grey', quantity: 1, unitPrice: 55, lineDiscount: 0, lineTotal: 55 },
      { id: 'OI-5', orderId: 'ORD-3', productId: '1', variantId: '1-l-black', nameSnapshot: 'Classic T-Shirt', size: 'L', color: 'Black', quantity: 1, unitPrice: 25, lineDiscount: 0, lineTotal: 25 },
      { id: 'OI-6', orderId: 'ORD-3', productId: '6', variantId: '6-small', nameSnapshot: 'Die-Cut Stickers', size: 'Small', quantity: 1, unitPrice: 5, lineDiscount: 0, lineTotal: 5 },
    ];

    for (const order of sampleOrders) {
      await db.add('orders', order);
    }
    for (const item of sampleOrderItems) {
      await db.add('orderItems', item);
    }
  }

  // Seed admin data
  if (existingUsers.length === 0) {
    const { hashPassword } = await import('./db-operations');
    const { getSystemRolePermissions } = await import('./db-operations');
    
    // Create roles
    const adminRole = { id: 'role-admin', name: 'Admin', systemRole: 'admin' as const, permissions: getSystemRolePermissions('admin') };
    await db.add('roles', adminRole);
    
    // Create admin user
    const adminUser = {
      id: 'user-admin',
      email: 'admin@demo.local',
      passwordHash: await hashPassword('DemoPass!1'),
      name: 'Admin User',
      roleIds: ['role-admin'],
      status: 'active' as const,
      createdAt: Date.now()
    };
    await db.add('users', adminUser);

    // Seed services
    const services = [
      { id: 'svc-1', name: 'Simple PA System', category: 'Audio', description: 'Basic sound system setup', basePrice: 150, unitType: 'flat' as const, isActive: true, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'svc-2', name: 'Photography', category: 'Media', description: 'Professional photography service', basePrice: 200, unitType: 'hourly' as const, isActive: true, createdAt: Date.now(), updatedAt: Date.now() },
    ];
    for (const svc of services) await db.add('services', svc);

    // Seed customers
    const customers = [
      { id: 'cust-1', name: 'John Doe', email: 'john@example.com', notes: '', tags: ['VIP'], lifetimeValue: 450, lastOrderAt: Date.now() - 86400000, createdAt: Date.now(), updatedAt: Date.now() },
    ];
    for (const cust of customers) await db.add('customers', cust);
  }
}
