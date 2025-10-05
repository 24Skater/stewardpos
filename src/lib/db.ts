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
}

let dbInstance: IDBPDatabase<PersonaPOSDB> | null = null;

export async function getDB() {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<PersonaPOSDB>('persona-pos', 2, {
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
  
  if (existingProducts.length === 0) {
    // Categories
    const categories: Category[] = [
      { id: 'cat-1', name: 'Tees' },
      { id: 'cat-2', name: 'Hoodies' },
      { id: 'cat-3', name: 'Stickers' },
    ];
    for (const cat of categories) {
      await db.add('categories', cat);
    }

    // Products with variants
    const sampleProducts: Product[] = [
      {
        id: '1',
        name: 'Classic T-Shirt',
        description: 'Comfortable cotton t-shirt',
        category: 'Tees',
        basePrice: 25,
        barcode: '1234567890123',
        variants: [
          { id: '1-s-black', size: 'S', color: 'Black', priceDelta: 0, barcode: 'TSH-S-BLK', stock: 50, enabled: true },
          { id: '1-m-black', size: 'M', color: 'Black', priceDelta: 0, barcode: 'TSH-M-BLK', stock: 100, enabled: true },
          { id: '1-l-black', size: 'L', color: 'Black', priceDelta: 0, barcode: 'TSH-L-BLK', stock: 75, enabled: true },
          { id: '1-xl-black', size: 'XL', color: 'Black', priceDelta: 0, barcode: 'TSH-XL-BLK', stock: 40, enabled: true },
          { id: '1-2xl-black', size: '2XL', color: 'Black', priceDelta: 5, barcode: 'TSH-2XL-BLK', stock: 25, enabled: true },
          { id: '1-s-white', size: 'S', color: 'White', priceDelta: 0, barcode: 'TSH-S-WHT', stock: 45, enabled: true },
          { id: '1-m-white', size: 'M', color: 'White', priceDelta: 0, barcode: 'TSH-M-WHT', stock: 90, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '2',
        name: 'Premium Hoodie',
        description: 'Soft fleece hoodie',
        category: 'Hoodies',
        basePrice: 55,
        barcode: '1234567890125',
        variants: [
          { id: '2-m-grey', size: 'M', color: 'Grey', priceDelta: 0, barcode: 'HOD-M-GRY', stock: 30, enabled: true },
          { id: '2-l-grey', size: 'L', color: 'Grey', priceDelta: 0, barcode: 'HOD-L-GRY', stock: 40, enabled: true },
          { id: '2-xl-grey', size: 'XL', color: 'Grey', priceDelta: 0, barcode: 'HOD-XL-GRY', stock: 25, enabled: true },
          { id: '2-2xl-grey', size: '2XL', color: 'Grey', priceDelta: 5, barcode: 'HOD-2XL-GRY', stock: 15, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '3',
        name: 'Logo Sticker Pack',
        description: '5 vinyl stickers',
        category: 'Stickers',
        basePrice: 8,
        barcode: '1234567890126',
        variants: [
          { id: '3-standard', priceDelta: 0, barcode: 'STICK-STD', stock: 200, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '4',
        name: 'Vintage Tee',
        description: 'Retro design t-shirt',
        category: 'Tees',
        basePrice: 28,
        variants: [
          { id: '4-m-navy', size: 'M', color: 'Navy', priceDelta: 0, stock: 60, enabled: true },
          { id: '4-l-navy', size: 'L', color: 'Navy', priceDelta: 0, stock: 50, enabled: true },
          { id: '4-2xl-navy', size: '2XL', color: 'Navy', priceDelta: 5, stock: 20, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '5',
        name: 'Zip-Up Hoodie',
        description: 'Full zip hoodie',
        category: 'Hoodies',
        basePrice: 65,
        variants: [
          { id: '5-l-black', size: 'L', color: 'Black', priceDelta: 0, stock: 35, enabled: true },
          { id: '5-xl-black', size: 'XL', color: 'Black', priceDelta: 0, stock: 30, enabled: true },
          { id: '5-2xl-black', size: '2XL', color: 'Black', priceDelta: 5, stock: 18, enabled: true },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '6',
        name: 'Die-Cut Stickers',
        description: 'Custom shape stickers',
        category: 'Stickers',
        basePrice: 5,
        variants: [
          { id: '6-small', size: 'Small', priceDelta: 0, stock: 150, enabled: true },
          { id: '6-large', size: 'Large', priceDelta: 2, stock: 100, enabled: true },
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
}
