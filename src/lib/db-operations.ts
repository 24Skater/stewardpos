import { getDB, User, Role, AuditLog, Service, Customer, Quote, RolePermissions, AppRole } from './db';
import bcrypt from 'bcryptjs';

// ===== User Operations =====
export async function createUser(user: Omit<User, 'id' | 'createdAt'>) {
  const db = await getDB();
  const id = crypto.randomUUID();
  const newUser: User = { ...user, id, createdAt: Date.now() };
  await db.add('users', newUser);
  return newUser;
}

export async function updateUser(user: User) {
  const db = await getDB();
  await db.put('users', user);
}

export async function deleteUser(id: string) {
  const db = await getDB();
  await db.delete('users', id);
}

export async function getUser(id: string) {
  const db = await getDB();
  return db.get('users', id);
}

export async function getUserByEmail(email: string) {
  const db = await getDB();
  const users = await db.getAllFromIndex('users', 'by-email', email);
  return users[0];
}

export async function getAllUsers() {
  const db = await getDB();
  return db.getAll('users');
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ===== Role Operations =====
export async function createRole(role: Omit<Role, 'id'>) {
  const db = await getDB();
  const id = crypto.randomUUID();
  const newRole: Role = { ...role, id };
  await db.add('roles', newRole);
  return newRole;
}

export async function updateRole(role: Role) {
  const db = await getDB();
  await db.put('roles', role);
}

export async function deleteRole(id: string) {
  const db = await getDB();
  await db.delete('roles', id);
}

export async function getRole(id: string) {
  const db = await getDB();
  return db.get('roles', id);
}

export async function getAllRoles() {
  const db = await getDB();
  return db.getAll('roles');
}

// ===== Audit Log Operations =====
export async function createAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>) {
  const db = await getDB();
  const id = crypto.randomUUID();
  const newLog: AuditLog = { ...log, id, timestamp: Date.now() };
  await db.add('auditLogs', newLog);
  return newLog;
}

export async function getAllAuditLogs() {
  const db = await getDB();
  return db.getAll('auditLogs');
}

export async function getAuditLogsByUser(userId: string) {
  const db = await getDB();
  return db.getAllFromIndex('auditLogs', 'by-user', userId);
}

export async function getAuditLogsByDateRange(startDate: number, endDate: number) {
  const db = await getDB();
  const allLogs = await db.getAll('auditLogs');
  return allLogs.filter(log => log.timestamp >= startDate && log.timestamp <= endDate);
}

// ===== Service Operations =====
export async function createService(service: Omit<Service, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDB();
  const id = crypto.randomUUID();
  const now = Date.now();
  const newService: Service = { ...service, id, createdAt: now, updatedAt: now };
  await db.add('services', newService);
  return newService;
}

export async function updateService(service: Service) {
  const db = await getDB();
  await db.put('services', { ...service, updatedAt: Date.now() });
}

export async function deleteService(id: string) {
  const db = await getDB();
  await db.delete('services', id);
}

export async function getService(id: string) {
  const db = await getDB();
  return db.get('services', id);
}

export async function getAllServices() {
  const db = await getDB();
  return db.getAll('services');
}

export async function getServicesByCategory(category: string) {
  const db = await getDB();
  return db.getAllFromIndex('services', 'by-category', category);
}

// ===== Customer Operations =====
export async function createCustomer(customer: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDB();
  const id = crypto.randomUUID();
  const now = Date.now();
  const newCustomer: Customer = { ...customer, id, createdAt: now, updatedAt: now };
  await db.add('customers', newCustomer);
  return newCustomer;
}

export async function updateCustomer(customer: Customer) {
  const db = await getDB();
  await db.put('customers', { ...customer, updatedAt: Date.now() });
}

export async function deleteCustomer(id: string) {
  const db = await getDB();
  await db.delete('customers', id);
}

export async function getCustomer(id: string) {
  const db = await getDB();
  return db.get('customers', id);
}

export async function getAllCustomers() {
  const db = await getDB();
  return db.getAll('customers');
}

export async function getCustomerByEmail(email: string) {
  const db = await getDB();
  const customers = await db.getAllFromIndex('customers', 'by-email', email);
  return customers[0];
}

// ===== Quote Operations =====
export async function createQuote(quote: Omit<Quote, 'id' | 'createdAt' | 'updatedAt'>) {
  const db = await getDB();
  const id = crypto.randomUUID();
  const now = Date.now();
  const newQuote: Quote = { ...quote, id, createdAt: now, updatedAt: now };
  await db.add('quotes', newQuote);
  return newQuote;
}

export async function updateQuote(quote: Quote) {
  const db = await getDB();
  await db.put('quotes', { ...quote, updatedAt: Date.now() });
}

export async function deleteQuote(id: string) {
  const db = await getDB();
  await db.delete('quotes', id);
}

export async function getQuote(id: string) {
  const db = await getDB();
  return db.get('quotes', id);
}

export async function getAllQuotes() {
  const db = await getDB();
  return db.getAll('quotes');
}

export async function getQuotesByCustomer(customerId: string) {
  const db = await getDB();
  return db.getAllFromIndex('quotes', 'by-customer', customerId);
}

export async function getQuotesByStatus(status: Quote['status']) {
  const db = await getDB();
  return db.getAllFromIndex('quotes', 'by-status', status);
}

// ===== Helper Functions =====
export function getDefaultPermissions(): RolePermissions {
  return {
    inventory: { read: false, write: false, delete: false },
    reports: { read: false, write: false, delete: false },
    exports: { read: false, write: false, delete: false },
    settings: { read: false, write: false, delete: false },
    users: { read: false, write: false, delete: false },
    services: { read: false, write: false, delete: false },
    customers: { read: false, write: false, delete: false },
  };
}

export function getSystemRolePermissions(role: AppRole): RolePermissions {
  switch (role) {
    case 'admin':
      return {
        inventory: { read: true, write: true, delete: true },
        reports: { read: true, write: true, delete: true },
        exports: { read: true, write: true, delete: true },
        settings: { read: true, write: true, delete: true },
        users: { read: true, write: true, delete: true },
        services: { read: true, write: true, delete: true },
        customers: { read: true, write: true, delete: true },
      };
    case 'supervisor':
      return {
        inventory: { read: true, write: true, delete: true },
        reports: { read: true, write: false, delete: false },
        exports: { read: true, write: false, delete: false },
        settings: { read: true, write: false, delete: false },
        users: { read: true, write: false, delete: false },
        services: { read: true, write: true, delete: true },
        customers: { read: true, write: true, delete: true },
      };
    case 'reporter':
      return {
        inventory: { read: true, write: false, delete: false },
        reports: { read: true, write: false, delete: false },
        exports: { read: true, write: false, delete: false },
        settings: { read: false, write: false, delete: false },
        users: { read: false, write: false, delete: false },
        services: { read: true, write: false, delete: false },
        customers: { read: true, write: false, delete: false },
      };
    case 'standard':
      return {
        inventory: { read: true, write: false, delete: false },
        reports: { read: false, write: false, delete: false },
        exports: { read: false, write: false, delete: false },
        settings: { read: false, write: false, delete: false },
        users: { read: false, write: false, delete: false },
        services: { read: false, write: false, delete: false },
        customers: { read: false, write: false, delete: false },
      };
  }
}
