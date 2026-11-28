/** Outbound text messages. `to` is 10 bare digits (US); adapters add the country prefix. */
export interface SmsPort {
  send(to: string, body: string): Promise<{ messageId?: string }>;
}

/** Raised when SMS is off or its credentials are incomplete: unavailable, never a fake success. */
export class SmsNotConfiguredError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'SmsNotConfiguredError';
  }
}
