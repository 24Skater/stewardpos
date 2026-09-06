import type { ProductVariant, VariantInput } from './api';
import { productsApi } from './api';

/**
 * Persisting a product's variants from an editor.
 *
 * Product update (`PUT /api/products/:id`) deliberately does not touch variants
 * — they are a sub-resource with their own create/update/delete endpoints, so
 * that correcting one stock count cannot blank another variant's SKU. Both
 * inventory screens render an editable list of variants anyway; without this
 * helper their "Save" discarded every change to it silently.
 *
 * `diffVariants` compares the list the user edited against the one that was
 * loaded and says what changed; `applyVariantChanges` makes those calls. Kept
 * apart, and pure, so the decision of what to send is unit-tested without a
 * network.
 */

/**
 * A variant as an editor holds it. An existing one carries the server `id` it
 * was loaded with; one the user just added has no `id` yet (or a throwaway one
 * the list used for its React key, which `diffVariants` treats as absent).
 */
export type EditableVariant = Omit<Partial<ProductVariant>, 'stock' | 'enabled'> & {
  id?: string;
  stock: number;
  enabled: boolean;
};

/** The variant fields a screen lets someone change, and that the API accepts. */
const EDITABLE_FIELDS = [
  'size',
  'color',
  'priceOverride',
  'priceDelta',
  'sku',
  'barcode',
  'stock',
  'enabled',
  'lowStockThreshold',
] as const;

export interface VariantDiff {
  toCreate: VariantInput[];
  toUpdate: Array<{ id: string; changes: Partial<VariantInput> }>;
  toRemove: string[];
}

/** `undefined`, `null` and `''` all mean "no value" — so a blank box left blank is not an edit. */
function normalise(value: unknown): unknown {
  return value === undefined || value === null || value === '' ? null : value;
}

/** An id the server issued, as opposed to one a list invented for a key. */
function isPersisted(id: string | undefined, known: Set<string>): id is string {
  return typeof id === 'string' && known.has(id);
}

function toVariantInput(row: EditableVariant): VariantInput {
  const body: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    const value = row[key as keyof EditableVariant];
    if (normalise(value) !== null) {
      body[key] = value;
    }
  }
  // The API defaults both, but a new row always has them set, and sending them
  // keeps a variant created with 0 stock / disabled from silently flipping.
  body.stock = row.stock ?? 0;
  body.enabled = row.enabled ?? true;
  return body as VariantInput;
}

/**
 * What to create, update and remove so the product's variants match `edited`.
 *
 * A row whose `id` is not among the loaded variants is a create. A row matched
 * by `id` yields an update carrying only the fields that actually changed, or
 * nothing. A loaded variant with no matching row is a remove — except the last
 * one: a product with no variants cannot be sold and the server rejects it, so
 * that removal is dropped here rather than sent to fail.
 */
export function diffVariants(
  original: ProductVariant[],
  edited: EditableVariant[]
): VariantDiff {
  const originalById = new Map(original.map((v) => [v.id, v]));
  const knownIds = new Set(originalById.keys());
  const keptIds = new Set<string>();

  const toCreate: VariantInput[] = [];
  const toUpdate: VariantDiff['toUpdate'] = [];

  for (const row of edited) {
    if (!isPersisted(row.id, knownIds)) {
      toCreate.push(toVariantInput(row));
      continue;
    }

    const existing = originalById.get(row.id)!;
    keptIds.add(existing.id);

    const changes: Record<string, unknown> = {};
    for (const key of EDITABLE_FIELDS) {
      const before = normalise(existing[key as keyof ProductVariant]);
      const after = normalise(row[key as keyof EditableVariant]);
      if (before !== after) {
        changes[key] = row[key as keyof EditableVariant] ?? null;
      }
    }
    if (Object.keys(changes).length > 0) {
      toUpdate.push({ id: existing.id, changes: changes as Partial<VariantInput> });
    }
  }

  let toRemove = original.filter((v) => !keptIds.has(v.id)).map((v) => v.id);

  // Never strand a product with zero variants. If every kept row is a removal
  // and nothing is being created, leave the last loaded variant in place.
  const survivors = keptIds.size + toCreate.length;
  if (survivors === 0 && toRemove.length > 0) {
    toRemove = toRemove.slice(0, -1);
  }

  return { toCreate, toUpdate, toRemove };
}

/** True when `diffVariants` found nothing to send. */
export function hasVariantChanges(diff: VariantDiff): boolean {
  return diff.toCreate.length > 0 || diff.toUpdate.length > 0 || diff.toRemove.length > 0;
}

/**
 * Apply a diff. Creates and updates go first, removals last, so replacing a
 * product's whole variant set never transiently empties it and trips the
 * server's "needs at least one variant" guard.
 */
export async function applyVariantChanges(
  productId: string,
  diff: VariantDiff
): Promise<void> {
  for (const body of diff.toCreate) {
    await productsApi.variants.create(productId, body);
  }
  for (const { id, changes } of diff.toUpdate) {
    await productsApi.variants.update(productId, id, changes);
  }
  for (const id of diff.toRemove) {
    await productsApi.variants.remove(productId, id);
  }
}
