import { z } from 'zod';

/**
 * `schema.partial()` for update bodies, minus the create schema's defaults.
 *
 * Zod 4 applies `.default()` even inside optional fields, so a plain
 * `.partial()` fills every omitted field with its default and the update
 * writes it back: renaming a discount would reset `isActive` and `color`.
 */
export function partialUpdate<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>
): z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.unwrap() : field,
    ])
  );
  return z.object(shape).partial() as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }>;
}
