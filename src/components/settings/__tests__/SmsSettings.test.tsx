import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Settings } from '@/lib/api';

/** SMS card: provider fields, stored secrets stay hidden and kept, quiet hours, test send. */

const smsTest = vi.fn();
const toast = vi.fn();
vi.mock('@/lib/api', () => ({ adminApi: { sms: { test: smsTest } } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast, dismiss: vi.fn(), toasts: [] }) }));

const { default: SmsSettings } = await import('../SmsSettings');

const withSms = (sms: unknown, extra: Record<string, unknown> = {}) =>
  ({ providers: { sms, ...extra } }) as unknown as Settings;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SmsSettings', () => {
  it('shows no credential fields while SMS is off', () => {
    render(<SmsSettings settings={{} as Settings} onChange={vi.fn()} />);
    expect(screen.queryByLabelText('Account SID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Gateway URL')).not.toBeInTheDocument();
  });

  it('accepts a bare provider name', () => {
    render(<SmsSettings settings={withSms('http')} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Gateway URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Bearer token')).toHaveAttribute('type', 'password');
  });

  it('writes a typed credential into the provider entry', () => {
    const onChange = vi.fn();
    render(<SmsSettings settings={withSms({ provider: 'twilio', credentials: {} })} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Account SID'), { target: { value: 'AC1' } });

    expect(onChange).toHaveBeenCalledWith({
      providers: { sms: { provider: 'twilio', credentials: { accountSid: 'AC1' } } },
    });
  });

  it('never shows a stored secret, and clearing the field keeps it', () => {
    const onChange = vi.fn();
    render(
      <SmsSettings settings={withSms({ provider: 'twilio', credentials: { authToken: 'enc:v1:abc' } })} onChange={onChange} />
    );

    const field = screen.getByLabelText('Auth token') as HTMLInputElement;
    expect(field.value).toBe('');
    expect(field.placeholder).toMatch(/Stored/);

    fireEvent.change(field, { target: { value: 'new-token' } });
    expect(onChange).toHaveBeenLastCalledWith({
      providers: { sms: { provider: 'twilio', credentials: { authToken: 'new-token' } } },
    });

    onChange.mockClear();
    fireEvent.change(field, { target: { value: 'x' } });
    fireEvent.change(field, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('saves quiet hours next to the provider entry', () => {
    const onChange = vi.fn();
    render(<SmsSettings settings={withSms('off', { smsQuietHours: { start: '21:00' } })} onChange={onChange} />);

    expect((screen.getByLabelText('Quiet hours start') as HTMLInputElement).value).toBe('21:00');
    fireEvent.change(screen.getByLabelText('Quiet hours end'), { target: { value: '08:00' } });

    expect(onChange).toHaveBeenCalledWith({
      providers: { sms: 'off', smsQuietHours: { start: '21:00', end: '08:00' } },
    });
  });

  it('keeps the test button off until a number is typed, then reports the result', async () => {
    smsTest.mockResolvedValue({ status: 'sent' });
    render(<SmsSettings settings={withSms('twilio')} onChange={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Test send' });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Send a test to (must have opted in)'), { target: { value: '5551234567' } });
    fireEvent.click(button);

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Test text sent' })));
    expect(smsTest).toHaveBeenCalledWith('5551234567');
  });

  it('reports a refused or failed test as an error', async () => {
    smsTest.mockResolvedValueOnce({ status: 'failed', detail: 'No consent' }).mockRejectedValueOnce(new Error('offline'));
    render(<SmsSettings settings={withSms('twilio')} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Send a test to (must have opted in)'), { target: { value: '5551234567' } });

    fireEvent.click(screen.getByRole('button', { name: 'Test send' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ title: 'Test text failed', description: 'No consent', variant: 'destructive' })
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Test send' }));
    await waitFor(() =>
      expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Test text failed', variant: 'destructive' }))
    );
  });
});
