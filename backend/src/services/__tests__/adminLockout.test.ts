import { describe, it, expect } from 'vitest';
import { lockoutProblem, type LockoutUser } from '../adminLockout';

const ADMIN = 'r-admin';
const CASHIER = 'r-cashier';
const admins = new Set([ADMIN]);
const me: LockoutUser = { id: 'me', status: 'active', roleIds: [ADMIN] };
const other: LockoutUser = { id: 'other', status: 'active', roleIds: [ADMIN] };
const cashier: LockoutUser = { id: 'cash', status: 'active', roleIds: [CASHIER] };

describe('lockoutProblem', () => {
  it('lets an admin manage other people while another admin remains', () => {
    const users = [me, other, cashier];
    expect(lockoutProblem(users, admins, 'me', { id: 'other', status: 'inactive' })).toBeNull();
    expect(lockoutProblem(users, admins, 'me', { id: 'other', roleIds: [CASHIER] })).toBeNull();
    expect(lockoutProblem(users, admins, 'me', { id: 'cash', deleted: true })).toBeNull();
  });

  it('refuses deactivating, deleting or demoting yourself', () => {
    const users = [me, other];
    expect(lockoutProblem(users, admins, 'me', { id: 'me', status: 'inactive' })).toMatch(/deactivate your own/);
    expect(lockoutProblem(users, admins, 'me', { id: 'me', deleted: true })).toMatch(/delete your own/);
    expect(lockoutProblem(users, admins, 'me', { id: 'me', roleIds: [CASHIER] })).toMatch(/your own admin role/);
  });

  it('refuses removing the last active admin, even when someone else does it', () => {
    const users = [other, { ...me, roleIds: [CASHIER] }];
    expect(lockoutProblem(users, admins, 'me', { id: 'other', status: 'inactive' })).toMatch(/last active admin/);
    expect(lockoutProblem(users, admins, 'me', { id: 'other', deleted: true })).toMatch(/last active admin/);
  });

  it('allows ordinary edits to yourself', () => {
    expect(lockoutProblem([me], admins, 'me', { id: 'me', roleIds: [ADMIN, CASHIER] })).toBeNull();
  });
});
