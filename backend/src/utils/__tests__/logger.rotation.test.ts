import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * The log file is bounded.
 *
 * The file transport was configured with a filename and nothing else, so
 * `/app/logs/app.log` sat on a Docker volume and grew for the life of the
 * install. A shop writing a line per request fills a disk eventually — months
 * after anything changed, which makes it a miserable outage to diagnose and an
 * easy one to prevent.
 */
const { default: config } = await import('../../config');
const { fileTransportOptions } = await import('../logger');

const original = { ...config.logging };

beforeEach(() => {
  config.logging.file = '/app/logs/app.log';
  config.logging.maxSizeMb = 20;
  config.logging.maxFiles = 5;
});

afterEach(() => {
  Object.assign(config.logging, original);
});

describe('fileTransportOptions', () => {
  it('caps the file size and the number kept', () => {
    const options = fileTransportOptions();

    expect(options.maxsize).toBe(20 * 1024 * 1024);
    expect(options.maxFiles).toBe(5);
  });

  it('bounds the total on disk to something an operator can reason about', () => {
    // 20 MB × 5 is 100 MB, which is the number that belongs in the operations
    // guide. A cap on file size alone still grows without limit.
    const options = fileTransportOptions();

    expect(options.maxsize * options.maxFiles).toBe(100 * 1024 * 1024);
  });

  it('keeps the newest entries in the file people tail', () => {
    // Without `tailable`, winston rotates by writing the *new* file under an
    // indexed name, leaving `app.log` as the oldest — so the obvious command
    // shows stale lines during an incident.
    expect(fileTransportOptions().tailable).toBe(true);
  });

  it('honours a smaller budget on a small disk', () => {
    config.logging.maxSizeMb = 5;
    config.logging.maxFiles = 2;

    const options = fileTransportOptions();

    expect(options.maxsize).toBe(5 * 1024 * 1024);
    expect(options.maxFiles).toBe(2);
  });

  it('points at the configured file', () => {
    config.logging.file = '/var/log/stewardpos.log';

    expect(fileTransportOptions().filename).toBe('/var/log/stewardpos.log');
  });
});
