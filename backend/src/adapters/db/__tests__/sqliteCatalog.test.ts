import { expect, it } from 'vitest';
import { describeSqlite, seedProduct, seedUser, useFreshSqlite } from './sqliteHarness';

/**
 * Products, variants, categories, services and customers on SQLite — the
 * Postgres integration suites (catalog, categories, productWrites,
 * permanentDelete, archivalPayments) are the spec; this mirrors them.
 */

describeSqlite('products on SQLite', () => {
  const h = useFreshSqlite();

  it('writes a product and its nested variants together', async () => {
    const created = await h.adapter.createProduct({
      name: 'Mug',
      category: 'Kitchen',
      basePrice: 12.5,
      barcode: '111',
      variants: [
        { size: 'S', sku: 'MUG-S', stock: 3 },
        { size: 'L', sku: 'MUG-L', stock: 0, enabled: false, priceDelta: 2 },
      ],
    });

    expect(created).toMatchObject({ name: 'Mug', basePrice: 12.5, barcode: '111' });
    expect(created.variants).toHaveLength(2);
    expect((created.variants as Record<string, unknown>[])[1]).toMatchObject({
      enabled: false,
      priceDelta: 2,
      stock: 0,
    });
  });

  it('creates a product with no variants at all', async () => {
    const created = await h.adapter.createProduct({ name: 'Gift Card', category: 'Misc', basePrice: 0 });

    expect(created.variants).toEqual([]);
    expect((await h.adapter.getProductById(String(created.id)))!.variants).toEqual([]);
  });

  it('wraps a constraint failure as a DatabaseError', async () => {
    // category is NOT NULL.
    await expect(h.adapter.createProduct({ name: 'No Category', basePrice: 1 })).rejects.toThrow(
      'Failed to create product'
    );
  });

  it('COALESCEs an update: changing the price leaves the description and barcode alone', async () => {
    const created = await h.adapter.createProduct({
      name: 'Tea',
      description: 'Loose leaf',
      category: 'Drinks',
      basePrice: 4,
      barcode: '999',
    });

    const updated = await h.adapter.updateProduct(String(created.id), { basePrice: 4.75 });

    expect(updated).toMatchObject({ basePrice: 4.75, description: 'Loose leaf', barcode: '999' });
  });

  it('returns null when updating a product that does not exist', async () => {
    expect(await h.adapter.updateProduct('nope', { name: 'x' })).toBeNull();
  });

  it('deletes a product and cascades its variants', async () => {
    const { productId } = await seedProduct(h.adapter, 'Doomed');

    expect(await h.adapter.deleteProduct(productId)).toBe(true);
    expect(await h.adapter.deleteProduct(productId)).toBe(false);
    expect(await h.adapter.getProductById(productId)).toBeNull();
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM product_variants WHERE product_id = ?').get(productId)).toEqual({ n: 0 });
  });

  it('pages with OFFSET alone, using SQLite’s LIMIT -1', async () => {
    await seedProduct(h.adapter, 'A');
    await seedProduct(h.adapter, 'B');
    await seedProduct(h.adapter, 'C');

    const { products, total } = await h.adapter.getAllProducts({ offset: 1 });

    expect(total).toBe(3);
    expect(products.map((p) => p.name)).toEqual(['B', 'C']);
  });

  it('pages with LIMIT and OFFSET without repeating a row', async () => {
    await seedProduct(h.adapter, 'A');
    await seedProduct(h.adapter, 'B');
    await seedProduct(h.adapter, 'C');

    const first = await h.adapter.getAllProducts({ limit: 2, offset: 0 });
    const second = await h.adapter.getAllProducts({ limit: 2, offset: 2 });

    expect([...first.products, ...second.products].map((p) => p.name)).toEqual(['A', 'B', 'C']);
  });

  it('matches a variant barcode', async () => {
    const { productId } = await seedProduct(h.adapter, 'Scarf');
    await h.adapter.createVariant(productId, { sku: 'SC-2', barcode: '777001' });

    const { products } = await h.adapter.getAllProducts({ q: '777001' });

    expect(products.map((p) => p.id)).toEqual([productId]);
  });
});

describeSqlite('variants on SQLite', () => {
  const h = useFreshSqlite();

  it('returns null when creating a variant on a product that does not exist', async () => {
    expect(await h.adapter.createVariant('missing', { sku: 'X' })).toBeNull();
  });

  it('returns null when updating a variant through the wrong product', async () => {
    const a = await seedProduct(h.adapter, 'A');
    const b = await seedProduct(h.adapter, 'B');

    expect(await h.adapter.updateVariant(b.productId, a.variantId, { stock: 1 })).toBeNull();
  });

  it('disables a variant through updateVariant', async () => {
    const { productId, variantId } = await seedProduct(h.adapter, 'A');

    const updated = await h.adapter.updateVariant(productId, variantId, { enabled: false });

    expect(updated).toMatchObject({ enabled: false });
  });

  it('refuses to delete the last variant, and reports an unknown one as not found', async () => {
    const { productId, variantId } = await seedProduct(h.adapter, 'Solo');

    expect(await h.adapter.deleteVariant(productId, variantId)).toBe('last');
    expect(await h.adapter.deleteVariant(productId, 'other')).toBe('not_found');
  });

  it('deletes one of several variants', async () => {
    const { productId, variantId } = await seedProduct(h.adapter, 'Duo');
    await h.adapter.createVariant(productId, { sku: 'DUO-2' });

    expect(await h.adapter.deleteVariant(productId, variantId)).toBe('deleted');
    expect(await h.adapter.deleteVariant(productId, variantId)).toBe('not_found');
  });

  it('reports low stock by shortfall, honouring overrides and skipping disabled variants', async () => {
    const { productId } = await seedProduct(h.adapter, 'Beans', 50);
    const atDefault = await h.adapter.createVariant(productId, { sku: 'B-1', stock: 5 });
    const override = await h.adapter.createVariant(productId, { sku: 'B-2', stock: 15, lowStockThreshold: 20 });
    await h.adapter.createVariant(productId, { sku: 'B-3', stock: 0, enabled: false });

    const low = await h.adapter.getLowStockVariants(10);

    // B-2 is 5 short of its own threshold, B-1 5 short of the default: tie, then name.
    expect(low.map((v) => v.sku).sort()).toEqual(['B-1', 'B-2']);
    expect(low.find((v) => v.id === override!.id)).toMatchObject({ threshold: 20, productName: 'Beans' });
    expect(low.find((v) => v.id === atDefault!.id)).toMatchObject({ threshold: 10 });
  });
});

describeSqlite('categories on SQLite', () => {
  const h = useFreshSqlite();

  it('refuses a duplicate name case-insensitively', async () => {
    expect(await h.adapter.createCategory('Drinks', '☕')).toMatchObject({ name: 'Drinks', productCount: 0 });
    expect(await h.adapter.createCategory('drinks', null)).toBeNull();
  });

  it('counts the products in each, and reports names no category defines', async () => {
    await h.adapter.createCategory('General', null);
    await seedProduct(h.adapter, 'A');
    await h.adapter.createProduct({ name: 'Orphan', category: 'Ghost', basePrice: 1 });

    const all = await h.adapter.getAllCategories();
    const unmanaged = await h.adapter.getUnmanagedCategories();

    expect(all).toEqual([expect.objectContaining({ name: 'General', productCount: 1 })]);
    expect(unmanaged).toEqual([{ name: 'Ghost', productCount: 1 }]);
  });

  it('renames a category and moves its products with it', async () => {
    const cat = await h.adapter.createCategory('General', 'box');
    await seedProduct(h.adapter, 'A');

    const renamed = await h.adapter.renameCategory(String(cat!.id), 'Everyday', undefined);

    expect(renamed).toMatchObject({ name: 'Everyday', productCount: 1 });
    expect((await h.adapter.getAllProducts({ category: 'General' })).total).toBe(0);
    expect((await h.adapter.getAllProducts({ category: 'Everyday' })).total).toBe(1);
  });

  it('refuses a rename onto another category’s name and reports a missing one as null', async () => {
    const a = await h.adapter.createCategory('A', null);
    await h.adapter.createCategory('B', null);

    expect(await h.adapter.renameCategory(String(a!.id), 'b', null)).toBe('duplicate');
    expect(await h.adapter.renameCategory('missing', 'C', null)).toBeNull();
  });

  it('deletes an empty one and refuses one still in use', async () => {
    const empty = await h.adapter.createCategory('Empty', null);
    const used = await h.adapter.createCategory('General', null);
    await seedProduct(h.adapter, 'A');

    expect(await h.adapter.deleteCategory(String(empty!.id))).toBe('deleted');
    expect(await h.adapter.deleteCategory(String(used!.id))).toEqual({ inUse: 1 });
    expect(await h.adapter.deleteCategory('missing')).toBe('not_found');
  });

  it('reassigns products on delete, refusing a missing target or itself', async () => {
    const general = await h.adapter.createCategory('General', null);
    await h.adapter.createCategory('Other', null);
    await seedProduct(h.adapter, 'A');

    expect(await h.adapter.deleteCategory(String(general!.id), 'Nowhere')).toBe('bad_target');
    expect(await h.adapter.deleteCategory(String(general!.id), 'general')).toBe('bad_target');
    expect(await h.adapter.deleteCategory(String(general!.id), 'other')).toBe('deleted');
    expect((await h.adapter.getAllProducts({ category: 'Other' })).total).toBe(1);
  });
});

describeSqlite('services on SQLite', () => {
  const h = useFreshSqlite();

  it('creates, reads, partially updates and deletes a service', async () => {
    const created = await h.adapter.createService({ name: 'Repair', category: 'Labour', basePrice: 40 });

    expect(created).toMatchObject({ unitType: 'flat', isActive: true, basePrice: 40 });

    const id = String(created.id);
    const updated = await h.adapter.updateService(id, { isActive: false, basePrice: 45 });
    expect(updated).toMatchObject({ name: 'Repair', isActive: false, basePrice: 45 });
    expect(await h.adapter.getServiceById(id)).toMatchObject({ isActive: false });
    expect(await h.adapter.getAllServices()).toHaveLength(1);

    expect(await h.adapter.deleteService(id)).toBe(true);
    expect(await h.adapter.getServiceById(id)).toBeNull();
    expect(await h.adapter.updateService(id, { name: 'x' })).toBeNull();
    expect(await h.adapter.deleteService(id)).toBe(false);
  });

  it('wraps a constraint failure as a DatabaseError', async () => {
    await expect(h.adapter.createService({ name: 'No category' })).rejects.toThrow('Failed to create service');
  });
});

describeSqlite('customers on SQLite', () => {
  const h = useFreshSqlite();

  const ada = { name: 'Ada', email: 'ada@example.com', phone: '555', city: 'London', notes: 'vip' };

  it('creates, lists, reads and COALESCE-updates a customer', async () => {
    const created = await h.adapter.createCustomer(ada);
    await h.adapter.createCustomer({ name: 'Bob' });
    const id = String(created.id);

    const updated = await h.adapter.updateCustomer(id, { phone: '556' });

    expect(updated).toMatchObject({ name: 'Ada', phone: '556', city: 'London', notes: 'vip' });
    expect((await h.adapter.getAllCustomers()).map((c) => c.name)).toEqual(['Ada', 'Bob']);
    expect(await h.adapter.getCustomerById(id)).toMatchObject({ email: 'ada@example.com', tags: [] });
    expect(await h.adapter.getCustomerById('missing')).toBeNull();
    expect(await h.adapter.updateCustomer('missing', { name: 'x' })).toBeNull();
  });

  it('deletes a customer', async () => {
    const id = String((await h.adapter.createCustomer(ada)).id);

    expect(await h.adapter.deleteCustomer(id)).toBe(true);
    expect(await h.adapter.deleteCustomer(id)).toBe(false);
  });

  it('wraps a constraint failure as a DatabaseError', async () => {
    await expect(h.adapter.createCustomer({ email: 'no-name@example.com' })).rejects.toThrow(
      'Failed to create customer'
    );
  });

  it('reports false when archiving a customer that does not exist', async () => {
    expect(await h.adapter.archiveCustomer('missing', 'admin')).toBe(false);
  });

  // BUG (SQLite): archiveCustomer selects `FROM orders WHERE customer_id = ?`,
  // but SQLite's `orders` has no `customer_id` column (orders link to a
  // customer by `customer_email`), so every archive of an existing customer
  // throws "no such column: customer_id" and is reported as
  // DatabaseError('Failed to archive customer').
  it.fails('archives an existing customer into archived_customers', async () => {
    const id = String((await h.adapter.createCustomer(ada)).id);
    const admin = await seedUser(h.adapter, 'admin@example.com');

    expect(await h.adapter.archiveCustomer(id, admin, 'moved away')).toBe(true);
    expect(await h.adapter.getCustomerById(id)).toBeNull();
    expect(h.db.prepare('SELECT archive_reason FROM archived_customers WHERE id = ?').get(id)).toEqual({
      archive_reason: 'moved away',
    });
  });

  it('permanently deletes a customer with their orders, credits and quotes, and nobody else’s', async () => {
    const id = String((await h.adapter.createCustomer(ada)).id);
    const other = String((await h.adapter.createCustomer({ name: 'Bob', email: 'bob@example.com' })).id);
    const theirs = await h.adapter.createOrder({ subtotal: 5, total: 5, paymentMethod: 'Cash', customerEmail: ada.email });
    const bobs = await h.adapter.createOrder({ subtotal: 7, total: 7, paymentMethod: 'Cash', customerEmail: 'bob@example.com' });
    await h.adapter.createStoreCredit({ customerId: id, code: 'ADA-1', originalAmount: 5, remainingAmount: 5 });
    await h.adapter.createQuote({ customerId: id, subtotal: 1, total: 1 });
    await h.adapter.createReturn({
      originalOrderId: theirs.id, returnNumber: 'R-1', customerId: id, subtotal: 5, total: 5, items: [],
    });

    expect(await h.adapter.permanentDeleteCustomer(id)).toBe(true);

    expect(await h.adapter.getCustomerById(id)).toBeNull();
    expect(await h.adapter.getOrderById(String(theirs.id))).toBeNull();
    expect(await h.adapter.getStoreCreditByCode('ADA-1')).toBeNull();
    expect(await h.adapter.getQuotesByCustomer(id)).toEqual([]);
    expect(await h.adapter.getOrderById(String(bobs.id))).not.toBeNull();
    expect(await h.adapter.getCustomerById(other)).not.toBeNull();
  });

  it('permanently deletes a customer without an email, leaving walk-in orders alone', async () => {
    const id = String((await h.adapter.createCustomer({ name: 'No Email' })).id);
    const walkIn = await h.adapter.createOrder({ subtotal: 5, total: 5, paymentMethod: 'Cash' });

    expect(await h.adapter.permanentDeleteCustomer(id)).toBe(true);
    expect(await h.adapter.getOrderById(String(walkIn.id))).not.toBeNull();
    expect(await h.adapter.permanentDeleteCustomer(id)).toBe(false);
  });
});
