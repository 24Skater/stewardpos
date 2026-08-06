import { describe, expect, it } from 'vitest';
import { qs } from '../qs';

describe('qs', () => {
  it('returns an empty string when there are no params', () => {
    expect(qs()).toBe('');
    expect(qs({})).toBe('');
  });

  it('prefixes with ? and joins pairs', () => {
    expect(qs({ status: 'pending', limit: 10 })).toBe('?status=pending&limit=10');
  });

  it('omits undefined, null, and empty-string values', () => {
    expect(qs({ status: undefined, customerId: null, query: '', limit: 5 })).toBe('?limit=5');
  });

  it('returns an empty string, not a bare ?, when every value is dropped', () => {
    expect(qs({ status: undefined, query: '' })).toBe('');
  });

  it('keeps falsy-but-meaningful values', () => {
    expect(qs({ offset: 0, stackable: false })).toBe('?offset=0&stackable=false');
  });

  it('percent-encodes values so they survive the URL', () => {
    expect(qs({ query: 'a&b=c d' })).toBe('?query=a%26b%3Dc+d');
  });

  it('skips object values rather than serialising them as [object Object]', () => {
    expect(qs({ nested: { a: 1 }, limit: 2 })).toBe('?limit=2');
  });
});
