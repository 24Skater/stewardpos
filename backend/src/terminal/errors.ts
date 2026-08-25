/**
 * Errors a terminal adapter raises that a route needs to tell apart.
 *
 * Kept out of `TerminalAdapterFactory` because the adapters throw these and the
 * factory imports the adapters — putting them there would make the cycle.
 */

/**
 * Raised when a provider is integrated for taking payments but not for
 * returning them.
 *
 * Refunds arrived with Stripe first, and the remaining providers each need
 * their own SDK call, their own status vocabulary and their own test account
 * before anyone should trust them with money going the other way. Throwing is
 * the honest answer in the meantime: the clerk is told to refund in the
 * provider's own dashboard and the return stays open, which is recoverable.
 * Returning a cheerful success would not be.
 */
/**
 * Raised when the reader cannot take this payment right now.
 *
 * Distinct from a genuine fault: the shop is not broken, the reader is busy,
 * unplugged, or on the wrong side of a dead internet connection. Each of those
 * has something a cashier can actually do about it, and none of them is the
 * `500` the vendor SDK's own error used to produce — which reads as "the till
 * is down" and sends somebody looking for the wrong problem.
 *
 * `retryable` distinguishes "try that again" from "this will keep failing until
 * something changes", so the POS can offer the right button.
 */
export class TerminalUnavailableError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'TerminalUnavailableError';
    this.code = code;
    this.retryable = retryable;
  }
}

export class RefundNotSupportedError extends Error {
  constructor(provider: string) {
    super(
      `StewardPOS cannot yet send refunds to ${provider}. ` +
        `Refund this sale in the ${provider} dashboard, then record it here as a cash or store credit refund.`
    );
    this.name = 'RefundNotSupportedError';
  }
}
