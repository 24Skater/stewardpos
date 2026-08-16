import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { assertProductionSecrets } from '../secrets';

/**
 * The stacks this repository ships can start themselves.
 *
 * Written after breaking exactly that. The production secret check is correct —
 * an install must not sign sessions with a key published on the internet — but
 * `docker-compose.yml` defaulted `NODE_ENV` to `production` while also
 * defaulting `JWT_SECRET` to `CHANGE_THIS_MIN_32_CHARACTERS_SECRET`, so the new
 * guard refused to start the repository's own development stack. CI found it in
 * the E2E job, which could no longer sign in because the seeder had made the
 * same judgement about the same label.
 *
 * The label was the bug: a stack with localhost CORS origins, every port
 * published to the host and committed placeholder credentials is not
 * production. These tests keep the two from drifting apart again — a compose
 * file that claims production now has to mean it.
 */
const ROOT = path.resolve(__dirname, '../../../..');

/** `${VAR:-default}` → `default`; a literal → itself. */
function resolveDefault(value: unknown): string | undefined {
  // YAML parses bare `1` and `false` as a number and a boolean; docker compose
  // passes both to the container as strings, so read them the same way.
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return undefined;

  const interpolated = /^\$\{[A-Z_]+:-(.*)\}$/.exec(value);
  if (interpolated) return interpolated[1];
  if (value.startsWith('${')) return undefined; // required, no default
  return value;
}

/** The backend environment a compose file starts with when nothing is set. */
function backendDefaults(file: string): NodeJS.ProcessEnv {
  const parsed = yaml.load(fs.readFileSync(path.join(ROOT, file), 'utf8')) as {
    services: { backend: { environment: Record<string, unknown> } };
  };

  const env: NodeJS.ProcessEnv = {};
  for (const [key, raw] of Object.entries(parsed.services.backend.environment)) {
    const value = resolveDefault(raw);
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** Every compose file here that is meant to run without an operator filling in `.env`. */
const SELF_STARTING = ['docker-compose.yml', 'docker-compose.demo.yml'];

describe.each(SELF_STARTING)('%s', (file) => {
  it('starts on its own defaults', () => {
    // The check this asserts against is the one that refused to start the
    // development stack. If this fails, either the compose file has started
    // claiming production, or its placeholder secrets have.
    expect(() => assertProductionSecrets(backendDefaults(file))).not.toThrow();
  });

  it('does not claim to be production while shipping placeholder secrets', () => {
    const env = backendDefaults(file);

    if (env.NODE_ENV === 'production') {
      // Allowed — but then the secrets must be real, which for a committed file
      // means they must have no defaults at all.
      expect(env.JWT_SECRET).toBeUndefined();
      expect(env.DB_PASSWORD).toBeUndefined();
    }
  });

  it('does not seed a database it calls production', () => {
    // The seeder writes admin@demo.local with a password printed in this
    // repository and refuses to do so in production. A file that sets both
    // would come up with no administrator at all and no obvious reason why —
    // which is precisely how the demo profile broke.
    const env = backendDefaults(file);

    if (env.AUTO_SEED === 'true') {
      expect(env.NODE_ENV).not.toBe('production');
    }
  });
});

describe('docker-compose.prod.yml', () => {
  it('requires every secret rather than defaulting one', () => {
    // The opposite obligation: the production stack must not carry a usable
    // default for anything that signs or authenticates, or an operator can skip
    // a line and never find out.
    const env = backendDefaults('docker-compose.prod.yml');

    expect(env.JWT_SECRET).toBeUndefined();
    expect(env.DB_PASSWORD).toBeUndefined();
  });

  it('is production, and does not seed', () => {
    const env = backendDefaults('docker-compose.prod.yml');

    expect(env.NODE_ENV).toBe('production');
    expect(env.AUTO_SEED).toBe('false');
  });

  it('trusts exactly one proxy, because exactly one is in front of it', () => {
    // Caddy routes /api straight to the backend rather than through the
    // frontend's nginx. Too low and every terminal shares one rate-limit
    // bucket; too high and a forged X-Forwarded-For walks past the limits.
    expect(backendDefaults('docker-compose.prod.yml').TRUST_PROXY).toBe('1');
  });
});
