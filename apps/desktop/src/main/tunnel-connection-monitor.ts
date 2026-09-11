import type { TunnelStatus } from '@lnwjud/ipc-contracts';

export const TUNNEL_ALERT_DEBOUNCE_MS = 10_000;

export type TunnelConnectionDisplayState = 'healthy' | 'recovering' | 'disconnected' | 'stopped';
export type TunnelConnectionAlertKind = 'lost' | 'recovering' | 'recovered';

export interface TunnelConnectionAlert {
  readonly kind: TunnelConnectionAlertKind;
  readonly downtimeMs?: number;
  readonly detail?: string | null;
}

export interface TunnelConnectionObservation {
  readonly state: TunnelConnectionDisplayState;
  readonly alerts: readonly TunnelConnectionAlert[];
}

export function classifyTunnelConnection(status: TunnelStatus): TunnelConnectionDisplayState {
  if (status.state === 'stopped' && status.message === null) return 'stopped';
  if (status.state === 'error') return 'disconnected';
  if (status.state === 'starting') return 'recovering';
  if (status.state !== 'running') return 'disconnected';

  switch (status.health?.overall) {
    case 'live': return 'healthy';
    case 'unhealthy':
    case 'unavailable': return 'disconnected';
    case 'unknown':
    case undefined: return 'recovering';
  }
}

export class TunnelConnectionMonitor {
  private displayState: TunnelConnectionDisplayState = 'stopped';
  private observedHealthy = false;
  private failureStartedAt: number | null = null;
  private lostNotified = false;
  private recoveringNotified = false;
  private previousRawState: TunnelConnectionDisplayState = 'stopped';

  public constructor(private readonly debounceMs = TUNNEL_ALERT_DEBOUNCE_MS) {}

  public observe(status: TunnelStatus, now = Date.now()): TunnelConnectionObservation {
    const rawState = classifyTunnelConnection(status);
    const alerts: TunnelConnectionAlert[] = [];

    if (rawState === 'stopped') {
      this.resetFailure();
      this.displayState = 'stopped';
      this.previousRawState = rawState;
      return { state: this.displayState, alerts };
    }

    if (rawState === 'healthy') {
      if (this.lostNotified && this.failureStartedAt !== null) {
        alerts.push({ kind: 'recovered', downtimeMs: Math.max(0, now - this.failureStartedAt) });
      }
      this.observedHealthy = true;
      this.resetFailure();
      this.displayState = 'healthy';
      this.previousRawState = rawState;
      return { state: this.displayState, alerts };
    }

    this.displayState = rawState;
    if (!this.observedHealthy) {
      this.previousRawState = rawState;
      return { state: this.displayState, alerts };
    }

    this.failureStartedAt ??= now;
    if (!this.lostNotified && now - this.failureStartedAt >= this.debounceMs) {
      this.lostNotified = true;
      this.recoveringNotified = rawState === 'recovering';
      alerts.push({ kind: 'lost', detail: connectionDetail(status) });
    } else if (
      this.lostNotified
      && rawState === 'recovering'
      && this.previousRawState === 'disconnected'
      && !this.recoveringNotified
    ) {
      this.recoveringNotified = true;
      alerts.push({ kind: 'recovering' });
    }

    this.previousRawState = rawState;
    return { state: this.displayState, alerts };
  }

  public currentState(): TunnelConnectionDisplayState {
    return this.displayState;
  }

  private resetFailure(): void {
    this.failureStartedAt = null;
    this.lostNotified = false;
    this.recoveringNotified = false;
  }
}

function connectionDetail(status: TunnelStatus): string | null {
  const detail = status.message ?? status.health?.message ?? null;
  if (detail === null) return null;
  const trimmed = detail.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 240);
}
