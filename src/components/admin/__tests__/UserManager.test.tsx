import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import UserManager from '../UserManager';
import type { Role, User } from '@/lib/api';

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/api', () => ({ adminApi: { users: api } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const roles = [
  { id: 'r-admin', name: 'Admin' },
  { id: 'r-cash', name: 'Cashier' },
] as Role[];
const me = { id: 'u1', name: 'Owner', email: 'owner@example.com', roleIds: ['r-admin'], status: 'active' } as User;
const ann = { id: 'u2', name: 'Ann', email: 'ann@example.com', roleIds: ['r-cash'], status: 'active' } as User;

const renderManager = (onChanged = vi.fn()) =>
  render(<UserManager roles={roles} currentUserId="u1" canEdit onChanged={onChanged} />);

beforeEach(() => {
  api.list.mockReset().mockResolvedValue([me, ann]);
  api.create.mockReset();
  api.update.mockReset().mockResolvedValue({});
});

describe('UserManager', () => {
  it('lists users with their role names, and offers no deactivate on yourself', async () => {
    renderManager();

    const annRow = (await screen.findByText('ann@example.com')).closest('tr') as HTMLElement;
    expect(within(annRow).getByText('Cashier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate Ann' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate Owner' })).not.toBeInTheDocument();
  });

  it('adds a user with a password and roles, then grants override approval', async () => {
    const onChanged = vi.fn();
    api.create.mockResolvedValue({ id: 'u3' });
    renderManager(onChanged);
    await screen.findByText('ann@example.com');

    fireEvent.click(screen.getByRole('button', { name: /add user/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Bo' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'bo@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'Str0ng-pass!' } });
    fireEvent.click(within(dialog).getByLabelText('Cashier'));
    fireEvent.click(within(dialog).getByLabelText(/approves manager overrides/i));
    fireEvent.click(within(dialog).getByRole('button', { name: /add user/i }));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.create).toHaveBeenCalledWith({ name: 'Bo', email: 'bo@example.com', roleIds: ['r-cash'], password: 'Str0ng-pass!' });
    expect(api.update).toHaveBeenCalledWith('u3', { canOverride: true });
  });

  it('edits without sending a password when it is left blank', async () => {
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Ann' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Ann B' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save changes/i }));

    await vi.waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update).toHaveBeenCalledWith('u2', { name: 'Ann B', email: 'ann@example.com', roleIds: ['r-cash'], canOverride: false });
  });

  it('deactivates someone else', async () => {
    renderManager();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate Ann' }));

    await vi.waitFor(() => expect(api.update).toHaveBeenCalledWith('u2', { status: 'inactive' }));
  });

  it('keeps the form open and shows why the server refused', async () => {
    api.create.mockRejectedValue(new Error('Password is too common'));
    renderManager();
    await screen.findByText('ann@example.com');

    fireEvent.click(screen.getByRole('button', { name: /add user/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Bo' } });
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'bo@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(within(dialog).getByLabelText('Admin'));
    fireEvent.click(within(dialog).getByRole('button', { name: /add user/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Password is too common');
  });
});
