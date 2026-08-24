import { describe, it, expect } from 'vitest';
import { describeActor } from '../audit-actor';

/**
 * The audit screen's actor column. Its whole job is to be honest about who
 * did something, including when the answer is "not a person" — the rows that
 * were silently discarded until migration 021 made them storable.
 */
describe('describeActor', () => {
  it('names the person when there is one', () => {
    expect(describeActor({ userName: 'Casey', userEmail: 'casey@shop.test' })).toBe('Casey');
  });

  it('falls back to the email rather than giving up on a real user', () => {
    expect(describeActor({ userEmail: 'casey@shop.test' })).toBe('casey@shop.test');
  });

  it('names the API key, since "Unknown" hides the one detail that matters', () => {
    expect(describeActor({ actorLabel: 'api-key:Nightly sync' })).toBe('API key: Nightly sync');
  });

  it('describes a till device without repeating its id into the column', () => {
    expect(
      describeActor({ actorLabel: 'register:22222222-2222-2222-2222-222222222222' })
    ).toBe('Register (device)');
  });

  it('shows an unrecognised label as it stands rather than discarding it', () => {
    expect(describeActor({ actorLabel: 'scheduler' })).toBe('scheduler');
  });

  it('prefers a real user over a label if somehow both are present', () => {
    expect(describeActor({ userName: 'Casey', actorLabel: 'api-key:Nightly sync' })).toBe('Casey');
  });

  it('says plainly that nobody was signed in, instead of "Unknown"', () => {
    expect(describeActor({})).toBe('No signed-in user');
    expect(describeActor({ userName: null, userEmail: null, actorLabel: null })).toBe(
      'No signed-in user'
    );
  });
});
