import { appError, err, ok, type Result } from '@lnwjud/domain';
import type { CapabilityBackend } from './local-capability-service.js';
import { NodeBrowserCdpProtocol } from './browser-cdp-protocol.js';

export interface BrowserCdpTab {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

export interface BrowserCdpProtocol {
  status(signal?: AbortSignal): Promise<{ readonly ready: boolean; readonly port: number }>;
  listTabs(signal?: AbortSignal): Promise<readonly BrowserCdpTab[]>;
  newTab(url: string, signal?: AbortSignal): Promise<BrowserCdpTab>;
  closeTab(tabId: string, signal?: AbortSignal): Promise<unknown>;
  request(tabId: string, method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

export interface BrowserCdpBackendOptions {
  readonly protocol?: BrowserCdpProtocol;
  readonly launcher?: (url: string | undefined, signal?: AbortSignal) => Promise<Result<unknown>>;
  /** Bounded recovery applies only to a browser started by this backend. */
  readonly recoveryBackoffMs?: number;
  readonly recoveryMaxFailures?: number;
  readonly now?: () => number;
}

type BrowserAction = 'launch' | 'status' | 'list_tabs' | 'new_tab' | 'close_tab' | 'navigate' | 'evaluate' | 'query' | 'click' | 'type' | 'wait' | 'screenshot';

interface BrowserRequest {
  readonly action?: BrowserAction;
  readonly parameters: Record<string, unknown>;
  readonly steps?: readonly { readonly action: BrowserAction; readonly parameters: Record<string, unknown> }[];
  readonly tabId?: string;
  readonly timeoutSeconds: number;
  readonly dryRun: boolean;
}

const BROWSER_ACTIONS: readonly BrowserAction[] = ['launch', 'status', 'list_tabs', 'new_tab', 'close_tab', 'navigate', 'evaluate', 'query', 'click', 'type', 'wait', 'screenshot'];
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 3600;

export class BrowserCdpBackend implements CapabilityBackend {
  private readonly protocol: BrowserCdpProtocol;
  private readonly launcher: ((url: string | undefined, signal?: AbortSignal) => Promise<Result<unknown>>) | undefined;
  private readonly recoveryBackoffMs: number;
  private readonly recoveryMaxFailures: number;
  private readonly now: () => number;
  private managedLaunch = false;
  private recoveryEpoch = 0;
  private refreshTabsRequired = false;
  private recoveryFailures = 0;
  private retryAfter = 0;
  private recoveryInFlight: Promise<Result<{ readonly recovered: boolean }>> | null = null;

  public constructor(options: BrowserCdpBackendOptions = {}) {
    this.protocol = options.protocol ?? new NodeBrowserCdpProtocol();
    this.launcher = options.launcher;
    this.recoveryBackoffMs = Math.max(1_000, options.recoveryBackoffMs ?? 5_000);
    this.recoveryMaxFailures = Math.max(1, options.recoveryMaxFailures ?? 3);
    this.now = options.now ?? Date.now;
  }

  public async execute(input: unknown, signal?: AbortSignal): Promise<Result<unknown>> {
    const aborted = cancellationResult(signal);
    if (aborted !== null) return aborted;
    const parsed = parseBrowserRequest(input);
    if (!parsed.ok) return parsed;
    try {
      const result = parsed.value.steps !== undefined
        ? await this.executeSteps(parsed.value, signal)
        : parsed.value.action === undefined
          ? err(appError('INVALID_INPUT', 'DOM action is required'))
          : await this.executeAction(parsed.value, parsed.value.action, parsed.value.parameters, signal);
      return cancellationResult(signal) ?? result;
    } catch {
      return cancellationResult(signal) ?? err(appError('INTERNAL_ERROR', 'Browser CDP operation failed', true));
    }
  }

  private async executeSteps(request: BrowserRequest, signal?: AbortSignal): Promise<Result<unknown>> {
    const values: unknown[] = [];
    const initialRecoveryEpoch = this.recoveryEpoch;
    for (const step of request.steps ?? []) {
      const aborted = cancellationResult(signal);
      if (aborted !== null) return aborted;
      const result = await this.executeAction(request, step.action, step.parameters, signal);
      if (!result.ok) return result;
      if (this.recoveryEpoch !== initialRecoveryEpoch) {
        return err(appError('INVALID_INPUT', 'Chrome reconnected during DOM steps; reselect tabs and submit a new request'));
      }
      const abortedAfterStep = cancellationResult(signal);
      if (abortedAfterStep !== null) return abortedAfterStep;
      values.push(result.value);
    }
    return ok({ steps: values });
  }

  private async executeAction(request: BrowserRequest, action: BrowserAction, parameters: Record<string, unknown>, signal?: AbortSignal): Promise<Result<unknown>> {
    const aborted = cancellationResult(signal);
    if (aborted !== null) return aborted;
    if (request.dryRun) return ok({ dry_run: true, action, parameters });
    if (action === 'status') {
      const status = await this.protocol.status(signal);
      return ok({ ...status, recovery: this.recoverySnapshot() });
    }
    if (action === 'launch') {
      if (this.launcher === undefined) return err(appError('INTERNAL_ERROR', 'Browser launcher is not configured', true));
      const launched = await this.launcher(readString(parameters, 'url'), signal);
      if (launched.ok) {
        if (isRecord(launched.value) && launched.value.launched === true) this.managedLaunch = true;
        this.recoveryFailures = 0;
        this.retryAfter = 0;
        this.refreshTabsRequired = false;
      }
      return launched;
    }
    // Status and dry-run never start Chrome. Only a previously managed session
    // can recover, and recovery never silently replays a tab-specific operation.
    const recovery = await this.recoverManagedBrowser(signal);
    if (!recovery.ok) return recovery;
    if (recovery.value.recovered) {
      this.refreshTabsRequired = true;
      this.recoveryEpoch += 1;
    }
    if (this.refreshTabsRequired && action !== 'list_tabs' && action !== 'new_tab') {
      return err(appError('INVALID_INPUT', 'Managed Chrome reconnected; list tabs and select the target again before continuing'));
    }
    switch (action) {
      case 'list_tabs': {
        const tabs = await this.protocol.listTabs(signal);
        this.refreshTabsRequired = false;
        return ok({ tabs });
      }
      case 'new_tab': {
        const tab = await this.protocol.newTab(readString(parameters, 'url') ?? 'about:blank', signal);
        this.refreshTabsRequired = false;
        return ok(tab);
      }
      case 'close_tab': {
        const tabId = request.tabId ?? readString(parameters, 'tab_id');
        return tabId === undefined ? err(appError('INVALID_INPUT', 'Tab ID is required')) : ok(await this.protocol.closeTab(tabId, signal));
      }
      case 'navigate': return this.withTab(request, parameters, async (tab) => this.evaluateProtocol(tab.id, 'Page.navigate', { url: readString(parameters, 'url') ?? '' }, signal), signal);
      case 'evaluate': {
        const expression = readString(parameters, 'expression');
        return expression === undefined ? err(appError('INVALID_INPUT', 'JavaScript expression is required')) : this.withTab(request, parameters, async (tab) => this.evaluateProtocol(tab.id, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, signal), signal);
      }
      case 'query': return this.withTab(request, parameters, async (tab) => this.evaluateProtocol(tab.id, 'Runtime.evaluate', { expression: queryScript(readString(parameters, 'selector') ?? ''), returnByValue: true, awaitPromise: true }, signal), signal);
      case 'click': return this.withTab(request, parameters, async (tab) => this.evaluateProtocol(tab.id, 'Runtime.evaluate', { expression: clickScript(readString(parameters, 'selector') ?? ''), returnByValue: true, awaitPromise: true }, signal), signal);
      case 'type': return this.withTab(request, parameters, async (tab) => this.evaluateProtocol(tab.id, 'Runtime.evaluate', { expression: typeScript(readString(parameters, 'selector') ?? '', readString(parameters, 'text') ?? ''), returnByValue: true, awaitPromise: true }, signal), signal);
      case 'wait': return this.waitFor(request, parameters, signal);
      case 'screenshot': return this.withTab(request, parameters, async (tab) => {
        const result = await this.protocol.request(tab.id, 'Page.captureScreenshot', { format: 'png' }, signal);
        const data = readScreenshotData(result);
        return data === undefined ? err(appError('INTERNAL_ERROR', 'Browser screenshot response was invalid', true)) : ok({ format: 'png', data_base64: data });
      }, signal);
    }
  }

  private recoverySnapshot(): Record<string, unknown> {
    return {
      armed: this.managedLaunch,
      recovering: this.recoveryInFlight !== null,
      requiresTabRefresh: this.refreshTabsRequired,
      consecutiveFailures: this.recoveryFailures,
      attemptsRemaining: Math.max(0, this.recoveryMaxFailures - this.recoveryFailures),
      retryAfterMs: Math.max(0, this.retryAfter - this.now()),
      mode: 'on-demand',
    };
  }

  private async recoverManagedBrowser(signal?: AbortSignal): Promise<Result<{ readonly recovered: boolean }>> {
    if (!this.managedLaunch || this.launcher === undefined) return ok({ recovered: false });
    const aborted = cancellationResult(signal);
    if (aborted !== null) return aborted;
    // Include the readiness probe inside the shared promise. Concurrent calls
    // must never race multiple Chrome spawns.
    if (this.recoveryInFlight === null) {
      const attempt = this.attemptManagedRecovery(signal);
      this.recoveryInFlight = attempt;
      void attempt.finally(() => { if (this.recoveryInFlight === attempt) this.recoveryInFlight = null; });
    }
    const result = await this.recoveryInFlight;
    return cancellationResult(signal) ?? result;
  }

  private async attemptManagedRecovery(signal?: AbortSignal): Promise<Result<{ readonly recovered: boolean }>> {
    try {
      const status = await this.protocol.status(signal);
      const cancelled = cancellationResult(signal);
      if (cancelled !== null) return cancelled;
      if (status.ready) return ok({ recovered: false });
      if (this.recoveryFailures >= this.recoveryMaxFailures) {
        return err(appError('PROCESS_TIMEOUT', 'Managed Chrome recovery exhausted; use an explicit launch to rearm', true));
      }
      if (this.now() < this.retryAfter) {
        return err(appError('PROCESS_TIMEOUT', 'Managed Chrome recovery is in backoff; retry later', true));
      }
      // The launcher verifies the endpoint itself before spawning and uses
      // NAVA's isolated Chrome profile; it does not terminate other browsers.
      const launched = await this.launcher!(undefined, signal);
      const abortedAfterLaunch = cancellationResult(signal);
      if (abortedAfterLaunch !== null) return abortedAfterLaunch;
      if (!launched.ok) {
        this.recordRecoveryFailure();
        return launched;
      }
      const after = await this.protocol.status(signal);
      const abortedAfterStatus = cancellationResult(signal);
      if (abortedAfterStatus !== null) return abortedAfterStatus;
      if (!after.ready) {
        this.recordRecoveryFailure();
        return err(appError('PROCESS_TIMEOUT', 'Managed Chrome recovery returned without a ready CDP port', true));
      }
      this.recoveryFailures = 0;
      this.retryAfter = 0;
      return ok({ recovered: true });
    } catch {
      if (signal?.aborted === true) return cancellationResult(signal)!;
      this.recordRecoveryFailure();
      return err(appError('PROCESS_TIMEOUT', 'Managed Chrome auto-recovery failed', true));
    }
  }

  private recordRecoveryFailure(): void {
    this.recoveryFailures += 1;
    this.retryAfter = this.now() + this.recoveryBackoffMs * Math.min(8, 2 ** (this.recoveryFailures - 1));
  }

  private async waitFor(request: BrowserRequest, parameters: Record<string, unknown>, signal?: AbortSignal): Promise<Result<unknown>> {
    const selector = readString(parameters, 'selector');
    const expression = readString(parameters, 'expression');
    if (selector === undefined && expression === undefined) return err(appError('INVALID_INPUT', 'Wait requires a selector or expression'));
    const deadline = Date.now() + Math.min(request.timeoutSeconds, MAX_TIMEOUT_SECONDS) * 1000;
    while (Date.now() <= deadline) {
      const aborted = cancellationResult(signal);
      if (aborted !== null) return aborted;
      const result = await this.withTab(request, parameters, async (tab) => this.evaluateProtocol(tab.id, 'Runtime.evaluate', {
        expression: selector === undefined ? expression! : `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
        returnByValue: true,
        awaitPromise: true,
      }, signal), signal);
      if (!result.ok) return result;
      if (result.value === true) return ok({ ready: true });
      await delay(Math.min(readNumber(parameters, 'poll_interval_seconds') ?? 0.1, 1) * 1000, signal);
    }
    return ok({ ready: false, timed_out: true });
  }

  private async withTab(request: BrowserRequest, parameters: Record<string, unknown>, callback: (tab: BrowserCdpTab) => Promise<Result<unknown>>, signal?: AbortSignal): Promise<Result<unknown>> {
    const tabId = request.tabId ?? readString(parameters, 'tab_id');
    const tabs = await this.protocol.listTabs(signal);
    const aborted = cancellationResult(signal);
    if (aborted !== null) return aborted;
    const tab = tabId === undefined ? tabs[0] : tabs.find((candidate) => candidate.id === tabId);
    return tab === undefined ? err(appError('INVALID_INPUT', 'A managed Chrome tab is required')) : callback(tab);
  }

  private async evaluateProtocol(tabId: string, method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<Result<unknown>> {
    try {
      return ok(readCdpValue(await this.protocol.request(tabId, method, params, signal)));
    } catch {
      return err(appError('INTERNAL_ERROR', 'Browser CDP request failed', true));
    }
  }
}

function parseBrowserRequest(value: unknown): Result<BrowserRequest> {
  if (!isRecord(value)) return err(appError('INVALID_INPUT', 'DOM input must be an object'));
  const actionValue = value.action;
  const action = actionValue === undefined ? undefined : isBrowserAction(actionValue) ? actionValue : null;
  if (action === null) return err(appError('INVALID_INPUT', 'DOM action is invalid'));
  const parametersValue = value.parameters;
  const parameters = parametersValue === undefined ? {} : parametersValue;
  if (!isRecord(parameters)) return err(appError('INVALID_INPUT', 'DOM parameters must be an object'));
  const tabId = value.tab_id;
  if (tabId !== undefined && typeof tabId !== 'string') return err(appError('INVALID_INPUT', 'Tab ID is invalid'));
  const timeoutSeconds = value.timeout_seconds === undefined ? DEFAULT_TIMEOUT_SECONDS : value.timeout_seconds;
  if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds) || timeoutSeconds < 0.1 || timeoutSeconds > MAX_TIMEOUT_SECONDS) return err(appError('INVALID_INPUT', 'DOM timeout is invalid'));
  const dryRun = value.dry_run === undefined ? false : value.dry_run;
  if (typeof dryRun !== 'boolean') return err(appError('INVALID_INPUT', 'Dry-run flag is invalid'));
  const stepsValue = value.steps;
  if (stepsValue !== undefined && (!Array.isArray(stepsValue) || stepsValue.length < 1 || stepsValue.length > 100)) return err(appError('INVALID_INPUT', 'DOM steps must contain 1 to 100 items'));
  const normalizedSteps: { readonly action: BrowserAction; readonly parameters: Record<string, unknown> }[] = [];
  if (stepsValue !== undefined) {
    for (const step of stepsValue) {
      if (!isRecord(step) || !isBrowserAction(step.action)) return err(appError('INVALID_INPUT', 'DOM step is invalid'));
      const stepParameters = step.parameters === undefined ? {} : step.parameters;
      if (!isRecord(stepParameters)) return err(appError('INVALID_INPUT', 'DOM step parameters are invalid'));
      normalizedSteps.push({ action: step.action, parameters: stepParameters });
    }
  }
  return ok({ ...(action === undefined ? {} : { action }), parameters, ...(stepsValue === undefined ? {} : { steps: normalizedSteps }), ...(tabId === undefined ? {} : { tabId }), timeoutSeconds, dryRun });
}

function isBrowserAction(value: unknown): value is BrowserAction {
  return typeof value === 'string' && BROWSER_ACTIONS.some((action) => action === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const result = value[key];
  return typeof result === 'string' ? result : undefined;
}

function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  const result = value[key];
  return typeof result === 'number' && Number.isFinite(result) ? result : undefined;
}

function readCdpValue(response: unknown): unknown {
  if (!isRecord(response)) return undefined;
  const outerResult = response.result;
  if (!isRecord(outerResult)) return undefined;
  const remoteResult = outerResult.result;
  if (!isRecord(remoteResult)) return undefined;
  if ('exceptionDetails' in remoteResult) return undefined;
  return 'value' in remoteResult ? remoteResult.value : undefined;
}

function readScreenshotData(response: unknown): string | undefined {
  if (!isRecord(response) || !isRecord(response.result)) return undefined;
  return typeof response.result.data === 'string' ? response.result.data : undefined;
}

function queryScript(selector: string): string {
  return `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return {ok:false}; const r=el.getBoundingClientRect(); return {ok:true,text:el.innerText||el.value||'',tag:el.tagName,disabled:!!el.disabled,frame:{x:r.x,y:r.y,width:r.width,height:r.height}}; })()`;
}

function clickScript(selector: string): string {
  return `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return {ok:false}; el.scrollIntoView({block:'center',inline:'center'}); el.click(); return {ok:true}; })()`;
}

function typeScript(selector: string, text: string): string {
  return `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return {ok:false}; el.focus(); const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set; if(setter) setter.call(el,${JSON.stringify(text)}); else el.value=${JSON.stringify(text)}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return {ok:true,value:el.value}; })()`;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    const onAbort = (): void => done();
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function cancellationResult(signal: AbortSignal | undefined): Result<never> | null {
  return signal?.aborted === true
    ? err(appError('PROCESS_TIMEOUT', 'DOM operation was cancelled before the next side effect', true))
    : null;
}
