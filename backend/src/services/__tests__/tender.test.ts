import { describe, it, expect } from 'vitest';
import { cardPortion, cashPortion, singleTender, validateTender } from '../tender';

describe('singleTender', () => {
  it('turns one method into one payment covering the sale', () => {
    const tender = singleTender('Cash', 24.5);

    expect(tender.payments).toEqual([{ method: 'cash', amount: 24.5 }]);
    expect(tender.summaryMethod).toBe('Cash');
  });

  it('normalises a method name with spacing or casing', () => {
    expect(singleTender('Store Credit', 5).payments[0].method).toBe('store_credit');
  });

  it("keeps the caller's own wording for the summary", () => {
    // A store may label a tender however it likes, and a receipt should say what
    // they call it rather than a normalised token.
    expect(singleTender('Zelle', 10).summaryMethod).toBe('Zelle');
  });

  it('falls back to `other` for an unrecognised method', () => {
    expect(singleTender('Cheque', 10).payments[0].method).toBe('other');
  });
});

describe('validateTender', () => {
  it('accepts a split that adds up', () => {
    const tender = validateTender(
      [
        { method: 'cash', amount: 20 },
        { method: 'card', amount: 15.75 },
      ],
      35.75
    );

    expect(tender.payments).toHaveLength(2);
    expect(tender.summaryMethod).toBe('Split');
  });

  it('names the single method when there is only one', () => {
    expect(validateTender([{ method: 'card', amount: 10 }], 10).summaryMethod).toBe('Card');
  });

  it('calls it Split even when the same method appears twice', () => {
    // Two card payments are still one method, so this is not a split.
    const tender = validateTender(
      [
        { method: 'card', amount: 5 },
        { method: 'card', amount: 5 },
      ],
      10
    );

    expect(tender.summaryMethod).toBe('Card');
  });

  it('refuses a short tender, and says by how much', () => {
    // Accepting it would record a sale as paid when it was not.
    expect(() =>
      validateTender([{ method: 'cash', amount: 10 }], 25)
    ).toThrow(/\$15\.00 short/);
  });

  it('refuses an overpayment rather than inventing change', () => {
    // Only cash produces change, and that is recorded on the order. A card
    // charged for more than its share would overstate revenue.
    expect(() =>
      validateTender([{ method: 'card', amount: 30 }], 25)
    ).toThrow(/exceed .* by \$5\.00/);
  });

  it('is exact where floating-point dollars would drift', () => {
    // 10.10 + 10.20 + 9.70 is 30.000000000000004 in float dollars.
    expect(() =>
      validateTender(
        [
          { method: 'cash', amount: 10.1 },
          { method: 'card', amount: 10.2 },
          { method: 'zelle', amount: 9.7 },
        ],
        30
      )
    ).not.toThrow();
  });

  it('refuses a zero or negative payment', () => {
    expect(() => validateTender([{ method: 'cash', amount: 0 }], 0)).toThrow(/positive amount/);
    expect(() =>
      validateTender(
        [
          { method: 'cash', amount: -5 },
          { method: 'card', amount: 15 },
        ],
        10
      )
    ).toThrow(/positive amount/);
  });

  it('requires a code with a store credit payment', () => {
    // Without one there is nothing to redeem against.
    expect(() =>
      validateTender([{ method: 'store_credit', amount: 10 }], 10)
    ).toThrow(/needs its code/);
  });

  it('accepts a store credit payment carrying its code', () => {
    const tender = validateTender(
      [
        { method: 'store_credit', amount: 10, reference: 'SC-ABC123' },
        { method: 'cash', amount: 5 },
      ],
      15
    );

    expect(tender.payments[0].reference).toBe('SC-ABC123');
  });

  it('refuses an empty tender', () => {
    expect(() => validateTender([], 10)).toThrow(/at least one payment/);
  });
});

describe('cashPortion', () => {
  it('sums only the cash payments', () => {
    expect(
      cashPortion([
        { method: 'cash', amount: 20 },
        { method: 'card', amount: 15 },
        { method: 'cash', amount: 5.5 },
      ])
    ).toBe(25.5);
  });

  it('is zero when nothing was paid in cash', () => {
    // Which is what stops change being given against a card payment.
    expect(cashPortion([{ method: 'card', amount: 40 }])).toBe(0);
  });
});

describe('cardPortion', () => {
  it('sums only the card payments', () => {
    // This is the figure checked against what the processor was actually given,
    // so a split sale must contribute its card leg and nothing else.
    expect(
      cardPortion([
        { method: 'cash', amount: 20 },
        { method: 'card', amount: 15 },
        { method: 'card', amount: 5.5 },
      ])
    ).toBe(20.5);
  });

  it('is zero when nothing was paid by card', () => {
    // A cash-only sale has no charge to reconcile against, so binding it to a
    // payment attempt must compare against nothing rather than against the total.
    expect(cardPortion([{ method: 'cash', amount: 40 }])).toBe(0);
  });

  it('is zero for an empty tender', () => {
    expect(cardPortion([])).toBe(0);
  });
});
