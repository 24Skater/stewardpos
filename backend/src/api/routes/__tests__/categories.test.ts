import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getUserByEmail = vi.fn();
const getAllCategories = vi.fn();
const getUnmanagedCategories = vi.fn();
const createCategory = vi.fn();
const renameCategory = vi.fn();
const deleteCategory = vi.fn();
const createAuditLog = vi.fn();

vi.mock('../../../services/database', () => ({
  default: {
    getAdapter: () => ({
      getUserByEmail,
      getAllCategories,
      getUnmanagedCategories,
      createCategory,
      renameCategory,
      deleteCategory,
      createAuditLog,
    }),
  },
}));

const { default: config } = await import('../../../config');
const { default: app } = await import('../../../app');

const DRINKS = { id: 'c1', name: 'Drinks', icon: 'coffee', productCount: 4 };

function token(): string {
  return jwt.sign({ id: 'u1', email: 'admin@example.com', roleIds: ['r1'] }, config.jwt.secret, {
    expiresIn: '1h',
  });
}

function actor(permissions: Record<string, unknown>) {
  return {
    id: 'u1',
    email: 'admin@example.com',
    status: 'active',
    roleIds: ['r1'],
    roles: [{ id: 'r1', name: 'Stock', systemRole: 'standard', permissions }],
  };
}

const auth = () => ({ Authorization: `Bearer ${token()}` });

beforeEach(() => {
  vi.clearAllMocks();
  getUserByEmail.mockResolvedValue(actor({ inventory: { read: true, write: true, delete: true } }));
  getAllCategories.mockResolvedValue([DRINKS]);
  getUnmanagedCategories.mockResolvedValue([]);
  createCategory.mockResolvedValue({ id: 'c2', name: 'Snacks', icon: null, productCount: 0 });
  renameCategory.mockResolvedValue({ ...DRINKS, name: 'Beverages' });
  deleteCategory.mockResolvedValue('deleted');
  createAuditLog.mockResolvedValue({});
});

describe('GET /api/categories', () => {
  it('lists categories with their product counts', async () => {
    const response = await request(app).get('/api/categories').set(auth());

    expect(response.status).toBe(200);
    expect(response.body.data[0].productCount).toBe(4);
  });

  it('reports names products use that no category defines', async () => {
    // A typo or an import can leave a product in a category the manager cannot
    // see — and so cannot rename, merge, or clean up.
    getUnmanagedCategories.mockResolvedValue([{ name: 'Test', productCount: 1 }]);

    const response = await request(app).get('/api/categories').set(auth());

    expect(response.body.meta.unmanaged).toEqual([{ name: 'Test', productCount: 1 }]);
    // Kept out of `data`: they have no id, so nothing here can act on them.
    expect(response.body.data).toHaveLength(1);
  });

  it('needs inventory.read', async () => {
    getUserByEmail.mockResolvedValue(actor({ inventory: { read: false } }));

    expect((await request(app).get('/api/categories').set(auth())).status).toBe(403);
  });
});

describe('POST /api/categories', () => {
  it('creates one', async () => {
    const response = await request(app).post('/api/categories').set(auth()).send({ name: 'Snacks' });

    expect(response.status).toBe(201);
    expect(createCategory).toHaveBeenCalledWith('Snacks', null);
  });

  it('trims the name, so " Snacks" and "Snacks" are not two categories', async () => {
    await request(app).post('/api/categories').set(auth()).send({ name: '  Snacks  ' });

    expect(createCategory).toHaveBeenCalledWith('Snacks', null);
  });

  it('rejects an empty name', async () => {
    const response = await request(app).post('/api/categories').set(auth()).send({ name: '   ' });

    expect(response.status).toBe(400);
    expect(createCategory).not.toHaveBeenCalled();
  });

  it('409s on a name already taken', async () => {
    createCategory.mockResolvedValue(null);

    const response = await request(app).post('/api/categories').set(auth()).send({ name: 'Drinks' });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/already a category/);
  });

  it('needs inventory.write, not merely read', async () => {
    getUserByEmail.mockResolvedValue(actor({ inventory: { read: true, write: false } }));

    expect(
      (await request(app).post('/api/categories').set(auth()).send({ name: 'Snacks' })).status
    ).toBe(403);
  });
});

describe('PUT /api/categories/:id', () => {
  it('renames and reports how many products moved with it', async () => {
    // The products carry the name, not an id, so a rename that did not move
    // them would leave them all in a category that no longer exists.
    const response = await request(app)
      .put('/api/categories/c1')
      .set(auth())
      .send({ name: 'Beverages' });

    expect(response.status).toBe(200);
    expect(response.body.data.productCount).toBe(4);
    expect(renameCategory).toHaveBeenCalledWith('c1', 'Beverages', undefined);
  });

  it('404s on a category that does not exist', async () => {
    renameCategory.mockResolvedValue(null);

    expect(
      (await request(app).put('/api/categories/nope').set(auth()).send({ name: 'X' })).status
    ).toBe(404);
  });

  it('409s when the new name is already taken', async () => {
    renameCategory.mockResolvedValue('duplicate');

    const response = await request(app).put('/api/categories/c1').set(auth()).send({ name: 'Candy' });

    expect(response.status).toBe(409);
  });
});

describe('DELETE /api/categories/:id', () => {
  it('deletes an empty category', async () => {
    expect((await request(app).delete('/api/categories/c1').set(auth())).status).toBe(200);
    expect(deleteCategory).toHaveBeenCalledWith('c1', undefined);
  });

  it('refuses while products are still in it, and says how many', async () => {
    // `products.category` is NOT NULL: deleting would leave them naming
    // something that does not exist, and they would drop out of the filter.
    deleteCategory.mockResolvedValue({ inUse: 4 });

    const response = await request(app).delete('/api/categories/c1').set(auth());

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/4 products are still/);
  });

  it('gets the grammar right for a single product', async () => {
    deleteCategory.mockResolvedValue({ inUse: 1 });

    const response = await request(app).delete('/api/categories/c1').set(auth());

    expect(response.body.error).toMatch(/1 product is still/);
  });

  it('moves the products when told where to put them', async () => {
    await request(app).delete('/api/categories/c1?reassignTo=Candy').set(auth());

    expect(deleteCategory).toHaveBeenCalledWith('c1', 'Candy');
  });

  it('refuses to reassign into a category that does not exist', async () => {
    // Otherwise the products are stranded just as thoroughly as by deleting.
    deleteCategory.mockResolvedValue('bad_target');

    const response = await request(app).delete('/api/categories/c1?reassignTo=Ghost').set(auth());

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/no category called "Ghost"/);
  });

  it('404s on a category that does not exist', async () => {
    deleteCategory.mockResolvedValue('not_found');

    expect((await request(app).delete('/api/categories/nope').set(auth())).status).toBe(404);
  });

  it('needs inventory.delete, not merely write', async () => {
    getUserByEmail.mockResolvedValue(actor({ inventory: { read: true, write: true, delete: false } }));

    expect((await request(app).delete('/api/categories/c1').set(auth())).status).toBe(403);
    expect(deleteCategory).not.toHaveBeenCalled();
  });
});
