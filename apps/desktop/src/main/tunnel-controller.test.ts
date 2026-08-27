import { describe, expect, it } from 'vitest';
import { TunnelController, classifyTunnelControlPlaneLog } from './tunnel-controller.js';

describe('tunnel gateway health', () => {
  it('classifies known transport failures without exposing raw log text', () => {
    expect(classifyTunnelControlPlaneLog('2026-08-28 transport error: ExceptionGroup unhandled errors in a TaskGroup secret-token'))
      .toEqual({ state: 'unhealthy', message: 'Tunnel log contains a recent transport or control-plane failure signal' });
    expect(classifyTunnelControlPlaneLog('tunnel established; health status=live'))
      .toEqual({ state: 'live', message: 'Tunnel log contains a recent connected/ready signal' });
    expect(classifyTunnelControlPlaneLog('ordinary startup metadata'))
      .toEqual({ state: 'unknown', message: 'No bounded tunnel log signal proves control-plane health' });
  });

  it('returns layered unknown/unavailable evidence instead of a false healthy result', async () => {
    const controller = new TunnelController({
      getClientPath: (): string | null => null,
      setClientPath: (): void => undefined,
      getDataPath: (): string => 'C:\\NAVA-test-data',
      isExternalTunnelRunning: async (): Promise<boolean> => false,
    });

    await expect(controller.gatewayHealth()).resolves.toMatchObject({
      overall: 'unknown',
      process: { state: 'unavailable' },
      controlPlane: { state: 'unknown' },
      connectorSchema: { state: 'unknown' },
    });
  });
});
