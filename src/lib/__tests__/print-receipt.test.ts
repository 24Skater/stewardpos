import { describe, it, expect, vi, afterEach } from 'vitest';
import { printReceipt, RECEIPT_PRINT_CSS } from '../print-receipt';

function fakeWindow() {
  const doc = { write: vi.fn(), close: vi.fn(), title: '' };
  return { document: doc, focus: vi.fn(), print: vi.fn(), close: vi.fn() };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('printReceipt', () => {
  it('prints only the receipt markup, with thermal styles, then closes the window', () => {
    vi.useFakeTimers();
    const win = fakeWindow();
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    const receipt = document.createElement('div');
    receipt.innerHTML = '<div class="flex justify-between"><span>Coffee</span><span>$3.00</span></div>';

    const opened = printReceipt(receipt, 'Receipt - AB12');

    expect(opened).toBe(true);
    const html = win.document.write.mock.calls[0][0] as string;
    expect(html).toContain('<span>Coffee</span><span>$3.00</span>');
    expect(html).toContain('size: 80mm auto');
    expect(html).not.toContain('<title>Receipt');
    expect(win.document.title).toBe('Receipt - AB12');
    expect(win.print).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(win.print).toHaveBeenCalledOnce();
    expect(win.close).toHaveBeenCalledOnce();
  });

  it('returns false when the pop-up is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    expect(printReceipt(document.createElement('div'), 'x')).toBe(false);
  });

  it('restates the Tailwind layout classes receipt markup uses, since Tailwind is not loaded there', () => {
    for (const cls of ['.flex', '.justify-between', '.text-center', '.border-t', '.text-xs']) {
      expect(RECEIPT_PRINT_CSS).toContain(cls);
    }
  });
});
