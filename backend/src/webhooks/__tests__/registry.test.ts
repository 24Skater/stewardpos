import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const getSettings = vi.fn();
const claimWebhookEvent = vi.fn();
const markWebhookEventHandled = vi.fn();

vi.mock('../../services/database', () => ({
  default: { getAdapter: () => ({ getSettings, claimWebhookEvent, markWebhookEventHandled }) },
}));

const { default: app } = await import('../../app');
const { registerHandler } = await import('../registry');

const verify = vi.fn();
const handle = vi.fn();

registerHandler({
  provider: 'fake',
  isConfigured: () => true,
  verify,
  parse: (raw) => {
    const body = JSON.parse(raw.toString('utf8')) as { id: string };
    return { id: body.id, type: 'fake.event', payload: body };
  },
  handle,
});

function post(provider: string) {
  return request(app)
    .post(`/api/webhooks/${provider}`)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ id: 'evt_a' }));
}

beforeEach(() => {
  verify.mockReset();
  handle.mockReset();
  getSettings.mockReset();
  claimWebhookEvent.mockReset();
  markWebhookEventHandled.mockReset();
  getSettings.mockResolvedValue({});
  verify.mockReturnValue(true);
  claimWebhookEvent.mockResolvedValue(true);
  handle.mockResolvedValue(undefined);
  markWebhookEventHandled.mockResolvedValue(undefined);
});

describe('inbound webhook registry', () => {
  it('answers 404 for an unknown provider', async () => {
    const response = await post('nobody');

    expect(response.status).toBe(404);
    expect(claimWebhookEvent).not.toHaveBeenCalled();
  });

  it('answers 400 and stores nothing when verification fails', async () => {
    verify.mockReturnValue(false);

    const response = await post('fake');

    expect(response.status).toBe(400);
    expect(claimWebhookEvent).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it('handles a redelivered event once', async () => {
    claimWebhookEvent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await post('fake');
    const second = await post('fake');

    expect(second.body.duplicate).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
