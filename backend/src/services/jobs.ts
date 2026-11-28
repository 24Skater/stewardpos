import logger from '../utils/logger';

/**
 * Run `fn` every `intervalMs`. A run that is still going when the next tick
 * fires is skipped, so a slow pass never stacks up behind itself. Errors are
 * logged and the schedule carries on.
 */
export function startJob(name: string, intervalMs: number, fn: () => Promise<void>): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (error) {
      logger.error(`Job ${name} failed:`, error);
    } finally {
      running = false;
    }
  }, intervalMs);
  // Do not keep the process alive just for the schedule.
  timer.unref();
  return timer;
}
