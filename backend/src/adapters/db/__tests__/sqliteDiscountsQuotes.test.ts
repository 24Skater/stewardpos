import { expect, it } from 'vitest';
import { describeSqlite, seedUser, useFreshSqlite } from './sqliteHarness';

/**
 * Discount types, promo codes, employee discounts, discount usage and quotes
 * on SQLite. Mirrors the Postgres discounts, servicesQuotes and
 * remainingReads integration suites.
 */

describeSqlite('discount types on SQLite', () => {
  const h = useFreshSqlite();

  it('round-trips a type with its defaults, and serves the register only active, visible ones', async () => {
    const seeded = (await h.adapter.getAllDiscountTypes()).length;
    const created = await h.adapter.createDiscountType({
      name: 'Staff', code: 'STAFF', discountType: 'percentage', discountValue: 12.5, applicableIds: ['cat-1'], requiresEmployeeId: true,
    });
    await h.adapter.createDiscountType({ name: 'Hidden', discountType: 'fixed', discountValue: 1, showInPos: false });
    await h.adapter.createDiscountType({ name: 'Withdrawn', discountType: 'fixed', discountValue: 1, isActive: false });

    expect(created).toMatchObject({
      discountValue: 12.5, applicableIds: ['cat-1'], requiresEmployeeId: true, showInPos: true, isActive: true,
      minPurchase: 0, color: 'gray', appliesTo: 'all',
    });
    expect(await h.adapter.getAllDiscountTypes()).toHaveLength(seeded + 3);
    const pos = await h.adapter.getDiscountTypesForPOS();
    expect(pos.map((t) => t.name)).toContain('Staff');
    expect(pos.map((t) => t.name)).not.toContain('Hidden');
    expect(pos.map((t) => t.name)).not.toContain('Withdrawn');
    expect(await h.adapter.getDiscountTypeById('missing')).toBeNull();
  });

  it('updates only the fields given, and deletes', async () => {
    const created = await h.adapter.createDiscountType({ name: 'Promo', discountType: 'fixed', discountValue: 5 });
    const id = String(created.id);

    const updated = await h.adapter.updateDiscountType(id, {
      name: 'Promo 2', description: 'd', code: 'P2', discountType: 'percentage', discountValue: 10, minPurchase: 20,
      maxDiscount: 50, appliesTo: 'category', applicableIds: ['c'], requiresApproval: true, approvalThreshold: 30,
      requiresEmployeeId: false, displayOrder: 9, color: 'red', icon: 'tag', showInPos: false, isActive: false,
    });

    expect(updated).toMatchObject({ name: 'Promo 2', discountValue: 10, requiresApproval: true, showInPos: false, isActive: false, applicableIds: ['c'] });
    expect(await h.adapter.updateDiscountType(id, {})).toMatchObject({ name: 'Promo 2' });
    expect(await h.adapter.deleteDiscountType(id)).toBe(true);
    expect(await h.adapter.deleteDiscountType(id)).toBe(false);
  });

  it('wraps a duplicate code as a DatabaseError', async () => {
    await expect(
      h.adapter.createDiscountType({ name: 'Dup', code: 'SENIOR', discountType: 'percentage', discountValue: 1 })
    ).rejects.toThrow('Failed to create discount type');
  });
});

describeSqlite('promo codes on SQLite', () => {
  const h = useFreshSqlite();

  const promo = { code: 'save10', name: 'Save 10', discountType: 'percentage', discountValue: 10, startsAt: '2026-01-01T00:00:00.000Z' };

  it('stores the code upper-cased, finds it case-insensitively, and starts with no uses', async () => {
    const created = await h.adapter.createPromoCode({ ...promo, expiresAt: '2026-12-31T00:00:00.000Z', maxUses: 100 });

    expect(created).toMatchObject({
      code: 'SAVE10', currentUses: 0, maxUses: 100, maxUsesPerCustomer: 1, excludedIds: [], firstOrderOnly: false,
      startsAt: Date.parse('2026-01-01T00:00:00.000Z'), expiresAt: Date.parse('2026-12-31T00:00:00.000Z'),
    });
    expect((await h.adapter.getPromoCodeByCode('Save10'))?.id).toBe(created.id);
    expect(await h.adapter.getPromoCodeByCode('nope')).toBeNull();
    expect(await h.adapter.getPromoCodeById('missing')).toBeNull();
  });

  it('burns a redemption per call', async () => {
    const created = await h.adapter.createPromoCode(promo);

    await Promise.all([h.adapter.incrementPromoCodeUsage(created.id), h.adapter.incrementPromoCodeUsage(created.id)]);

    expect((await h.adapter.getPromoCodeById(created.id)).currentUses).toBe(2);
  });

  it('lists with the creator named, updates only given fields, and deletes', async () => {
    const creator = await seedUser(h.adapter, 'mkt@example.com', 'Marketing');
    const created = await h.adapter.createPromoCode({ ...promo, createdBy: creator });

    const updated = await h.adapter.updatePromoCode(created.id, {
      code: 'save20', name: 'Save 20', description: 'd', discountType: 'fixed', discountValue: 20, minPurchase: 5,
      maxDiscount: 25, maxUses: 3, maxUsesPerCustomer: 2, startsAt: '2026-02-01T00:00:00.000Z', expiresAt: null,
      isActive: false, stackable: true,
    });

    expect(updated).toMatchObject({ code: 'SAVE20', discountValue: 20, expiresAt: null, isActive: false, stackable: true, maxUsesPerCustomer: 2 });
    expect(await h.adapter.updatePromoCode(created.id, {})).toMatchObject({ code: 'SAVE20' });
    expect((await h.adapter.getAllPromoCodes())[0]).toMatchObject({ createdByName: 'Marketing' });
    expect(await h.adapter.deletePromoCode(created.id)).toBe(true);
    expect(await h.adapter.deletePromoCode(created.id)).toBe(false);
  });

  it('updates every restriction field, encoded as create does', async () => {
    const created = await h.adapter.createPromoCode(promo);
    const patch = {
      minItems: 3, firstOrderOnly: true, specificCustomers: ['c1'], appliesTo: 'products',
      applicableIds: ['p1'], excludedIds: ['p2'], buyQuantity: 2, getQuantity: 1, getProductId: 'p3',
      customerGroups: ['vip'], priority: 7,
    };

    expect(await h.adapter.updatePromoCode(created.id, patch)).toMatchObject(patch);
  });

  it('wraps a duplicate code as a DatabaseError', async () => {
    await h.adapter.createPromoCode(promo);

    await expect(h.adapter.createPromoCode(promo)).rejects.toThrow('Failed to create promo code');
  });
});

describeSqlite('employee discounts on SQLite', () => {
  const h = useFreshSqlite();

  it('inserts, then updates in place, lists with names, and removes', async () => {
    const staff = await seedUser(h.adapter, 'staff@example.com', 'Staff');
    const mgr = await seedUser(h.adapter, 'mgr@example.com', 'Manager');

    const created = await h.adapter.upsertEmployeeDiscount({ userId: staff, allowedCategories: ['Drinks'] });
    const updated = await h.adapter.upsertEmployeeDiscount({ userId: staff, discountPercentage: 25, approvedBy: mgr, isActive: false });

    expect(created).toMatchObject({ discountPercentage: 10, allowedCategories: ['Drinks'], isActive: true, userName: 'Staff' });
    expect(updated).toMatchObject({ id: created.id, discountPercentage: 25, isActive: false, allowedCategories: [] });
    expect((await h.adapter.getAllEmployeeDiscounts())[0]).toMatchObject({ approvedByName: 'Manager', userEmail: 'staff@example.com' });
    expect(await h.adapter.deleteEmployeeDiscount(staff)).toBe(true);
    expect(await h.adapter.deleteEmployeeDiscount(staff)).toBe(false);
    expect(await h.adapter.getEmployeeDiscountByUser(staff)).toBeNull();
  });

  it('wraps an unknown user as a DatabaseError', async () => {
    await expect(h.adapter.upsertEmployeeDiscount({ userId: 'missing' })).rejects.toThrow('Failed to create/update employee discount');
  });
});

describeSqlite('discount usage on SQLite', () => {
  const h = useFreshSqlite();

  it('records what was given, filters it, counts per-customer promo use, and totals by source', async () => {
    const order = await h.adapter.createOrder({ subtotal: 100, total: 90, paymentMethod: 'Cash' });
    const customer = String((await h.adapter.createCustomer({ name: 'Ada' })).id);
    const code = await h.adapter.createPromoCode({ code: 'TEN', name: 'Ten', discountType: 'fixed', discountValue: 10, startsAt: 0 });
    const clerk = await seedUser(h.adapter, 'clerk@example.com', 'Clerk');

    const promoUse = await h.adapter.logDiscountUsage({
      orderId: order.id, discountSource: 'promo_code', promoCodeId: code.id, discountAmount: 10, customerId: customer, appliedBy: clerk,
    });
    const manual = await h.adapter.logDiscountUsage({ discountSource: 'manual', discountAmount: 2.5, manualReason: 'scuffed', requiresApproval: true });
    await h.adapter.logDiscountUsage({ discountSource: 'quick_discount', discountAmount: 1 });
    await h.adapter.logDiscountUsage({ discountSource: 'employee', discountAmount: 3 });
    h.db.prepare('UPDATE discount_usage SET applied_at = ? WHERE id = ?').run(1_000, manual.id);

    expect(promoUse).toMatchObject({ discount_amount: 10, approval_status: 'none' });
    expect(await h.adapter.getDiscountUsage({ orderId: String(order.id) })).toEqual([
      expect.objectContaining({ discountAmount: 10, appliedByName: 'Clerk', customerId: customer }),
    ]);
    expect((await h.adapter.getDiscountUsage({ customerId: customer })).length).toBe(1);
    expect((await h.adapter.getDiscountUsage({ startDate: 500, endDate: 1_500 }))[0]).toMatchObject({ manualReason: 'scuffed', requiresApproval: true });
    expect(await h.adapter.getDiscountUsage()).toHaveLength(4);
    expect(await h.adapter.getPromoCodeUsageByCustomer(code.id, customer)).toBe(1);
    expect(await h.adapter.getPromoCodeUsageByCustomer(code.id, 'nobody')).toBe(0);

    expect(await h.adapter.getDiscountStats()).toEqual({
      totalDiscounts: 4, totalDiscountAmount: 16.5,
      promoCodeCount: 1, promoCodeAmount: 10,
      quickDiscountCount: 1, quickDiscountAmount: 1,
      employeeDiscountCount: 1, employeeDiscountAmount: 3,
      manualDiscountCount: 1, manualDiscountAmount: 2.5,
    });
    expect(await h.adapter.getDiscountStats({ startDate: 500, endDate: 1_500 })).toMatchObject({ totalDiscounts: 1, manualDiscountAmount: 2.5 });
  });

  it('wraps a missing amount as a DatabaseError', async () => {
    await expect(h.adapter.logDiscountUsage({ discountSource: 'manual' })).rejects.toThrow('Failed to log discount usage');
  });
});

describeSqlite('quotes on SQLite', () => {
  const h = useFreshSqlite();

  async function quoteFor(customerId?: string) {
    const service = await h.adapter.createService({ name: 'Labour', category: 'Work', basePrice: 60 });
    return h.adapter.createQuote({
      customerId,
      subtotal: 90,
      taxTotal: 7.43,
      total: 97.43,
      notes: 'n',
      expiresAt: 5_000,
      items: [{ serviceId: service.id, description: 'Fix', quantity: 1.5, unitPrice: 60, lineTotal: 90 }],
    });
  }

  it('writes the quote and its lines together, keeping money and fractional quantities exact', async () => {
    const customer = String((await h.adapter.createCustomer({ name: 'Ada', email: 'ada@example.com' })).id);

    const created = await quoteFor(customer);
    const read = await h.adapter.getQuoteById(String(created.id));

    expect(created).toMatchObject({ status: 'draft', total: 97.43, taxTotal: 7.43, expiresAt: 5_000 });
    expect(read).toMatchObject({ customerName: 'Ada', customerEmail: 'ada@example.com' });
    expect(read.items).toEqual([expect.objectContaining({ quantity: 1.5, lineTotal: 90, serviceName: 'Labour' })]);
    expect((await h.adapter.getQuotesByCustomer(customer)).map((q) => q.id)).toEqual([created.id]);
    expect((await h.adapter.getAllQuotes())[0].items).toHaveLength(1);
    expect(await h.adapter.getQuoteById('missing')).toBeNull();
  });

  it('moves through its statuses, and deletes with its lines', async () => {
    const created = await quoteFor();
    const id = String(created.id);

    expect(await h.adapter.updateQuoteStatus(id, 'sent')).toMatchObject({ status: 'sent' });
    expect(await h.adapter.updateQuoteStatus('missing', 'sent')).toBeNull();
    expect(await h.adapter.deleteQuote(id)).toBe(true);
    expect(await h.adapter.deleteQuote(id)).toBe(false);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM quote_items WHERE quote_id = ?').get(id)).toEqual({ n: 0 });
  });

  it('wraps a missing total as a DatabaseError', async () => {
    await expect(h.adapter.createQuote({ subtotal: 1 })).rejects.toThrow('Failed to create quote');
  });

  it('returns null when updating a quote that does not exist', async () => {
    expect(await h.adapter.updateQuote('missing', { notes: 'x' })).toBeNull();
  });

  it('updates an existing quote and replaces its lines', async () => {
    const created = await quoteFor();

    const updated = await h.adapter.updateQuote(String(created.id), {
      status: 'sent',
      items: [{ description: 'Revised', quantity: 2, unitPrice: 10, lineTotal: 20 }],
    });

    expect(updated).toMatchObject({ status: 'sent', notes: 'n' });
    expect(updated!.items).toEqual([expect.objectContaining({ description: 'Revised', lineTotal: 20 })]);
  });
});
