import { Item, Variant, Category, Order, OrderItem, Customer, Service, User, Role, Settings, AuditLog, Quote } from '../models';

export interface DBPort {
  // Items
  getAllItems(): Promise<Item[]>;
  getItemById(id: string): Promise<Item | undefined>;
  createItem(item: Omit<Item, 'id' | 'createdAt' | 'updatedAt'>): Promise<Item>;
  updateItem(item: Item): Promise<void>;
  deleteItem(id: string): Promise<void>;

  // Variants
  getVariantsByItemId(itemId: string): Promise<Variant[]>;
  getVariantById(id: string): Promise<Variant | undefined>;
  createVariant(variant: Omit<Variant, 'id'>): Promise<Variant>;
  updateVariant(variant: Variant): Promise<void>;
  deleteVariant(id: string): Promise<void>;
  deleteVariantsByItemId(itemId: string): Promise<void>;

  // Categories
  getAllCategories(): Promise<Category[]>;
  getCategoryById(id: string): Promise<Category | undefined>;
  createCategory(category: Omit<Category, 'id'>): Promise<Category>;
  updateCategory(category: Category): Promise<void>;
  deleteCategory(id: string): Promise<void>;

  // Orders
  getAllOrders(): Promise<Order[]>;
  getOrderById(id: string): Promise<Order | undefined>;
  createOrder(order: Omit<Order, 'id'>): Promise<Order>;
  updateOrder(order: Order): Promise<void>;
  deleteOrder(id: string): Promise<void>;

  // Order Items
  getOrderItemsByOrderId(orderId: string): Promise<OrderItem[]>;
  createOrderItem(orderItem: Omit<OrderItem, 'id'>): Promise<OrderItem>;
  deleteOrderItemsByOrderId(orderId: string): Promise<void>;

  // Customers
  getAllCustomers(): Promise<Customer[]>;
  getCustomerById(id: string): Promise<Customer | undefined>;
  getCustomerByEmail(email: string): Promise<Customer | undefined>;
  getCustomerByPhone(phone: string): Promise<Customer | undefined>;
  createCustomer(customer: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>): Promise<Customer>;
  updateCustomer(customer: Customer): Promise<void>;
  deleteCustomer(id: string): Promise<void>;

  // Services
  getAllServices(): Promise<Service[]>;
  getServiceById(id: string): Promise<Service | undefined>;
  createService(service: Omit<Service, 'id' | 'createdAt' | 'updatedAt'>): Promise<Service>;
  updateService(service: Service): Promise<void>;
  deleteService(id: string): Promise<void>;

  // Users
  getAllUsers(): Promise<User[]>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User>;
  updateUser(user: User): Promise<void>;
  deleteUser(id: string): Promise<void>;

  // Roles
  getAllRoles(): Promise<Role[]>;
  getRoleById(id: string): Promise<Role | undefined>;
  createRole(role: Omit<Role, 'id'>): Promise<Role>;
  updateRole(role: Role): Promise<void>;
  deleteRole(id: string): Promise<void>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(settings: Partial<Settings>): Promise<void>;

  // Audit Logs
  createAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog>;
  getAuditLogs(filters?: { startDate?: Date; endDate?: Date; userId?: string; action?: string }): Promise<AuditLog[]>;

  // Quotes
  getAllQuotes(): Promise<Quote[]>;
  getQuoteById(id: string): Promise<Quote | undefined>;
  createQuote(quote: Omit<Quote, 'id' | 'createdAt'>): Promise<Quote>;
  updateQuote(quote: Quote): Promise<void>;
  deleteQuote(id: string): Promise<void>;

  // Utility
  initializeDatabase(): Promise<void>;
}
