import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateAppliedDiscounts, type DiscountLookups } from '../discountPricing';

const TEN_PERCENT = {
  id: 'd-senior',
  name: 'Senior Discount',
  discountType: 'percentage',
  discountValue: 10,
  isActive: true,
  showInPos: true,
};

const FIVE_OFF = {
  id: 'p-fiver',
  name: 'FIVER',
  discountType: 'fixed',
  discountValue: 5,
  isActive: true,
};

let lookups: DiscountLookups;

beforeEach(() => {
  lookups = {
    getDiscountTypeById: vi.fn(async (id) => (id === TEN_PERCENT.id ? { ...TEN_PERCENT } : null)),
    getPromoCodeById: vi.fn(async (id) => (id === FIVE_OFF.id ? { ...FIVE_OFF } : null)),
    getPromoCodeByCode: vi.fn(async (code) =>
      code.toUpperCase() === 'FIVER' ? { ...FIVE_OFF } : null
    ),
  };
});

const cashier = { subtotalCents: 10_000, mayGrantManualDiscount: false };
const supervisor = { subtotalCents: 10_000, mayGrantManualDiscount: true };

describe('validateAppliedDiscounts', () => {
  it('takes the value from the catalog, not the request', async () => {
    // The request claims 90%; the stored discount is 10%.
    const result = await validateAppliedDiscounts(
      [{ source: 'quick_discount', id: 'd-senior', type: 'percentage', value: 90 }],
      lookups,
      cashier
    );

    expect(result.totalCents).toBe(1_000);
    expect(result.discounts[0].value).toBe(10);
  });

  it('applies a fixed promo by id', async () => {
    const result = await validateAppliedDiscounts(
      [{ source: 'promo_code', id: 'p-fiver' }],
      lookups,
      cashier
    );

    expect(result.totalCents).toBe(500);
  });

  it('resolves a promo by code when no id is given', async () => {
    const result = await validateAppliedDiscounts(
      [{ source: 'promo_code', code: 'fiver' }],
      lookups,
      cashier
    );

    expect(result.totalCents).toBe(500);
    expect(lookups.getPromoCodeByCode).toHaveBeenCalled();
  });

  it('stacks against what the previous discount left', async () => {
    // 10% of 100.00 = 10.00, then 5.00 fixed = 15.00 total.
    const result = await validateAppliedDiscounts(
      [
        { source: 'quick_discount', id: 'd-senior' },
        { source: 'promo_code', id: 'p-fiver' },
      ],
      lookups,
      cashier
    );

    expect(result.totalCents).toBe(1_500);
  });

  it('never discounts more than the subtotal', async () => {
    const result = await validateAppliedDiscounts(
      [
        { source: 'promo_code', id: 'p-fiver' },
        { source: 'promo_code', id: 'p-fiver' },
      ],
      lookups,
      { subtotalCents: 300, mayGrantManualDiscount: false }
    );

    expect(result.totalCents).toBe(300);
  });

  it('honours a percentage cap', async () => {
    lookups.getDiscountTypeById = vi.fn(async () => ({ ...TEN_PERCENT, maxDiscount: 2 }));

    const result = await validateAppliedDiscounts(
      [{ source: 'quick_discount', id: 'd-senior' }],
      lookups,
      cashier
    );

    expect(result.totalCents).toBe(200);
  });

  it('rejects a discount that does not exist', async () => {
    await expect(
      validateAppliedDiscounts([{ source: 'quick_discount', id: 'nope' }], lookups, cashier)
    ).rejects.toThrow(/no longer available/);
  });

  it('rejects an inactive discount', async () => {
    lookups.getDiscountTypeById = vi.fn(async () => ({ ...TEN_PERCENT, isActive: false }));

    await expect(
      validateAppliedDiscounts([{ source: 'quick_discount', id: 'd-senior' }], lookups, cashier)
    ).rejects.toThrow(/no longer active/);
  });

  it('rejects a quick discount not offered at the register', async () => {
    lookups.getDiscountTypeById = vi.fn(async () => ({ ...TEN_PERCENT, showInPos: false }));

    await expect(
      validateAppliedDiscounts([{ source: 'quick_discount', id: 'd-senior' }], lookups, cashier)
    ).rejects.toThrow(/not available at the register/);
  });

  it('rejects an expired promo', async () => {
    lookups.getPromoCodeById = vi.fn(async () => ({ ...FIVE_OFF, expiresAt: 1_000 }));

    await expect(
      validateAppliedDiscounts([{ source: 'promo_code', id: 'p-fiver' }], lookups, {
        ...cashier,
        now: 2_000,
      })
    ).rejects.toThrow(/has expired/);
  });

  it('rejects a promo past its usage limit', async () => {
    lookups.getPromoCodeById = vi.fn(async () => ({ ...FIVE_OFF, maxUses: 2, currentUses: 2 }));

    await expect(
      validateAppliedDiscounts([{ source: 'promo_code', id: 'p-fiver' }], lookups, cashier)
    ).rejects.toThrow(/usage limit/);
  });

  it('enforces a minimum purchase', async () => {
    lookups.getPromoCodeById = vi.fn(async () => ({ ...FIVE_OFF, minPurchase: 50 }));

    await expect(
      validateAppliedDiscounts([{ source: 'promo_code', id: 'p-fiver' }], lookups, {
        subtotalCents: 1_000,
        mayGrantManualDiscount: false,
      })
    ).rejects.toThrow(/minimum purchase/);
  });

  it('refuses a kind with no cart-level amount rather than guessing one', async () => {
    lookups.getPromoCodeById = vi.fn(async () => ({ ...FIVE_OFF, discountType: 'free_shipping' }));

    await expect(
      validateAppliedDiscounts([{ source: 'promo_code', id: 'p-fiver' }], lookups, cashier)
    ).rejects.toThrow(/cannot be applied at the register/);
  });

  describe('manual discounts', () => {
    it('refuses a cashier', async () => {
      await expect(
        validateAppliedDiscounts(
          [{ source: 'manual', type: 'fixed', value: 100 }],
          lookups,
          cashier
        )
      ).rejects.toThrow(/not allowed/);
    });

    it('allows a caller who may grant one', async () => {
      const result = await validateAppliedDiscounts(
        [{ source: 'manual', type: 'fixed', value: 20, reason: 'Damaged box' }],
        lookups,
        supervisor
      );

      expect(result.totalCents).toBe(2_000);
      expect(result.discounts[0].name).toBe('Damaged box');
    });

    it('still refuses a nonsensical amount', async () => {
      await expect(
        validateAppliedDiscounts([{ source: 'manual', type: 'fixed', value: 0 }], lookups, supervisor)
      ).rejects.toThrow(/positive amount/);
    });
  });

  it('refuses an employee discount rather than honouring an unverified number', async () => {
    await expect(
      validateAppliedDiscounts([{ source: 'employee', value: 50 }], lookups, supervisor)
    ).rejects.toThrow(/cannot be applied/);
  });

  it('is a no-op when nothing was applied', async () => {
    const result = await validateAppliedDiscounts([], lookups, cashier);

    expect(result.totalCents).toBe(0);
    expect(result.discounts).toEqual([]);
  });
});
