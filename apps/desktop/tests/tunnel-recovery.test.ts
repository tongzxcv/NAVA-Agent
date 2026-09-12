import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, afterEach, type MockInstance } from 'vitest';
import { TunnelController } from '../src/main/tunnel-controller.js';
import { classifyTunnelConnection } from '../src/main/tunnel-connection-monitor.js';
import type { TunnelGatewayHealth, TunnelStatus } from '@lnwjud/ipc-contracts';

const live = { state: 'live' as const, message: 'live' };
const failed: TunnelGatewayHealth = { overall: 'unhealthy', observedAt: '', process: live,
  localMcp: { state: 'unhealthy', message: 'child dead' }, requestPath: { state: 'unhealthy', message: 'no response' },
  controlPlane: live, connectorSchema: { state: 'unknown', message: '' }, message: '' };

interface ControllerInternals {
  child: unknown; tunnelLock: unknown; state: string; lastApiKey: string; intentionalStop: boolean;
  killOwnedChild(): Promise<void>; spawnRun(): void; readExitHint(): Promise<string>; restartAttempts: number;
}
function fixture(): { controller: TunnelController; internals: ControllerInternals; kill: MockInstance; spawn: MockInstance } {
  const controller = new TunnelController({ getClientPath: (): string => 'fixture.exe', setClientPath: (): void => {}, getDataPath: (): string => '.', maxAutoRestarts: (): number => 2 });
  vi.spyOn(controller, 'resolveClientPath').mockReturnValue('fixture.exe');
  // Exercise the controller lifecycle with no real process, profile, or credentials.
  const child = Object.assign(new EventEmitter(), { exitCode: null, pid: 123 });
  const internals = controller as unknown as ControllerInternals;
  internals.child = child; internals.tunnelLock = { owner: { pid: 1 } }; internals.state = 'running'; internals.lastApiKey = 'fixture';
  const kill = vi.spyOn(internals, 'killOwnedChild').mockImplementation(async () => { internals.child = null; });
  vi.spyOn(internals, 'readExitHint').mockResolvedValue('fixture failure');
  const spawn = vi.spyOn(internals, 'spawnRun').mockImplementation(() => { internals.child = child; });
  return { controller, internals, kill, spawn };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('MCP path recovery', () => {
  it('never shows connected for a dead MCP even with stale overall live', () => {
    expect(classifyTunnelConnection({ state: 'running', health: { ...failed, overall: 'live' } } as TunnelStatus)).not.toBe('healthy');
  });
  it('debounces transient failures and restarts once for sustained failure without touching bindings', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.controller.observeHealth(failed, 1000);
    f.controller.observeHealth({ ...failed, overall: 'live', localMcp: live, requestPath: live }, 2000);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.kill).not.toHaveBeenCalled();
    f.controller.observeHealth(failed, 3000);
    f.controller.observeHealth(failed, 8000);
    f.controller.observeHealth(failed, 13000);
    f.controller.observeHealth(failed, 13000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.kill).toHaveBeenCalledTimes(1); expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.internals.tunnelLock).toEqual({ owner: { pid: 1 } });
  });
  it('does not restart an external tunnel or a busy path', async () => {
    vi.useFakeTimers(); const f = fixture(); f.internals.tunnelLock = null;
    for (const time of [1, 6000, 12000]) f.controller.observeHealth(failed, time);
    await vi.advanceTimersByTimeAsync(4000); expect(f.kill).not.toHaveBeenCalled();
    f.internals.tunnelLock = {};
    for (const time of [1, 6000, 12000]) f.controller.observeHealth({ ...failed, overall: 'unknown', requestPath: { state: 'unknown', message: 'busy' } }, time);
    await vi.advanceTimersByTimeAsync(4000); expect(f.kill).not.toHaveBeenCalled();
  });
  it('exhausts retry budget instead of resetting it merely because PID stays alive', async () => {
    vi.useFakeTimers(); const f = fixture();
    for (let attempt = 0; attempt < 4; attempt++) {
      for (const offset of [1, 6000, 12000]) f.controller.observeHealth(failed, attempt * 30000 + offset);
      await vi.advanceTimersByTimeAsync(31000);
    }
    expect(f.spawn).toHaveBeenCalledTimes(2);
    expect(f.internals.state).toBe('error');
  });
  it('cancels queued recovery when the user intentionally stops', async () => {
    vi.useFakeTimers(); const f = fixture();
    for (const time of [1, 6000, 12000]) f.controller.observeHealth(failed, time);
    // Stop sets cancellation synchronously, before the queued operation enters.
    const internals = f.controller as unknown as { requestStop(): Promise<TunnelStatus>; stopOnce(): Promise<TunnelStatus> };
    vi.spyOn(internals, 'stopOnce').mockResolvedValue({ state: 'stopped' } as TunnelStatus);
    await internals.requestStop();
    await vi.advanceTimersByTimeAsync(31000);
    expect(f.spawn).not.toHaveBeenCalled();
    expect(f.kill).not.toHaveBeenCalled();
  });
});
