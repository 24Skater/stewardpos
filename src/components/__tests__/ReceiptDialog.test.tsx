import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/**
 * The post-sale receipt: the figures the cashier reads back to the customer,
 * the store details printed on it, and the email/SMS/print hand-off.
 *
 * Printing itself lives in `print-receipt.ts` and has its own tests; here only
 * the dialog's side of it is checked.
 */

const getSettings = vi.fn();
vi.mock('@/lib/api', () => ({ adminApi: { settings: { get: () => getSettings() } } }));

const printReceipt = vi.fn();
vi.mock('@/lib/print-receipt', () => ({
  printReceipt: (el: HTMLElement, title: string) => printReceipt(el, title),
}));

const toastSpy = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn(), toasts: [] }),
}));

const ReceiptDialog = (await import('../ReceiptDialog')).default;

const ITEMS = [
  { id: 'p1', name: 'Blue Shirt', price: 20, quantity: 2, size: 'M', color: 'Blue' },
  { id: 'p2', name: 'Sticker', price: 1.5, quantity: 1 },
];

type Props = Partial<Parameters<typeof ReceiptDialog>[0]>;

function renderReceipt(props: Props = {}) {
  const onClose = vi.fn();
  render(
    <ReceiptDialog
      open
      onClose={onClose}
      orderId="abcdef1234567890"
      total={45.65}
      subtotal={41.5}
      tax={4.15}
      items={ITEMS}
      {...props}
    />
  );
  return { onClose, dialog: screen.getByRole('dialog') };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue({});
});

describe('ReceiptDialog figures', () => {
  it('lists each line at its extended price with its options', () => {
    const { dialog } = renderReceipt();

    expect(within(dialog).getByText('Blue Shirt x2').parentElement).toHaveTextContent('$40.00');
    expect(within(dialog).getByText('M / Blue')).toBeInTheDocument();
    expect(within(dialog).getByText('Sticker').parentElement).toHaveTextContent('$1.50');
  });

  it('shows subtotal, tax and total, and a discount only when there is one', () => {
    const { dialog } = renderReceipt({ discount: 0 });

    expect(within(dialog).getByText('Subtotal').parentElement).toHaveTextContent('$41.50');
    expect(within(dialog).getByText('Tax').parentElement).toHaveTextContent('$4.15');
    expect(within(dialog).getByText('TOTAL').parentElement).toHaveTextContent('$45.65');
    expect(within(dialog).queryByText('Discount')).not.toBeInTheDocument();
  });

  it('prints the discount taken', () => {
    const { dialog } = renderReceipt({ discount: 3 });

    expect(within(dialog).getByText('Discount').parentElement).toHaveTextContent('-$3.00');
  });

  it('identifies the order by the short code a return asks for, with payment and auth', () => {
    const { dialog } = renderReceipt({ paymentMethod: 'Card', authCode: 'AUTH42' });

    expect(within(dialog).getByText('Order #ABCDEF12')).toBeInTheDocument();
    expect(within(dialog).getByText('*ABCDEF12*')).toBeInTheDocument();
    expect(within(dialog).getByText('Payment: CARD')).toBeInTheDocument();
    expect(within(dialog).getByText('Auth: AUTH42')).toBeInTheDocument();
  });

  it('falls back to safe defaults with no items or optional figures', () => {
    render(<ReceiptDialog open onClose={vi.fn()} orderId="o1" total={0} />);

    expect(screen.getByText('No items')).toBeInTheDocument();
    expect(screen.getByText('Payment: CASH')).toBeInTheDocument();
    expect(screen.queryByText(/^Auth:/)).not.toBeInTheDocument();
  });
});

describe('ReceiptDialog store details', () => {
  it('prints the store branding and address from settings', async () => {
    getSettings.mockResolvedValue({
      storeName: 'Corner Store',
      storeNumber: '7',
      storeAddress: '1 Main St',
      storeCity: 'Springfield',
      storeState: 'IL',
      storeZip: '62701',
      storePhone: '555-0100',
      receiptLogoUrl: 'https://example.com/logo.png',
      receiptHeaderText: 'Thanks for shopping local',
      receiptFooterText: 'No refunds after 30 days',
    });

    const { dialog } = renderReceipt();

    expect(await within(dialog).findByText('Corner Store')).toBeInTheDocument();
    expect(within(dialog).getByText('Store #7')).toBeInTheDocument();
    expect(within(dialog).getByText('1 Main St')).toBeInTheDocument();
    expect(within(dialog).getByText('Springfield, IL, 62701')).toBeInTheDocument();
    expect(within(dialog).getByText('Tel: 555-0100')).toBeInTheDocument();
    expect(within(dialog).getByText('Thanks for shopping local')).toBeInTheDocument();
    expect(within(dialog).getByText('No refunds after 30 days')).toBeInTheDocument();
    expect(within(dialog).getByAltText('Store Logo')).toHaveAttribute('src', 'https://example.com/logo.png');
  });

  it('hides the logo and barcode when the store turns them off', async () => {
    getSettings.mockResolvedValue({
      storeName: 'Corner Store',
      receiptLogoUrl: 'https://example.com/logo.png',
      receiptShowLogo: false,
      receiptShowBarcode: false,
    });

    const { dialog } = renderReceipt();

    await within(dialog).findByText('Corner Store');
    expect(within(dialog).queryByAltText('Store Logo')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('*ABCDEF12*')).not.toBeInTheDocument();
  });

  it('joins a partial address without a dangling comma', async () => {
    getSettings.mockResolvedValue({ storeName: 'S', storeCity: 'Springfield', storeZip: '62701' });

    const { dialog } = renderReceipt();

    expect(await within(dialog).findByText('Springfield 62701')).toBeInTheDocument();
  });

  it('still shows the receipt when settings fail to load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getSettings.mockRejectedValue(new Error('offline'));

    const { dialog } = renderReceipt();

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(within(dialog).getByText('Store Name')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('does not fetch settings while closed', () => {
    render(<ReceiptDialog open={false} onClose={vi.fn()} orderId="o1" total={0} />);

    expect(getSettings).not.toHaveBeenCalled();
  });
});

describe('ReceiptDialog delivery', () => {
  const sendButtons = (dialog: HTMLElement) => within(dialog).getAllByRole('button', { name: /send/i });

  it('requires an email before sending', () => {
    const { dialog, onClose } = renderReceipt();

    fireEvent.click(sendButtons(dialog)[0]);

    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Email required' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('emails the receipt, confirms it, and closes', async () => {
    const { dialog, onClose } = renderReceipt();
    fireEvent.change(within(dialog).getByLabelText('Email Receipt'), { target: { value: 'pat@example.com' } });

    fireEvent.click(sendButtons(dialog)[0]);

    expect(sendButtons(dialog)[0]).toBeDisabled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Email sent!', description: 'Receipt sent to pat@example.com' })
    );
  });

  it('requires a phone number before texting', () => {
    const { dialog } = renderReceipt();

    fireEvent.click(sendButtons(dialog)[1]);

    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Phone required' }));
  });

  it('texts the receipt, confirms it, and closes', async () => {
    const { dialog, onClose } = renderReceipt();
    fireEvent.change(within(dialog).getByLabelText('SMS Receipt'), { target: { value: '555-0199' } });

    fireEvent.click(sendButtons(dialog)[1]);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: 'SMS sent!' }));
  });

  it('prints the receipt itself, titled with the order', () => {
    printReceipt.mockReturnValue(true);
    const { dialog } = renderReceipt();

    fireEvent.click(within(dialog).getByRole('button', { name: /print/i }));

    const [el, title] = printReceipt.mock.calls[0];
    expect(title).toBe('Receipt - abcdef1234567890');
    expect(el).toHaveTextContent('Blue Shirt x2');
    expect(el).not.toHaveTextContent('Email Receipt');
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('says so when the print window is blocked', () => {
    printReceipt.mockReturnValue(false);
    const { dialog } = renderReceipt();

    fireEvent.click(within(dialog).getByRole('button', { name: /print/i }));

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Unable to open print window', variant: 'destructive' })
    );
  });

  it('closes from the Close button', () => {
    const { dialog, onClose } = renderReceipt();

    fireEvent.click(within(dialog).getAllByRole('button', { name: /^close$/i })[0]);

    expect(onClose).toHaveBeenCalled();
  });
});
