import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomerPicker from '../CustomerPicker';
import type { Customer } from '@/lib/api';

const list = vi.fn();
const create = vi.fn();
vi.mock('@/lib/api', () => ({
  customersApi: { list: () => list(), create: (body: unknown) => create(body) },
}));

const ada: Customer = { id: 'c1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '555-0100' } as Customer;
const bob: Customer = { id: 'c2', name: 'Bob Smith', phone: '555-0199' } as Customer;

beforeEach(() => {
  list.mockReset().mockResolvedValue([ada, bob]);
  create.mockReset();
});

describe('CustomerPicker', () => {
  it('finds a customer by phone and picks them', async () => {
    const onSelect = vi.fn();
    render(<CustomerPicker selected={null} onSelect={onSelect} />);

    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: '0199' } });
    fireEvent.click(await screen.findByRole('button', { name: /bob smith/i }));

    expect(onSelect).toHaveBeenCalledWith(bob);
    expect(screen.queryByRole('button', { name: /ada/i })).not.toBeInTheDocument();
  });

  it('creates a new customer from what was typed and selects them', async () => {
    const onSelect = vi.fn();
    const created = { id: 'c3', name: 'Cy Young', email: 'cy@example.com' } as Customer;
    create.mockResolvedValue(created);
    render(<CustomerPicker selected={null} onSelect={onSelect} />);

    fireEvent.change(screen.getByLabelText(/customer/i), { target: { value: 'Cy Young' } });
    fireEvent.click(screen.getByRole('button', { name: /new/i }));
    expect(screen.getByLabelText('Name')).toHaveValue('Cy Young');
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'cy@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /add customer/i }));

    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith(created));
    expect(create).toHaveBeenCalledWith({ name: 'Cy Young', email: 'cy@example.com' });
    expect(onSelect).toHaveBeenCalledWith(created);
  });

  it('keeps the form open and says why when saving fails', async () => {
    create.mockRejectedValue(new Error('A customer with that email exists'));
    render(<CustomerPicker selected={null} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /new/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: /add customer/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A customer with that email exists');
    expect(screen.getByLabelText('Name')).toHaveValue('Dup');
  });

  it('formats the phone as typed, saves bare digits, and blocks a half-typed number', async () => {
    const onSelect = vi.fn();
    create.mockResolvedValue({ id: 'c4', name: 'Dee' } as Customer);
    render(<CustomerPicker selected={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /new/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dee' } });
    const phone = screen.getByLabelText(/phone/i);
    fireEvent.change(phone, { target: { value: '202-53x' } });
    expect(phone).toHaveValue('(202) 53');
    expect(screen.getByRole('button', { name: /add customer/i })).toBeDisabled();

    fireEvent.change(phone, { target: { value: '(202) 538-1154' } });
    fireEvent.click(screen.getByRole('button', { name: /add customer/i }));

    await vi.waitFor(() => expect(create).toHaveBeenCalledWith({ name: 'Dee', phone: '2025381154' }));
  });

  it('shows the selected customer and can remove them from the sale', async () => {
    const onSelect = vi.fn();
    render(<CustomerPicker selected={ada} onSelect={onSelect} />);

    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove customer/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
