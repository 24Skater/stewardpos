import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { partialUpdate } from '../zod';

const create = z.object({
  name: z.string().min(1),
  isActive: z.boolean().default(true),
  color: z.string().default('gray'),
});

describe('partialUpdate', () => {
  it('leaves omitted fields out instead of filling in their defaults', () => {
    expect(partialUpdate(create).parse({ name: 'Staff' })).toEqual({ name: 'Staff' });
  });

  it('still validates the fields that are sent', () => {
    expect(() => partialUpdate(create).parse({ name: '' })).toThrow();
    expect(() => partialUpdate(create).parse({ isActive: 'yes' })).toThrow();
    expect(partialUpdate(create).parse({ isActive: false })).toEqual({ isActive: false });
  });
});
