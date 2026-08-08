import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connect, cleanup, tag, type Harness } from './harness';

/**
 * Category SQL against a real Postgres.
 *
 * The riskiest queries written this session: rename and delete each span two
 * tables in one transaction, because `products.category` stores the category
 * *name* rather than a foreign key. A rename that moved the row but not the
 * products would leave every one of them naming a category that no longer
 * exists — and a mocked adapter cannot tell the two apart.
 */
let h: Harness;
const mark = tag();

const DRINKS = `${mark}Drinks`;
const SNACKS = `${mark}Snacks`;

let drinksId: string;
let snacksId: string;

async function makeCategory(name: string): Promise<string> {
  const row = await h.adapter.createCategory(name, null);
  return String(row!.id);
}

async function categoryOf(productId: string): Promise<string> {
  const { rows } = await h.query('SELECT category FROM products WHERE id = $1', [productId]);
  return String(rows[0].category);
}

let productId: string;

beforeAll(async () => {
  h = await connect();
}, 30_000);

beforeEach(async () => {
  await cleanup(h, mark);
  drinksId = await makeCategory(DRINKS);
  snacksId = await makeCategory(SNACKS);

  const product = await h.adapter.createProduct({
    name: `${mark} Tea`,
    description: mark,
    category: DRINKS,
    basePrice: 5,
    variants: [],
  });
  productId = String(product!.id);
});

afterAll(async () => {
  await cleanup(h, mark);
  await h.close();
});

describe('createCategory', () => {
  it('refuses a duplicate name case-insensitively', async () => {
    // "drinks" beside "Drinks" is a typo, not two categories — their products
    // would never appear together.
    expect(await h.adapter.createCategory(DRINKS.toUpperCase(), null)).toBeNull();
  });

  it('counts the products in each', async () => {
    const all = await h.adapter.getAllCategories();

    expect(all.find((c) => c.name === DRINKS)).toMatchObject({ productCount: 1 });
    expect(all.find((c) => c.name === SNACKS)).toMatchObject({ productCount: 0 });
  });
});

describe('renameCategory', () => {
  it('moves the products with it', async () => {
    const renamed = `${mark}Beverages`;

    const result = await h.adapter.renameCategory(drinksId, renamed, undefined);

    expect(result).toMatchObject({ name: renamed, productCount: 1 });
    expect(await categoryOf(productId)).toBe(renamed);
  });

  it('leaves nothing behind under the old name', async () => {
    await h.adapter.renameCategory(drinksId, `${mark}Beverages`, undefined);

    const { products } = await h.adapter.getAllProducts({ category: DRINKS });
    expect(products).toHaveLength(0);
  });

  it('refuses a name another category already holds, and changes nothing', async () => {
    expect(await h.adapter.renameCategory(drinksId, SNACKS, undefined)).toBe('duplicate');

    // The rollback is the point: a refused rename must not have moved products.
    expect(await categoryOf(productId)).toBe(DRINKS);
  });

  it('rolls back both writes when the transaction cannot complete', async () => {
    // Force the second statement to fail by making `products.category` too
    // small to hold the new name. If the two writes were not one transaction,
    // the category row would be renamed and the products left pointing at the
    // old name — the exact orphaning this transaction exists to prevent.
    const tooLong = `${mark}${'x'.repeat(300)}`;

    await expect(h.adapter.renameCategory(drinksId, tooLong, undefined)).rejects.toThrow();

    const { rows } = await h.query('SELECT name FROM categories WHERE id = $1', [drinksId]);
    expect(rows[0].name).toBe(DRINKS);
    expect(await categoryOf(productId)).toBe(DRINKS);
  });

  it('returns null for a category that does not exist', async () => {
    expect(
      await h.adapter.renameCategory('00000000-0000-0000-0000-0000000000ff', `${mark}X`, undefined)
    ).toBeNull();
  });
});

describe('deleteCategory', () => {
  it('deletes an empty one', async () => {
    expect(await h.adapter.deleteCategory(snacksId)).toBe('deleted');
  });

  it('refuses one still in use, and says how many', async () => {
    // `products.category` is NOT NULL: deleting would leave the products naming
    // something that does not exist, and they would drop out of the filter.
    expect(await h.adapter.deleteCategory(drinksId)).toEqual({ inUse: 1 });
  });

  it('leaves the category intact when it refuses', async () => {
    await h.adapter.deleteCategory(drinksId);

    const { rows } = await h.query('SELECT id FROM categories WHERE id = $1', [drinksId]);
    expect(rows).toHaveLength(1);
  });

  it('reassigns the products, then deletes', async () => {
    expect(await h.adapter.deleteCategory(drinksId, SNACKS)).toBe('deleted');

    expect(await categoryOf(productId)).toBe(SNACKS);
    const { rows } = await h.query('SELECT id FROM categories WHERE id = $1', [drinksId]);
    expect(rows).toHaveLength(0);
  });

  it('refuses to reassign into a category that does not exist', async () => {
    // Otherwise the products are stranded just as thoroughly as by deleting.
    expect(await h.adapter.deleteCategory(drinksId, `${mark}Nowhere`)).toBe('bad_target');

    expect(await categoryOf(productId)).toBe(DRINKS);
  });

  it('will not reassign a category into itself', async () => {
    // The products would be moved to the name being deleted, then orphaned.
    expect(await h.adapter.deleteCategory(drinksId, DRINKS)).toBe('bad_target');

    expect(await categoryOf(productId)).toBe(DRINKS);
  });
});

describe('getUnmanagedCategories', () => {
  it('reports a name products use that no category defines', async () => {
    await h.query('UPDATE products SET category = $1 WHERE id = $2', [`${mark}Ghost`, productId]);

    const unmanaged = await h.adapter.getUnmanagedCategories();

    expect(unmanaged.find((c) => c.name === `${mark}Ghost`)).toMatchObject({ productCount: 1 });
  });

  it('does not report categories that do exist', async () => {
    const unmanaged = await h.adapter.getUnmanagedCategories();

    expect(unmanaged.find((c) => c.name === DRINKS)).toBeUndefined();
  });
});
