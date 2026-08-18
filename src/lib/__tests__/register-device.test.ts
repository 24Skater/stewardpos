import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `register-device.ts` caches whether `localStorage` is reachable in a
 * module-level variable, decided on first use. Each test gets a fresh module
 * instance via `vi.resetModules()` so that decision - and any selection made
 * through the previous instance - cannot leak between tests.
 */

describe('register-device', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  describe('get/set/clear', () => {
    it('starts with nothing selected', async () => {
      const { getSelectedRegisterId } = await import('../register-device');

      expect(getSelectedRegisterId()).toBeNull();
    });

    it('returns what was just selected', async () => {
      const { getSelectedRegisterId, setSelectedRegisterId } = await import('../register-device');

      setSelectedRegisterId('reg-1');

      expect(getSelectedRegisterId()).toBe('reg-1');
    });

    it('persists under a namespaced localStorage key', async () => {
      const { setSelectedRegisterId } = await import('../register-device');

      setSelectedRegisterId('reg-9');

      expect(localStorage.getItem('steward-terminal-register-id')).toBe('reg-9');
    });

    it('survives a fresh module load, same as a page reload would', async () => {
      const first = await import('../register-device');
      first.setSelectedRegisterId('reg-5');

      vi.resetModules();
      const second = await import('../register-device');

      expect(second.getSelectedRegisterId()).toBe('reg-5');
    });

    it('clears the selection', async () => {
      const { getSelectedRegisterId, setSelectedRegisterId, clearSelectedRegisterId } =
        await import('../register-device');

      setSelectedRegisterId('reg-1');
      clearSelectedRegisterId();

      expect(getSelectedRegisterId()).toBeNull();
    });

    it('overwrites a previous selection rather than merging', async () => {
      const { getSelectedRegisterId, setSelectedRegisterId } = await import('../register-device');

      setSelectedRegisterId('reg-1');
      setSelectedRegisterId('reg-2');

      expect(getSelectedRegisterId()).toBe('reg-2');
    });
  });

  describe('subscribers', () => {
    it('notifies on set and on clear', async () => {
      const { setSelectedRegisterId, clearSelectedRegisterId, subscribeToSelectedRegisterId } =
        await import('../register-device');
      const listener = vi.fn();
      subscribeToSelectedRegisterId(listener);

      setSelectedRegisterId('reg-3');
      expect(listener).toHaveBeenLastCalledWith('reg-3');

      clearSelectedRegisterId();
      expect(listener).toHaveBeenLastCalledWith(null);
    });

    it('stops notifying once unsubscribed', async () => {
      const { setSelectedRegisterId, subscribeToSelectedRegisterId } = await import(
        '../register-device'
      );
      const listener = vi.fn();
      const unsubscribe = subscribeToSelectedRegisterId(listener);

      unsubscribe();
      setSelectedRegisterId('reg-4');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('device token get/set/clear', () => {
    it('starts with no token', async () => {
      const { getDeviceToken } = await import('../register-device');

      expect(getDeviceToken()).toBeNull();
    });

    it('returns what was just set', async () => {
      const { getDeviceToken, setDeviceToken } = await import('../register-device');

      setDeviceToken('srt_abcd1234_secret');

      expect(getDeviceToken()).toBe('srt_abcd1234_secret');
    });

    it('persists under its own namespaced localStorage key, separate from the register id', async () => {
      const { setDeviceToken } = await import('../register-device');

      setDeviceToken('srt_abcd1234_secret');

      expect(localStorage.getItem('steward-terminal-register-token')).toBe('srt_abcd1234_secret');
      expect(localStorage.getItem('steward-terminal-register-id')).toBeNull();
    });

    it('survives a fresh module load, same as a page reload would', async () => {
      const first = await import('../register-device');
      first.setDeviceToken('srt_abcd1234_secret');

      vi.resetModules();
      const second = await import('../register-device');

      expect(second.getDeviceToken()).toBe('srt_abcd1234_secret');
    });

    it('clears the token', async () => {
      const { getDeviceToken, setDeviceToken, clearDeviceToken } = await import('../register-device');

      setDeviceToken('srt_abcd1234_secret');
      clearDeviceToken();

      expect(getDeviceToken()).toBeNull();
    });

    it('overwrites a previous token rather than merging', async () => {
      const { getDeviceToken, setDeviceToken } = await import('../register-device');

      setDeviceToken('srt_first_secret');
      setDeviceToken('srt_second_secret');

      expect(getDeviceToken()).toBe('srt_second_secret');
    });

    it('clearing the token does not clear the selected register id', async () => {
      const { getSelectedRegisterId, setSelectedRegisterId, setDeviceToken, clearDeviceToken } = await import(
        '../register-device'
      );

      setSelectedRegisterId('reg-1');
      setDeviceToken('srt_abcd1234_secret');
      clearDeviceToken();

      expect(getSelectedRegisterId()).toBe('reg-1');
    });
  });

  describe('when localStorage is unavailable', () => {
    it('degrades to an in-memory value instead of throwing (Safari private mode)', async () => {
      const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

      try {
        const { getSelectedRegisterId, setSelectedRegisterId } = await import(
          '../register-device'
        );

        expect(() => setSelectedRegisterId('reg-mem')).not.toThrow();
        expect(getSelectedRegisterId()).toBe('reg-mem');
        // Never actually reached localStorage - the write is what threw.
        expect(localStorage.getItem('steward-terminal-register-id')).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it('still supports clearing the in-memory value', async () => {
      const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

      try {
        const { getSelectedRegisterId, setSelectedRegisterId, clearSelectedRegisterId } =
          await import('../register-device');

        setSelectedRegisterId('reg-mem');
        clearSelectedRegisterId();

        expect(getSelectedRegisterId()).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it('still notifies subscribers when falling back to memory', async () => {
      const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

      try {
        const { setSelectedRegisterId, subscribeToSelectedRegisterId } = await import(
          '../register-device'
        );
        const listener = vi.fn();
        subscribeToSelectedRegisterId(listener);

        setSelectedRegisterId('reg-mem');

        expect(listener).toHaveBeenCalledWith('reg-mem');
      } finally {
        spy.mockRestore();
      }
    });

    it('degrades the device token to an in-memory value instead of throwing', async () => {
      const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

      try {
        const { getDeviceToken, setDeviceToken } = await import('../register-device');

        expect(() => setDeviceToken('srt_mem_secret')).not.toThrow();
        expect(getDeviceToken()).toBe('srt_mem_secret');
        // Never actually reached localStorage - the write is what threw.
        expect(localStorage.getItem('steward-terminal-register-token')).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it('still supports clearing the in-memory device token', async () => {
      const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

      try {
        const { getDeviceToken, setDeviceToken, clearDeviceToken } = await import('../register-device');

        setDeviceToken('srt_mem_secret');
        clearDeviceToken();

        expect(getDeviceToken()).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
