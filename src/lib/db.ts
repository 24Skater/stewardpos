import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface ProductVariant {
  id: string;
  size?: string;
  color?: string;
  price: number;
  sku?: string;
  stock: number;
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
}

export interface Transaction {
  id: string;
  items: CartItem[];
  total: number;
  customerEmail?: string;
  customerPhone?: string;
  timestamp: number;
  paymentMethod?: string;
}

interface PersonaPOSDB extends DBSchema {
  products: {
    key: string;
    value: Product;
    indexes: { 'by-category': string; 'by-barcode': string };
  };
  transactions: {
    key: string;
    value: Transaction;
    indexes: { 'by-date': number };
  };
}

let dbInstance: IDBPDatabase<PersonaPOSDB> | null = null;

export async function getDB() {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<PersonaPOSDB>('persona-pos', 1, {
    upgrade(db) {
      // Products store
      const productStore = db.createObjectStore('products', { keyPath: 'id' });
      productStore.createIndex('by-category', 'category');
      productStore.createIndex('by-barcode', 'barcode');

      // Transactions store
      const transactionStore = db.createObjectStore('transactions', { keyPath: 'id' });
      transactionStore.createIndex('by-date', 'timestamp');
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

// Transaction operations
export async function addTransaction(transaction: Transaction) {
  const db = await getDB();
  await db.add('transactions', transaction);
}

export async function getAllTransactions() {
  const db = await getDB();
  return db.getAll('transactions');
}

export async function getTransactionsByDateRange(startDate: number, endDate: number) {
  const db = await getDB();
  const allTransactions = await db.getAll('transactions');
  return allTransactions.filter(t => t.timestamp >= startDate && t.timestamp <= endDate);
}

// Initialize with sample data
export async function initializeSampleData() {
  const db = await getDB();
  const existingProducts = await db.getAll('products');
  
  if (existingProducts.length === 0) {
    const sampleProducts: Product[] = [
      {
        id: '1',
        name: 'Classic T-Shirt',
        description: 'Comfortable cotton t-shirt',
        category: 'Apparel',
        basePrice: 25,
        barcode: '1234567890123',
        variants: [
          { id: '1-s-black', size: 'S', color: 'Black', price: 25, sku: 'TSH-S-BLK', stock: 50 },
          { id: '1-m-black', size: 'M', color: 'Black', price: 25, sku: 'TSH-M-BLK', stock: 100 },
          { id: '1-l-black', size: 'L', color: 'Black', price: 25, sku: 'TSH-L-BLK', stock: 75 },
          { id: '1-xl-black', size: 'XL', color: 'Black', price: 30, sku: 'TSH-XL-BLK', stock: 40 },
          { id: '1-2xl-black', size: '2XL', color: 'Black', price: 35, sku: 'TSH-2XL-BLK', stock: 25 },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '2',
        name: 'Coffee Mug',
        description: 'Ceramic coffee mug',
        category: 'Accessories',
        basePrice: 15,
        barcode: '1234567890124',
        variants: [
          { id: '2-white', color: 'White', price: 15, sku: 'MUG-WHT', stock: 100 },
          { id: '2-black', color: 'Black', price: 15, sku: 'MUG-BLK', stock: 80 },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '3',
        name: 'Hoodie',
        description: 'Premium cotton hoodie',
        category: 'Apparel',
        basePrice: 55,
        barcode: '1234567890125',
        variants: [
          { id: '3-m-grey', size: 'M', color: 'Grey', price: 55, sku: 'HOD-M-GRY', stock: 30 },
          { id: '3-l-grey', size: 'L', color: 'Grey', price: 55, sku: 'HOD-L-GRY', stock: 40 },
          { id: '3-xl-grey', size: 'XL', color: 'Grey', price: 60, sku: 'HOD-XL-GRY', stock: 25 },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    for (const product of sampleProducts) {
      await db.add('products', product);
    }
  }
}
