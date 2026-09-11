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

const unknownHealth: NonNullable<TunnelStatus['health']> = {
  ...liveHealth,
  overall: 'unknown',
  controlPlane: { state: 'unknown', message: 'control-plane state unknown' },
  message: 'health inconclusive',
};

describe('tunnel connection notification monitor', () => {
  it('classifies user-stopped, healthy, recovering, and disconnected states', () => {
    expect(classifyTunnelConnection(status('stopped'))).toBe('stopped');
    expect(classifyTunnelConnection(status('running', liveHealth))).toBe('healthy');
    expect(classifyTunnelConnection(status('starting', unknownHealth))).toBe('recovering');
    expect(classifyTunnelConnection(status('running', unknownHealth))).toBe('recovering');
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

  it('notifies once after a sustained loss, then recovering, then recovered with downtime', () => {
    const monitor = new TunnelConnectionMonitor(10_000);
    monitor.observe(status('running', liveHealth), 0);
    monitor.observe(status('error', unhealthyHealth, 'tunnel exited'), 1_000);

    const lost = monitor.observe(status('error', unhealthyHealth, 'tunnel exited'), 11_000);
    expect(lost.state).toBe('disconnected');
    expect(lost.alerts).toEqual([{ kind: 'lost', detail: 'tunnel exited' }]);

    const duplicate = monitor.observe(status('error', unhealthyHealth, 'tunnel exited'), 12_000);
    expect(duplicate.alerts).toEqual([]);

    const recovering = monitor.observe(status('starting', unknownHealth, 'Tunnel reconnecting'), 13_000);
    expect(recovering.state).toBe('recovering');
    expect(recovering.alerts).toEqual([{ kind: 'recovering' }]);

    const recovered = monitor.observe(status('running', liveHealth), 16_500);
    expect(recovered.state).toBe('healthy');
    expect(recovered.alerts).toEqual([{ kind: 'recovered', downtimeMs: 15_500 }]);
  });

  it('treats an intentional stopped state as silent and resets failure tracking', () => {
    const monitor = new TunnelConnectionMonitor(1_000);
    monitor.observe(status('running', liveHealth), 0);
    monitor.observe(status('error', unhealthyHealth, 'tunnel exited'), 100);
    expect(monitor.observe(status('stopped'), 2_000)).toEqual({ state: 'stopped', alerts: [] });
    expect(monitor.observe(status('running', liveHealth), 3_000).alerts).toEqual([]);
  });
});
