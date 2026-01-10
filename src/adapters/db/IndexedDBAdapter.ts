import { DBPort } from '../../core/ports/DBPort';
import * as db from '../../lib/db';
import * as dbOps from '../../lib/db-operations';
import type { Item, Variant, Category, Order, OrderItem, Customer, Service, User, Role, Settings, AuditLog, Quote } from '../../core/models';

export class IndexedDBAdapter implements DBPort {
  async initializeDatabase(): Promise<void> {
    await db.initializeSampleData();
  }

  // Items (mapped from Products)
  async getAllItems(): Promise<Item[]> {
    return db.getAllProducts();
  }

  async getItemById(id: string): Promise<Item | undefined> {
    return db.getProduct(id);
  }

  async createItem(item: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>): Promise<Item> {
    const newItem: Item = {
      ...item,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.addProduct(newItem);
    return newItem;
  }

  async updateItem(item: Item): Promise<void> {
    await db.updateProduct(item.id, item);
  }

  async deleteItem(id: string): Promise<void> {
    await db.deleteProduct(id);
  }

  // Variants (embedded in products)
  async getVariantsByItemId(itemId: string): Promise<Variant[]> {
    const product = await db.getProduct(itemId);
    return product?.variants || [];
  }

  async getVariantById(id: string): Promise<Variant | undefined> {
    const products = await db.getAllProducts();
    for (const product of products) {
      const variant = product.variants.find(v => v.id === id);
      if (variant) return variant;
    }
    return undefined;
  }

  async createVariant(variant: Omit<Variant, 'id'>): Promise<Variant> {
    // Variants are part of products in current schema
    throw new Error('Variants must be managed through product updates');
  }

  async updateVariant(variant: Variant): Promise<void> {
    // Variants are part of products in current schema
    throw new Error('Variants must be managed through product updates');
  }

  async deleteVariant(id: string): Promise<void> {
    // Variants are part of products in current schema
    throw new Error('Variants must be managed through product updates');
  }

  async deleteVariantsByItemId(itemId: string): Promise<void> {
    // Variants are part of products in current schema
    const product = await db.getProduct(itemId);
    if (product) {
      await db.updateProduct(itemId, { variants: [] });
    }
  }

  // Categories
  async getAllCategories(): Promise<Category[]> {
    return db.getAllCategories();
  }

  async getCategoryById(id: string): Promise<Category | undefined> {
    const categories = await db.getAllCategories();
    return categories.find(c => c.id === id);
  }

  async createCategory(category: Omit<Category, 'id'>): Promise<Category> {
    const newCategory: Category = { ...category, id: crypto.randomUUID() };
    await db.addCategory(newCategory);
    return newCategory;
  }

  async updateCategory(category: Category): Promise<void> {
    await db.addCategory(category); // IndexedDB put operation
  }

  async deleteCategory(id: string): Promise<void> {
    // Not implemented in current db.ts
    throw new Error('Delete category not implemented');
  }

  // Orders
  async getAllOrders(): Promise<Order[]> {
    return db.getAllOrders();
  }

  async getOrderById(id: string): Promise<Order | undefined> {
    const orders = await db.getAllOrders();
    return orders.find(o => o.id === id);
  }

  async createOrder(order: Omit<Order, 'id'>): Promise<Order> {
    const newOrder: Order = { ...order, id: crypto.randomUUID() };
    await db.addOrder(newOrder);
    return newOrder;
  }

  async updateOrder(order: Order): Promise<void> {
    await db.addOrder(order); // IndexedDB put operation
  }

  async deleteOrder(id: string): Promise<void> {
    // Not implemented in current db.ts
    throw new Error('Delete order not implemented');
  }

  // Order Items
  async getOrderItemsByOrderId(orderId: string): Promise<OrderItem[]> {
    return db.getOrderItems(orderId);
  }

  async createOrderItem(orderItem: Omit<OrderItem, 'id'>): Promise<OrderItem> {
    const newItem: OrderItem = { ...orderItem, id: crypto.randomUUID() };
    await db.addOrderItem(newItem);
    return newItem;
  }

  async deleteOrderItemsByOrderId(orderId: string): Promise<void> {
    // Not implemented in current db.ts
    throw new Error('Delete order items not implemented');
  }

  // Customers
  async getAllCustomers(): Promise<Customer[]> {
    return dbOps.getAllCustomers();
  }

  async getCustomerById(id: string): Promise<Customer | undefined> {
    return dbOps.getCustomer(id);
  }

  async getCustomerByEmail(email: string): Promise<Customer | undefined> {
    return dbOps.getCustomerByEmail(email);
  }

  async getCustomerByPhone(phone: string): Promise<Customer | undefined> {
    const customers = await dbOps.getAllCustomers();
    return customers.find(c => c.phone === phone);
  }

  async createCustomer(customer: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>): Promise<Customer> {
    return dbOps.createCustomer(customer);
  }

  async updateCustomer(customer: Customer): Promise<void> {
    return dbOps.updateCustomer(customer);
  }

  async deleteCustomer(id: string): Promise<void> {
    return dbOps.deleteCustomer(id);
  }

  // Services
  async getAllServices(): Promise<Service[]> {
    return dbOps.getAllServices();
  }

  async getServiceById(id: string): Promise<Service | undefined> {
    return dbOps.getService(id);
  }

  async createService(service: Omit<Service, 'id' | 'createdAt' | 'updatedAt'>): Promise<Service> {
    return dbOps.createService(service);
  }

  async updateService(service: Service): Promise<void> {
    return dbOps.updateService(service);
  }

  async deleteService(id: string): Promise<void> {
    return dbOps.deleteService(id);
  }

  // Users
  async getAllUsers(): Promise<User[]> {
    return dbOps.getAllUsers();
  }

  async getUserById(id: string): Promise<User | undefined> {
    return dbOps.getUser(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return dbOps.getUserByEmail(email);
  }

  async createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    return dbOps.createUser(user);
  }

  async updateUser(user: User): Promise<void> {
    return dbOps.updateUser(user);
  }

  async deleteUser(id: string): Promise<void> {
    return dbOps.deleteUser(id);
  }

  // Roles
  async getAllRoles(): Promise<Role[]> {
    return dbOps.getAllRoles();
  }

  async getRoleById(id: string): Promise<Role | undefined> {
    return dbOps.getRole(id);
  }

  async createRole(role: Omit<Role, 'id'>): Promise<Role> {
    return dbOps.createRole(role);
  }

  async updateRole(role: Role): Promise<void> {
    return dbOps.updateRole(role);
  }

  async deleteRole(id: string): Promise<void> {
    return dbOps.deleteRole(id);
  }

  // Settings
  async getSettings(): Promise<Settings> {
    return db.getSettings();
  }

  async updateSettings(settings: Partial<Settings>): Promise<void> {
    const current = await db.getSettings();
    await db.saveSettings({ ...current, ...settings });
  }

  // Audit Logs
  async createAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog> {
    return dbOps.createAuditLog(log);
  }

  async getAuditLogs(filters?: { startDate?: Date; endDate?: Date; userId?: string; action?: string }): Promise<AuditLog[]> {
    let logs = await dbOps.getAllAuditLogs();
    if (filters) {
      if (filters.startDate || filters.endDate) {
        const start = filters.startDate?.getTime() || 0;
        const end = filters.endDate?.getTime() || Date.now();
        logs = logs.filter(log => log.timestamp >= start && log.timestamp <= end);
      }
      if (filters.userId) logs = logs.filter(log => log.userId === filters.userId);
      if (filters.action) logs = logs.filter(log => log.action === filters.action);
    }
    return logs;
  }

  // Quotes
  async getAllQuotes(): Promise<Quote[]> {
    return dbOps.getAllQuotes();
  }

  async getQuoteById(id: string): Promise<Quote | undefined> {
    return dbOps.getQuote(id);
  }

  async createQuote(quote: Omit<Quote, 'id' | 'createdAt'>): Promise<Quote> {
    return dbOps.createQuote(quote);
  }

  async updateQuote(quote: Quote): Promise<void> {
    return dbOps.updateQuote(quote);
  }

  async deleteQuote(id: string): Promise<void> {
    return dbOps.deleteQuote(id);
  }
}
