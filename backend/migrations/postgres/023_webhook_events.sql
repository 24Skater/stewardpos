-- Every Stripe event we have already acted on.
--
-- Stripe does not guarantee that events arrive once, or in order. The same
-- event is redelivered whenever a previous attempt failed or timed out, and a
-- manual resend from the dashboard does not replace the automatic retries. So a
-- handler that simply does the work each time it is called will do it twice.
--
-- For the outcomes this handles today that is mostly harmless — marking a
-- payment authorized twice is the same as marking it once — but "mostly
-- harmless" is not a property to rely on in a payments path, and it stops being
-- true the moment a handler does anything cumulative.
--
-- The primary key is Stripe's own event id, so the insert *is* the check: a
-- duplicate collides and the handler stops, with no read-then-write race
-- between two deliveries arriving at the same moment.

CREATE TABLE IF NOT EXISTS webhook_events (
  -- Stripe's `evt_...`. Their id, not ours, because theirs is what identifies
  -- the delivery we are deduplicating.
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- What the event was about, for tracing a payment back through deliveries
  -- without keeping the whole payload.
  charge_id VARCHAR(255),

  -- Set when the handler finished. A row with this still null is an event we
  -- accepted and then failed to process, which is worth being able to find.
  handled_at TIMESTAMPTZ,
  handler_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_charge_id
  ON webhook_events(charge_id);

-- Events we took in but never finished, oldest first.
CREATE INDEX IF NOT EXISTS idx_webhook_events_unhandled
  ON webhook_events(received_at)
  WHERE handled_at IS NULL;

INSERT INTO schema_migrations (version, name) VALUES (23, '023_webhook_events')
ON CONFLICT (version) DO NOTHING;
