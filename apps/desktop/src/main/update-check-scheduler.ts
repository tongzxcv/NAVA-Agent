export const AUTO_UPDATE_STARTUP_DELAY_MS = 5_000;
export const AUTO_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1_000;

/**
 * A 404 on NAVA's own release endpoints is ambiguous: the repository may be
 * private, or the release / update manifest may not exist. Never call this
 * "up to date", and never use the upstream project's release channel.
 */
export function isNavaReleaseFeedInaccessibleError(message: string): boolean {
  if (!/\b404\b/.test(message)) return false;
  return /https:\/\/github\.com\/tongzxcv\/NAVA-Agent\/releases\.atom(?:\b|[?#])/i.test(message)
    || /https:\/\/api\.github\.com\/repos\/tongzxcv\/NAVA-Agent\/releases\/(?:latest|tags\/[^\s/?#]+)(?:\b|[?#])/i.test(message)
    || /https:\/\/github\.com\/tongzxcv\/NAVA-Agent\/releases\/download\/[^\s/?#]+\/latest\.yml(?:\b|[?#])/i.test(message);
}

export interface UpdateCheckSchedulerOptions {
  readonly check: () => void;
  readonly startupDelayMs?: number;
  readonly intervalMs?: number;
  readonly checkOnStartup?: boolean;
}

export class UpdateCheckScheduler {
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  public constructor(private readonly options: UpdateCheckSchedulerOptions) {}

  public start(): void {
    if (this.startupTimer !== null || this.intervalTimer !== null) return;
    const startupDelayMs = this.options.startupDelayMs ?? AUTO_UPDATE_STARTUP_DELAY_MS;
    const intervalMs = this.options.intervalMs ?? AUTO_UPDATE_CHECK_INTERVAL_MS;
    if (this.options.checkOnStartup !== false) {
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        this.options.check();
      }, startupDelayMs);
    }
    this.intervalTimer = setInterval(() => this.options.check(), intervalMs);
  }

  public stop(): void {
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }
}
