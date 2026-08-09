import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  AuthenticationError,
  UnauthorizedError,
  AuthorizationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ServiceUnavailableError,
  DatabaseError,
  getErrorMessage,
  errorProps,
} from '../errors';

/**
 * The error vocabulary, and the two helpers every catch block uses.
 *
 * The status codes are the contract the whole API answers on: a client
 * distinguishes "you sent something wrong" from "you may not" from "it is not
 * there" by the number, not the prose. Getting one wrong makes a retry loop
 * hammer a request that will never succeed, or makes a fixable mistake look
 * like an outage.
 *
 * `getErrorMessage` exists because `catch` bindings are `unknown` and anything
 * can be thrown. Reaching for `error.message` directly is how a thrown string —
 * or a thrown object with a hostile `toString` — turns an error path into a
 * second, worse error.
 */
describe('status codes', () => {
  const cases: Array<[AppError, number]> = [
    [new ValidationError('bad input'), 400],
    [new AuthenticationError('who are you'), 401],
    [new UnauthorizedError('no'), 401],
    [new AuthorizationError('not allowed'), 403],
    [new ForbiddenError('not allowed'), 403],
    [new NotFoundError('gone'), 404],
    [new ConflictError('already exists'), 409],
    [new ServiceUnavailableError('mail is down'), 502],
    [new DatabaseError(), 500],
  ];

  for (const [error, status] of cases) {
    it(`${error.constructor.name} answers ${status}`, () => {
      expect(error.statusCode).toBe(status);
    });
  }

  it('keeps 4xx and 5xx meaningfully apart', () => {
    // A 4xx says "change the request"; a 5xx says "try again or call someone".
    // Anything mislabelled sends the caller down the wrong path entirely.
    expect(new ValidationError('x').statusCode).toBeLessThan(500);
    expect(new NotFoundError('x').statusCode).toBeLessThan(500);
    expect(new DatabaseError().statusCode).toBeGreaterThanOrEqual(500);
  });

  it('marks them operational, so the handler can tell them from a crash', () => {
    expect(new ValidationError('x').isOperational).toBe(true);
  });

  it('carries the message through', () => {
    expect(new ConflictError('already exists').message).toBe('already exists');
  });

  it('NotFoundError names the resource rather than passing a sentence through', () => {
    // It takes a *resource*, not a message, and phrases it — so callers pass
    // "Product", not "Product not found", or the response reads "Product not
    // found not found". Worth pinning because every other error here takes a
    // message, and the signature is the odd one out.
    expect(new NotFoundError('Product').message).toBe('Product not found');
    expect(new NotFoundError().message).toBe('Resource not found');
  });

  it('gives DatabaseError a default that says nothing about the schema', () => {
    // It reaches the client on a 500; naming the table or column would hand out
    // the schema to anyone who can trip an error.
    const message = new DatabaseError().message;

    expect(message).toBeTruthy();
    expect(message.toLowerCase()).not.toMatch(/select|insert|table|column|constraint/);
  });

  it('is a real Error, so a stack is captured', () => {
    const error = new ValidationError('x');

    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toBeTruthy();
  });
});

describe('getErrorMessage', () => {
  it('reads the message off an Error', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('reads a subclass too', () => {
    expect(getErrorMessage(new ValidationError('bad input'))).toBe('bad input');
  });

  it('passes a thrown string through', () => {
    expect(getErrorMessage('just a string')).toBe('just a string');
  });

  it('falls back for null and undefined', () => {
    expect(getErrorMessage(null)).toBe('An unexpected error occurred');
    expect(getErrorMessage(undefined)).toBe('An unexpected error occurred');
  });

  it('falls back for a plain object rather than printing [object Object]', () => {
    expect(getErrorMessage({ message: 'looks like an error' })).toBe(
      'An unexpected error occurred'
    );
  });

  it('does not invoke a hostile toString', () => {
    // A value whose `toString` throws would turn the error path into a second,
    // worse error — one raised while reporting the first.
    const hostile = {
      toString() {
        throw new Error('nope');
      },
    };

    expect(() => getErrorMessage(hostile)).not.toThrow();
  });

  it('falls back for a number', () => {
    expect(getErrorMessage(500)).toBe('An unexpected error occurred');
  });
});

describe('errorProps', () => {
  it('exposes driver fields that are not on Error', () => {
    // Postgres puts `code` and `constraint` on the thrown object; the customer
    // delete path reads them to explain a foreign-key refusal.
    const violation = Object.assign(new Error('fk'), {
      code: '23503',
      constraint: 'orders_customer_id_fkey',
    });

    expect(errorProps(violation)).toMatchObject({ code: '23503' });
  });

  it('reads unknown fields as undefined rather than throwing', () => {
    expect(errorProps(new Error('x')).code).toBeUndefined();
  });

  it('gives an empty record for null', () => {
    // `typeof null === 'object'`, so this is the case a naive check gets wrong
    // and then dereferences.
    expect(errorProps(null)).toEqual({});
  });

  it('gives an empty record for a primitive', () => {
    expect(errorProps('a string')).toEqual({});
    expect(errorProps(42)).toEqual({});
    expect(errorProps(undefined)).toEqual({});
  });

  it('lets a caller read a child-process failure', () => {
    const failure = Object.assign(new Error('command failed'), {
      stdout: '',
      stderr: 'npm ERR!',
    });

    expect(errorProps(failure).stderr).toBe('npm ERR!');
  });
});
