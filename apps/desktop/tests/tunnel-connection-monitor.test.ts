import type { TunnelStatus } from '@lnwjud/ipc-contracts';
import { describe, expect, it } from 'vitest';
import {
  classifyTunnelConnection,
  TunnelConnectionMonitor,
} from '../src/main/tunnel-connection-monitor.js';

function status(
  state: TunnelStatus['state'],
  health: TunnelStatus['health'] extends infer T ? T : never = undefined,
  message: string | null = null,
): TunnelStatus {
  return {
    state,
    source: 'desktop',
    hasApiKey: true,
    clientPath: 'C:\\tunnel-client.exe',
    profileExists: true,
    message,
    logPath: 'C:\\lnwjud-tunnel.log',
    ...(health === undefined ? {} : { health }),
  };
}

const liveHealth: NonNullable<TunnelStatus['health']> = {
  overall: 'live',
  observedAt: new Date(0).toISOString(),
  process: { state: 'live', message: 'process live' },
  localMcp: { state: 'live', message: 'mcp live' },
  requestPath: { state: 'live', message: 'dispatcher ping live' },
  controlPlane: { state: 'live', message: 'control plane live' },
  connectorSchema: { state: 'unknown', message: 'not observable' },
  message: 'live',
};

const unhealthyHealth: NonNullable<TunnelStatus['health']> = {
  ...liveHealth,
  overall: 'unhealthy',
  localMcp: { state: 'unhealthy', message: 'MCP health failed' },
  message: 'One or more observable tunnel layers are unhealthy',
};

const unknownControlPlaneHealth: NonNullable<TunnelStatus['health']> = {
  ...liveHealth,
  overall: 'unknown',
  controlPlane: { state: 'unknown', message: 'control-plane state unknown' },
  message: 'health inconclusive',
};

const busyHealth: NonNullable<TunnelStatus['health']> = {
  ...liveHealth,
  overall: 'unknown',
  localMcp: { state: 'unknown', message: 'MCP dispatcher is busy; awaiting active request' },
  requestPath: { state: 'unknown', message: 'MCP dispatcher is busy; awaiting active request' },
  message: 'health inconclusive while request is active',
};

const unknownRequestPathHealth: NonNullable<TunnelStatus['health']> = {
  ...liveHealth,
  overall: 'unknown',
  localMcp: { state: 'unknown', message: 'probe inconclusive' },
  requestPath: { state: 'unknown', message: 'probe inconclusive' },
  message: 'health inconclusive',
};

describe('tunnel connection notification monitor', () => {
  it('classifies stopped, healthy, busy, recovering, and disconnected states', () => {
    expect(classifyTunnelConnection(status('stopped'))).toBe('stopped');
    expect(classifyTunnelConnection(status('running', liveHealth))).toBe('healthy');
    expect(classifyTunnelConnection(status('running', unknownControlPlaneHealth))).toBe('healthy');
    expect(classifyTunnelConnection(status('running', busyHealth))).toBe('busy');
    expect(classifyTunnelConnection(status('starting', unknownControlPlaneHealth))).toBe('recovering');
    expect(classifyTunnelConnection(status('running', unknownRequestPathHealth))).toBe('recovering');
    expect(classifyTunnelConnection(status('running', unhealthyHealth))).toBe('disconnected');
    expect(classifyTunnelConnection(status('error', unhealthyHealth, 'tunnel exited'))).toBe('disconnected');
  });

  it('does not notify for a short transient failure', () => {
    const monitor = new TunnelConnectionMonitor(10_000);
    expect(monitor.observe(status('running', liveHealth), 0).alerts).toEqual([]);
    expect(monitor.observe(status('running', unhealthyHealth), 1_000).alerts).toEqual([]);
    expect(monitor.observe(status('running', unhealthyHealth), 9_000).alerts).toEqual([]);
    expect(monitor.observe(status('running', liveHealth), 9_500).alerts).toEqual([]);
  });

  it('keeps a long serialized busy request out of loss/recovery notifications', () => {
    const monitor = new TunnelConnectionMonitor(10_000);
    expect(monitor.observe(status('running', liveHealth), 0)).toEqual({ state: 'healthy', alerts: [] });

    for (const now of [1_000, 11_000, 31_000, 61_000]) {
      expect(monitor.observe(status('running', busyHealth), now)).toEqual({ state: 'busy', alerts: [] });
    }

    expect(monitor.observe(status('running', liveHealth), 65_000)).toEqual({ state: 'healthy', alerts: [] });
  });

  it('uses busy liveness to cancel an unannounced transient failure', () => {
    const monitor = new TunnelConnectionMonitor(10_000);
    monitor.observe(status('running', liveHealth), 0);
    monitor.observe(status('running', unhealthyHealth), 1_000);
    expect(monitor.observe(status('running', busyHealth), 5_000)).toEqual({ state: 'busy', alerts: [] });
    expect(monitor.observe(status('running', liveHealth), 20_000)).toEqual({ state: 'healthy', alerts: [] });
  });

  it('notifies once after a sustained loss, then recovering, then recovered with downtime', () => {
    const monitor = new TunnelConnectionMonitor(10_000);
    monitor.observe(status('running', liveHealth), 0);
    monitor.observe(status('error', unhealthyHealth, 'tunnel exited'), 1_000);

    const lost = monitor.observe(status('error', unhealthyHealth, 'tunnel exited'), 11_000);
    expect(lost.state).toBe('disconnected');
    expect(lost.alerts).toEqual([{ kind: 'lost', detail: 'tunnel exited' }]);

    const duplicate = monitor.observe(status('error', unhealthyHealth, 'tunnel exited'), 12_000);
    expect(duplicate.alerts).toEqual([]);

    const recovering = monitor.observe(status('starting', unknownControlPlaneHealth, 'Tunnel reconnecting'), 13_000);
    expect(recovering.state).toBe('recovering');
    expect(recovering.alerts).toEqual([{ kind: 'recovering' }]);

    const recovered = monitor.observe(status('running', liveHealth), 16_500);
    expect(recovered.state).toBe('healthy');
    expect(recovered.alerts).toEqual([{ kind: 'recovered', downtimeMs: 15_500 }]);
  });

  it('keeps announced loss accounting while a recovered request path is still busy', () => {
    const monitor = new TunnelConnectionMonitor(1_000);
    monitor.observe(status('running', liveHealth), 0);
    monitor.observe(status('running', unhealthyHealth), 100);
    expect(monitor.observe(status('running', unhealthyHealth), 1_100).alerts).toEqual([
      { kind: 'lost', detail: 'One or more observable tunnel layers are unhealthy' },
    ]);
    expect(monitor.observe(status('running', busyHealth), 1_200)).toEqual({
      state: 'recovering',
      alerts: [{ kind: 'recovering' }],
    });
    expect(monitor.observe(status('running', liveHealth), 2_000).alerts).toEqual([
      { kind: 'recovered', downtimeMs: 1_900 },
    ]);
  });

  it('treats an intentional stopped state as silent and resets failure tracking', () => {
    const monitor = new TunnelConnectionMonitor(1_000);
    monitor.observe(status('running', liveHealth), 0);
    monitor.observe(status('error', unhealthyHealth, 'tunnel exited'), 100);
    expect(monitor.observe(status('stopped'), 2_000)).toEqual({ state: 'stopped', alerts: [] });
    expect(monitor.observe(status('running', liveHealth), 3_000).alerts).toEqual([]);
  });

  it('reports exhausted recovery once and never shows green without a request-path observation', () => {
    const monitor = new TunnelConnectionMonitor(1000);
    monitor.observe(status('running', liveHealth), 0);
    const exhausted = { ...status('error', unhealthyHealth, 'Recovery failed'), recoveryExhausted: true };
    expect(monitor.observe(exhausted, 2000).alerts).toEqual([{ kind: 'failed', detail: 'Recovery failed' }]);
    expect(monitor.observe(exhausted, 2500).alerts).toEqual([]);
    expect(monitor.observe(status('stopped'), 3000).alerts).toEqual([]);
    const unobserved = { ...liveHealth };
    delete unobserved.requestPath;
    expect(classifyTunnelConnection(status('running', unobserved))).toBe('recovering');
  });
});
