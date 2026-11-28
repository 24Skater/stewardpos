import type { IncomingHttpHeaders } from 'http';

export type InboundSettings = Record<string, unknown> | null | undefined;

/** A provider's delivery, reduced to what deduplication and the handler need. */
export interface InboundEvent {
  id: string;
  type: string;
  chargeId?: string;
  payload: unknown;
}

export interface InboundHandler {
  provider: string;
  /** False when no signing secret exists; the route answers 503 rather than accept unverified events. */
  isConfigured(settings: InboundSettings): boolean;
  /** Checks the signature over the exact bytes received. */
  verify(rawBody: Buffer, headers: IncomingHttpHeaders, settings: InboundSettings): boolean;
  /** Only called after verify succeeds. */
  parse(rawBody: Buffer): InboundEvent;
  handle(event: InboundEvent): Promise<void>;
}

const handlers = new Map<string, InboundHandler>();

export function registerHandler(handler: InboundHandler): void {
  handlers.set(handler.provider, handler);
}

export function getHandler(provider: string): InboundHandler | undefined {
  return handlers.get(provider);
}
