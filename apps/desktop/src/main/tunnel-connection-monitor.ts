import type { TunnelHealthLayer, TunnelStatus } from '@lnwjud/ipc-contracts';

export const TUNNEL_ALERT_DEBOUNCE_MS = 10_000;

export type TunnelConnectionDisplayState = 'healthy' | 'busy' | 'recovering' | 'disconnected' | 'stopped';
export type TunnelConnectionAlertKind = 'lost' | 'recovering' | 'recovered' | 'failed';

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

  const process = status.health?.process;
  const localMcp = status.health?.localMcp;
  const requestPath = status.health?.requestPath;
  const critical = [process, localMcp, requestPath];

  if (critical.some((layer) => layer?.state === 'unhealthy' || layer?.state === 'unavailable')) return 'disconnected';

  // A 429/busy request-path response proves that the dispatcher and MCP child are alive.
  // Long serialized calls must not look like a connection loss in the tray/notifications.
  if (isBusyHealthLayer(requestPath) || isBusyHealthLayer(localMcp)) return 'busy';

  if (critical.some((layer) => layer?.state === 'unknown')) return 'recovering';
  if (critical.some((layer) => layer === undefined)) return 'recovering';

  switch (status.health?.overall) {
    case 'live': return 'healthy';
    case 'unhealthy':
    case 'unavailable': return 'disconnected';
    // All critical local layers are live here. An unknown non-critical layer (for example
    // bounded control-plane evidence) must not make the user-visible connection flicker.
    case 'unknown': return 'healthy';
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
  private failedNotified = false;

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

    if (rawState === 'busy') {
      this.observedHealthy = true;
      // Busy is positive liveness evidence, not a failure. Cancel an unannounced transient
      // failure so a 30-60s serialized request cannot trigger Lost/Reconnected notifications.
      if (!this.lostNotified) {
        this.resetFailure();
        this.displayState = 'busy';
        this.previousRawState = rawState;
        return { state: this.displayState, alerts };
      }

      // If a real loss was already announced, a busy response means the request path is back
      // but not idle yet. Keep recovery accounting until we observe a clean live probe.
      this.displayState = 'recovering';
      if (!this.recoveringNotified) {
        this.recoveringNotified = true;
        alerts.push({ kind: 'recovering' });
      }
      this.previousRawState = rawState;
      return { state: this.displayState, alerts };
    }

    this.displayState = rawState;
    if (status.recoveryExhausted && !this.failedNotified) {
      this.failedNotified = true;
      alerts.push({ kind: 'failed', detail: connectionDetail(status) });
    }
    if (!this.observedHealthy) {
      this.previousRawState = rawState;
      return { state: this.displayState, alerts };
    }

    this.failureStartedAt ??= now;
    if (!this.lostNotified && now - this.failureStartedAt >= this.debounceMs) {
      this.lostNotified = true;
      this.recoveringNotified = rawState === 'recovering';
      alerts.push({ kind: 'lost', detail: connectionDetail(status) });
      if (rawState === 'recovering') alerts.push({ kind: 'recovering' });
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
    this.failedNotified = false;
  }
}

function isBusyHealthLayer(layer: TunnelHealthLayer | undefined): boolean {
  if (layer?.state !== 'unknown') return false;
  return /\bbusy\b|awaiting active request|active request/i.test(layer.message);
}

function connectionDetail(status: TunnelStatus): string | null {
  const detail = status.message ?? status.health?.message ?? null;
  if (detail === null) return null;
  const trimmed = detail.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 240);
}
