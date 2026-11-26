import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discountsApi } from '../discounts';
import type { DiscountTypeInput, PromoCodeInput, ValidatePromoRequest } from '../discounts';

const client = vi.hoisted(() => ({
  get: vi.fn(async () => 'ok'),
  post: vi.fn(async () => 'ok'),
  put: vi.fn(async () => 'ok'),
  delete: vi.fn(async () => 'ok'),
}));

vi.mock('../../api-client', () => ({ apiClient: client }));

const TYPE: DiscountTypeInput = { name: 'Senior', discountType: 'percentage', discountValue: 10 };
const PROMO: PromoCodeInput = {
  code: 'SAVE', name: 'Save', discountType: 'fixed', discountValue: 5, startsAt: '2030-01-01T00:00:00.000Z',
};
const VALIDATE: ValidatePromoRequest = { code: 'SAVE', cartTotal: 40, itemCount: 2 };

beforeEach(() => vi.clearAllMocks());

describe('discountsApi', () => {
  it.each([
    ['types.list', () => discountsApi.types.list(), 'get', ['/api/discounts/types']],
    ['types.listForPos', () => discountsApi.types.listForPos(), 'get', ['/api/discounts/types/pos']],
    ['types.get', () => discountsApi.types.get('t1'), 'get', ['/api/discounts/types/t1']],
    ['types.create', () => discountsApi.types.create(TYPE), 'post', ['/api/discounts/types', TYPE]],
    ['types.update', () => discountsApi.types.update('t1', { isActive: false }), 'put', ['/api/discounts/types/t1', { isActive: false }]],
    ['types.remove', () => discountsApi.types.remove('t1'), 'delete', ['/api/discounts/types/t1']],
    ['promos.list', () => discountsApi.promos.list(), 'get', ['/api/discounts/promos']],
    ['promos.get', () => discountsApi.promos.get('p1'), 'get', ['/api/discounts/promos/p1']],
    ['promos.create', () => discountsApi.promos.create(PROMO), 'post', ['/api/discounts/promos', PROMO]],
    ['promos.update', () => discountsApi.promos.update('p1', { maxUses: 3 }), 'put', ['/api/discounts/promos/p1', { maxUses: 3 }]],
    ['promos.remove', () => discountsApi.promos.remove('p1'), 'delete', ['/api/discounts/promos/p1']],
    ['promos.validate', () => discountsApi.promos.validate(VALIDATE), 'post', ['/api/discounts/promos/validate', VALIDATE]],
    ['promos.markUsed', () => discountsApi.promos.markUsed('p1', { orderId: 'o1' }), 'post', ['/api/discounts/promos/p1/use', { orderId: 'o1' }]],
    ['employee.list', () => discountsApi.employee.list(), 'get', ['/api/discounts/employee']],
    ['employee.get', () => discountsApi.employee.get('u1'), 'get', ['/api/discounts/employee/u1']],
    ['employee.upsert', () => discountsApi.employee.upsert({ userId: 'u1', discountPercentage: 15 }), 'post',
      ['/api/discounts/employee', { userId: 'u1', discountPercentage: 15 }]],
    ['employee.remove', () => discountsApi.employee.remove('u1'), 'delete', ['/api/discounts/employee/u1']],
    ['usage.record', () => discountsApi.usage.record({ orderId: 'o1' }), 'post', ['/api/discounts/usage', { orderId: 'o1' }]],
  ] as const)('%s maps to the backend route', async (_name, call, method, args) => {
    const result = await call();

    expect(client[method]).toHaveBeenCalledWith(...args);
    expect(result).toBe('ok');
  });

  it('builds the usage query string, omitting it when there are no filters', async () => {
    await discountsApi.usage.list({ orderId: 'o1', startDate: 100 });
    await discountsApi.usage.list();

    expect(client.get).toHaveBeenNthCalledWith(1, '/api/discounts/usage?orderId=o1&startDate=100');
    expect(client.get).toHaveBeenNthCalledWith(2, '/api/discounts/usage');
  });

  it('passes a date range to stats', async () => {
    await discountsApi.stats({ startDate: 1, endDate: 2 });
    await discountsApi.stats();

    expect(client.get).toHaveBeenNthCalledWith(1, '/api/discounts/stats?startDate=1&endDate=2');
    expect(client.get).toHaveBeenNthCalledWith(2, '/api/discounts/stats');
  });
});
