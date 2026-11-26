import { expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseError } from '../../../utils/errors';
import { describeSqlite, MAIN_REGISTER, useFreshSqlite } from './sqliteHarness';
import type { SQLiteAdapter } from '../SQLiteAdapter';

/**
 * What the SQLite adapter does when the database itself fails.
 *
 * Every method wraps its SQL in a try/catch that logs the driver error and
 * throws a `DatabaseError` with a fixed, caller-safe message — so a route
 * answers 500 "Failed to …" rather than leaking a raw `SqliteError` (with its
 * SQL and schema names) to the client. A closed connection makes every
 * statement fail, which is the one way to exercise all of those paths against
 * the real driver without mocking it.
 *
 * A handful of methods are deliberately best-effort (heartbeats, last-used
 * stamps, usage counters): those must swallow the failure, because the request
 * they describe has already succeeded.
 */

type Call = [name: string, run: (a: SQLiteAdapter) => Promise<unknown>];

const RANGE = { from: 0, to: 1 };

const WRAPPED: Call[] = [
  ['getUserByEmail', (a) => a.getUserByEmail('x')],
  ['updateUserLastLogin', (a) => a.updateUserLastLogin('x')],
  ['getAllProducts', (a) => a.getAllProducts()],
  ['getProductById', (a) => a.getProductById('x')],
  ['updateProduct', (a) => a.updateProduct('x', {})],
  ['deleteProduct', (a) => a.deleteProduct('x')],
  ['getAllOrders', (a) => a.getAllOrders()],
  ['getOrderById', (a) => a.getOrderById('x')],
  ['getAllCustomers', (a) => a.getAllCustomers()],
  ['createCustomer', (a) => a.createCustomer({})],
  ['getCustomerById', (a) => a.getCustomerById('x')],
  ['updateCustomer', (a) => a.updateCustomer('x', {})],
  ['deleteCustomer', (a) => a.deleteCustomer('x')],
  ['getAllServices', (a) => a.getAllServices()],
  ['getServiceById', (a) => a.getServiceById('x')],
  ['createService', (a) => a.createService({})],
  ['updateService', (a) => a.updateService('x', {})],
  ['deleteService', (a) => a.deleteService('x')],
  ['getAllUsers', (a) => a.getAllUsers()],
  ['deleteUser', (a) => a.deleteUser('x')],
  ['getAllRoles', (a) => a.getAllRoles()],
  ['getRoleById', (a) => a.getRoleById('x')],
  ['createRole', (a) => a.createRole({})],
  ['updateRole', (a) => a.updateRole('x', {})],
  ['deleteRole', (a) => a.deleteRole('x')],
  ['getSettings', (a) => a.getSettings()],
  ['updateSettings', (a) => a.updateSettings({})],
  ['createAuditLog', (a) => a.createAuditLog({})],
  ['getAuditLogs', (a) => a.getAuditLogs()],
  ['getAllQuotes', (a) => a.getAllQuotes()],
  ['getQuoteById', (a) => a.getQuoteById('x')],
  ['getQuotesByCustomer', (a) => a.getQuotesByCustomer('x')],
  ['updateQuoteStatus', (a) => a.updateQuoteStatus('x', 'sent')],
  ['deleteQuote', (a) => a.deleteQuote('x')],
  ['getOrdersByCustomerEmail', (a) => a.getOrdersByCustomerEmail('x')],
  ['getAllApiKeys', (a) => a.getAllApiKeys()],
  ['getApiKeyById', (a) => a.getApiKeyById('x')],
  ['getApiKeyByPrefix', (a) => a.getApiKeyByPrefix('x')],
  ['createApiKey', (a) => a.createApiKey({})],
  ['updateApiKey', (a) => a.updateApiKey('x', {})],
  ['deleteApiKey', (a) => a.deleteApiKey('x')],
  ['getAllReturns', (a) => a.getAllReturns()],
  ['getReturnById', (a) => a.getReturnById('x')],
  ['getReturnsByOrder', (a) => a.getReturnsByOrder('x')],
  ['getReturnSummariesByOrderIds', (a) => a.getReturnSummariesByOrderIds(['x'])],
  ['getReturnsByCustomer', (a) => a.getReturnsByCustomer('x')],
  ['createReturn', (a) => a.createReturn({})],
  ['updateReturnStatus', (a) => a.updateReturnStatus('x', { status: 'approved' })],
  ['updateReturnRefundStatus', (a) => a.updateReturnRefundStatus('x', {})],
  ['getReturnStats', (a) => a.getReturnStats()],
  ['createRefundTransaction', (a) => a.createRefundTransaction({})],
  ['createStoreCredit', (a) => a.createStoreCredit({})],
  ['getStoreCreditByCode', (a) => a.getStoreCreditByCode('x')],
  ['redeemStoreCredit', (a) => a.redeemStoreCredit('x', 1)],
  ['restockReturnItems', (a) => a.restockReturnItems('x')],
  ['logReceiptEmail', (a) => a.logReceiptEmail({})],
  ['getReceiptEmailHistory', (a) => a.getReceiptEmailHistory('x')],
  ['searchOrders', (a) => a.searchOrders({})],
  ['getAllDiscountTypes', (a) => a.getAllDiscountTypes()],
  ['getDiscountTypesForPOS', (a) => a.getDiscountTypesForPOS()],
  ['getDiscountTypeById', (a) => a.getDiscountTypeById('x')],
  ['createDiscountType', (a) => a.createDiscountType({})],
  ['updateDiscountType', (a) => a.updateDiscountType('x', { name: 'y' })],
  ['deleteDiscountType', (a) => a.deleteDiscountType('x')],
  ['getAllPromoCodes', (a) => a.getAllPromoCodes()],
  ['getPromoCodeById', (a) => a.getPromoCodeById('x')],
  ['getPromoCodeByCode', (a) => a.getPromoCodeByCode('x')],
  ['createPromoCode', (a) => a.createPromoCode({ code: 'x', startsAt: 0 })],
  ['updatePromoCode', (a) => a.updatePromoCode('x', { name: 'y' })],
  ['deletePromoCode', (a) => a.deletePromoCode('x')],
  ['getAllEmployeeDiscounts', (a) => a.getAllEmployeeDiscounts()],
  ['getEmployeeDiscountByUser', (a) => a.getEmployeeDiscountByUser('x')],
  ['upsertEmployeeDiscount', (a) => a.upsertEmployeeDiscount({ userId: 'x' })],
  ['deleteEmployeeDiscount', (a) => a.deleteEmployeeDiscount('x')],
  ['getDiscountUsage', (a) => a.getDiscountUsage()],
  ['logDiscountUsage', (a) => a.logDiscountUsage({})],
  ['getDiscountStats', (a) => a.getDiscountStats()],
  ['getSalesTotals', (a) => a.getSalesTotals(RANGE)],
  ['getSalesByDay', (a) => a.getSalesByDay(RANGE)],
  ['getTopProducts', (a) => a.getTopProducts(RANGE, 5)],
  ['getPaymentMix', (a) => a.getPaymentMix(RANGE)],
  ['getReturnsTotals', (a) => a.getReturnsTotals(RANGE)],
  ['getReturnsByReason', (a) => a.getReturnsByReason(RANGE)],
  ['getSalesByRegister', (a) => a.getSalesByRegister(RANGE)],
  ['getSalesByCashier', (a) => a.getSalesByCashier(RANGE)],
  ['getSalesByLocation', (a) => a.getSalesByLocation(RANGE)],
  ['getDrawerVarianceByRegister', (a) => a.getDrawerVarianceByRegister(RANGE)],
  ['getNoSaleCounts', (a) => a.getNoSaleCounts(RANGE)],
  ['getRegisterHourly', (a) => a.getRegisterHourly(RANGE, 'x')],
  ['createPaymentAttempt', (a) => a.createPaymentAttempt({ amountCents: 1, currency: 'USD', provider: 'x' } as never)],
  ['getPaymentAttemptById', (a) => a.getPaymentAttemptById('x')],
  ['updatePaymentAttempt', (a) => a.updatePaymentAttempt('x', { status: 'failed' } as never)],
  ['claimWebhookEvent', (a) => a.claimWebhookEvent({ id: 'x', type: 'y' })],
  ['getPaymentAttemptByChargeId', (a) => a.getPaymentAttemptByChargeId('x')],
  ['listUnreconciledAttempts', (a) => a.listUnreconciledAttempts()],
  ['createTerminalTransaction', (a) => a.createTerminalTransaction({ amount: 1, currency: 'USD', provider: 'x', chargeId: 'c', status: 's', startedAt: 0 })],
  ['updateTerminalTransactionByChargeId', (a) => a.updateTerminalTransactionByChargeId('c', { status: 's' })],
  ['getOpenDrawerSession', (a) => a.getOpenDrawerSession('x')],
  ['openDrawerSession', (a) => a.openDrawerSession({ registerId: 'x', openingFloat: 0 })],
  ['getExpectedDrawerCash', (a) => a.getExpectedDrawerCash('x')],
  ['closeDrawerSession', (a) => a.closeDrawerSession('x', 1, 1)],
  ['getDrawerSessions', (a) => a.getDrawerSessions()],
  ['createVariant', (a) => a.createVariant('x', {})],
  ['updateVariant', (a) => a.updateVariant('x', 'y', {})],
  ['getAllCategories', (a) => a.getAllCategories()],
  ['getUnmanagedCategories', (a) => a.getUnmanagedCategories()],
  ['createCategory', (a) => a.createCategory('x', null)],
  ['renameCategory', (a) => a.renameCategory('x', 'y', null)],
  ['deleteCategory', (a) => a.deleteCategory('x')],
  ['getLowStockVariants', (a) => a.getLowStockVariants(5)],
  ['deleteVariant', (a) => a.deleteVariant('x', 'y')],
  ['getLocations', (a) => a.getLocations('x')],
  ['getLocationById', (a) => a.getLocationById('x')],
  ['createLocation', (a) => a.createLocation({ org_id: 'x', slug: 'y' })],
  ['updateLocation', (a) => a.updateLocation('x', {})],
  ['getRegisters', (a) => a.getRegisters({ orgId: 'x' })],
  ['getRegisterById', (a) => a.getRegisterById('x')],
  ['createRegister', (a) => a.createRegister({})],
  ['updateRegister', (a) => a.updateRegister('x', {})],
  ['setRegisterStatus', (a) => a.setRegisterStatus('x', 'active')],
  ['countRegistersForCap', (a) => a.countRegistersForCap('x')],
  ['getUsedRegisterNumbers', (a) => a.getUsedRegisterNumbers('x')],
  ['getOrgPolicy', (a) => a.getOrgPolicy('x')],
  ['getOrganizationDrawerVarianceThreshold', (a) => a.getOrganizationDrawerVarianceThreshold('x')],
  ['getLiveUnredeemedPairingCredential', (a) => a.getLiveUnredeemedPairingCredential('x')],
  ['getLiveEnrolledCredential', (a) => a.getLiveEnrolledCredential('x')],
  ['getLiveRegisterCredentials', (a) => a.getLiveRegisterCredentials('x')],
  ['createPairingCredential', (a) => a.createPairingCredential({ registerId: 'x', pairingCodePrefix: 'p', pairingCodeHash: 'h', pairingExpiresAt: 0, createdBy: null })],
  ['getPairingCredentialsByPrefix', (a) => a.getPairingCredentialsByPrefix('x')],
  ['redeemPairingCredential', (a) => a.redeemPairingCredential('x', { tokenPrefix: 't', tokenHash: 'h', enrolledAt: 0 })],
  ['getRegisterCredentialsByTokenPrefix', (a) => a.getRegisterCredentialsByTokenPrefix('x')],
  ['revokeRegisterCredentialById', (a) => a.revokeRegisterCredentialById('x', { revokedBy: null, reason: null })],
  ['touchRegisterLastSeen', (a) => a.touchRegisterLastSeen('x')],
  ['getUserById', (a) => a.getUserById('x')],
  ['getActiveUsersWithPin', (a) => a.getActiveUsersWithPin('x')],
  ['getActiveUsersWithOverridePermission', (a) => a.getActiveUsersWithOverridePermission('x')],
  ['setUserPin', (a) => a.setUserPin('x', { pinHash: null, pinSetAt: null })],
  ['recordPinFailure', (a) => a.recordPinFailure('x', { failedCount: 1, lockedUntil: null })],
  ['resetPinFailures', (a) => a.resetPinFailures('x')],
  ['recordPasswordFailure', (a) => a.recordPasswordFailure('x', { failedCount: 1, lockedUntil: null })],
  ['resetPasswordFailures', (a) => a.resetPasswordFailures('x')],
  ['getOpenShiftForRegister', (a) => a.getOpenShiftForRegister('x')],
  ['getRegisterShiftById', (a) => a.getRegisterShiftById('x')],
  ['createRegisterShift', (a) => a.createRegisterShift({ registerId: 'x', userId: 'y' })],
  ['endRegisterShift', (a) => a.endRegisterShift('x', 'r')],
  ['touchRegisterShiftActivity', (a) => a.touchRegisterShiftActivity('x')],
  ['createRegisterOverride', (a) => a.createRegisterOverride({ registerId: 'x', shiftId: null, approverUserId: 'y', requestedByUserId: null, action: 'void', grantPrefix: 'g', grantHash: 'h', expiresAt: 0, reason: null })],
  ['getRegisterOverridesByPrefix', (a) => a.getRegisterOverridesByPrefix('x')],
  ['consumeRegisterOverride', (a) => a.consumeRegisterOverride('x', { entity: null, entityId: null, beforeValue: null, afterValue: null })],
  ['getRegisterOverrides', (a) => a.getRegisterOverrides({ orgId: 'x', limit: 1, offset: 0 })],
  ['getRegisterShifts', (a) => a.getRegisterShifts({ orgId: 'x', limit: 1, offset: 0 })],
];

/**
 * BUG (SQLite, low severity): these eight build their transaction with
 * `const transaction = this.db.transaction(...)` *above* the `try`, so a
 * driver failure at that point (here, a closed connection) escapes as a raw
 * `TypeError: The database connection is not open` instead of the
 * `DatabaseError` every other method throws. Failures inside the transaction
 * body are still wrapped — see the constraint tests in the other sqlite*
 * suites.
 */
const TRANSACTION_BUILT_OUTSIDE_TRY: Call[] = [
  ['createProduct', (a) => a.createProduct({ name: 'x' })],
  ['createOrder', (a) => a.createOrder({})],
  ['archiveCustomer', (a) => a.archiveCustomer('x', 'y')],
  ['permanentDeleteCustomer', (a) => a.permanentDeleteCustomer('x')],
  ['createUser', (a) => a.createUser({})],
  ['updateUser', (a) => a.updateUser('x', {})],
  ['createQuote', (a) => a.createQuote({})],
  ['updateQuote', (a) => a.updateQuote('x', {})],
];

const BEST_EFFORT: Call[] = [
  ['updateApiKeyLastUsed', (a) => a.updateApiKeyLastUsed('x')],
  ['incrementPromoCodeUsage', (a) => a.incrementPromoCodeUsage('x')],
  ['markWebhookEventHandled', (a) => a.markWebhookEventHandled('x')],
  ['markRefundFailed', (a) => a.markRefundFailed('x', null)],
  ['touchRegisterCredentialLastUsed', (a) => a.touchRegisterCredentialLastUsed('x')],
];

describeSqlite('SQLite adapter failure handling', () => {
  const h = useFreshSqlite();

  it.each(WRAPPED)('%s surfaces a closed database as a DatabaseError, not a raw driver error', async (_name, run) => {
    // Arrange
    h.adapter.close();

    // Act
    const outcome = run(h.adapter);

    // Assert
    await expect(outcome).rejects.toBeInstanceOf(DatabaseError);
    await expect(outcome).rejects.not.toThrow(/connection is not open/);
  });

  it.fails.each(TRANSACTION_BUILT_OUTSIDE_TRY)('%s surfaces a closed database as a DatabaseError (pinned bug)', async (_name, run) => {
    h.adapter.close();

    await expect(run(h.adapter)).rejects.toBeInstanceOf(DatabaseError);
  });

  it.each(BEST_EFFORT)('%s swallows a failure, since the request it describes already succeeded', async (_name, run) => {
    h.adapter.close();

    await expect(run(h.adapter)).resolves.toBeUndefined();
  });

  it('reports a closed connection as unreachable, and a lost promo count as zero uses', async () => {
    h.adapter.close();

    expect(await h.adapter.testConnection()).toBe(false);
    expect(await h.adapter.getPromoCodeUsageByCustomer('x', 'y')).toBe(0);
  });
});

describeSqlite('SQLite adapter edge cases', () => {
  const h = useFreshSqlite();

  it('creates the database directory when it does not exist yet', async () => {
    const { SQLiteAdapter: Adapter } = await import('../SQLiteAdapter');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sqlite-dir-'));
    const filename = path.join(root, 'nested', 'deeper', 'pos.db');

    const adapter = new Adapter({ filename });

    expect(await adapter.testConnection()).toBe(true);
    expect(fs.existsSync(filename)).toBe(true);
    adapter.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads a corrupt stored card receipt as null rather than failing the order read', async () => {
    const order = await h.adapter.createOrder({ subtotal: 1, total: 1, paymentMethod: 'Card', cardReceipt: { aid: 'A' } });
    h.db.prepare('UPDATE orders SET card_receipt = ? WHERE id = ?').run('{not json', order.id);

    expect((await h.adapter.getOrderById(String(order.id))).cardReceipt).toBeNull();
  });

  it('renames a register', async () => {
    expect(await h.adapter.updateRegister(MAIN_REGISTER, { name: 'Front Till' })).toMatchObject({ name: 'Front Till' });
  });
});
