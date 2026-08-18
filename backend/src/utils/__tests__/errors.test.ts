import { describe, it, expect } from 'vitest';
import { NotFoundError } from '../errors';

/**
 * `NotFoundError` takes a resource name and appends "not found" itself.
 *
 * 45 call sites across the routes pass the whole sentence instead, which read
 * back to users as "User not found not found". Both spellings are accepted
 * because relying on nobody repeating a reasonable mistake is not a plan.
 */
describe('NotFoundError', () => {
  it('appends the suffix to a bare resource name', () => {
    expect(new NotFoundError('User').message).toBe('User not found');
  });

  it('does not double the suffix when the caller already supplied it', () => {
    expect(new NotFoundError('User not found').message).toBe('User not found');
  });

  it('is case- and whitespace-insensitive about the supplied suffix', () => {
    expect(new NotFoundError('Order  Not Found').message).toBe('Order not found');
  });

  it('keeps a resource whose name merely contains the words', () => {
    // "Not found page" is a thing that can itself be missing; only a trailing
    // suffix is stripped.
    expect(new NotFoundError('Not found page').message).toBe('Not found page not found');
  });

  it('defaults to a generic resource', () => {
    expect(new NotFoundError().message).toBe('Resource not found');
  });

  it('is a 404', () => {
    expect(new NotFoundError('User').statusCode).toBe(404);
  });
});
