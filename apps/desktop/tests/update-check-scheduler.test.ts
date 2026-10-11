import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_UPDATE_CHECK_INTERVAL_MS, AUTO_UPDATE_STARTUP_DELAY_MS, isNavaReleaseFeedInaccessibleError, UpdateCheckScheduler } from '../src/main/update-check-scheduler.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('automatic update check scheduler', () => {
  it('recognizes only HTTP 404 on NAVA-owned release endpoints', () => {
    expect(isNavaReleaseFeedInaccessibleError('404 method: GET url: https://github.com/tongzxcv/NAVA-Agent/releases.atom')).toBe(true);
    expect(isNavaReleaseFeedInaccessibleError('404 method: GET url: https://github.com/example/other/releases.atom')).toBe(false);
    expect(isNavaReleaseFeedInaccessibleError('404 method: GET url: https://api.github.com/repos/tongzxcv/NAVA-Agent/releases/latest')).toBe(true);
    expect(isNavaReleaseFeedInaccessibleError('404 method: GET url: https://github.com/tongzxcv/NAVA-Agent/releases/download/v4.12.1/latest.yml')).toBe(true);
    expect(isNavaReleaseFeedInaccessibleError('404 method: GET url: https://github.com/engasnm111/lnwjud/releases.atom')).toBe(false);
    expect(isNavaReleaseFeedInaccessibleError('403 method: GET url: https://github.com/tongzxcv/NAVA-Agent/releases.atom')).toBe(false);
    expect(isNavaReleaseFeedInaccessibleError('500 method: GET url: https://github.com/tongzxcv/NAVA-Agent/releases.atom')).toBe(false);
  });
  it('checks once shortly after startup and then every 30 minutes', async () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const scheduler = new UpdateCheckScheduler({ check });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_STARTUP_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS - AUTO_UPDATE_STARTUP_DELAY_MS);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(AUTO_UPDATE_CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('can skip the startup check while keeping the recurring interval', async () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const scheduler = new UpdateCheckScheduler({ check, startupDelayMs: 10, intervalMs: 100, checkOnStartup: false });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(99);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('does not create duplicate timers and stops all future checks', async () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const scheduler = new UpdateCheckScheduler({ check, startupDelayMs: 10, intervalMs: 100 });
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(110);
    expect(check).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
