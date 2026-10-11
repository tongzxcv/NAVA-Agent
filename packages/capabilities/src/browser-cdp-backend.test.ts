import { describe, expect, it, vi } from 'vitest';
import { BrowserCdpBackend, type BrowserCdpProtocol } from './browser-cdp-backend.js';
import { appError, err, ok, type Result } from '@lnwjud/domain';

describe('BrowserCdpBackend', () => {
  it('runs a DOM query through the Chrome DevTools protocol', async () => {
    const requests: { readonly method: string; readonly params: Record<string, unknown> }[] = [];
    const protocol: BrowserCdpProtocol = {
      async status() { return { ready: true, port: 9222 }; },
      async listTabs() { return [{ id: 'tab-1', title: 'Test', url: 'http://127.0.0.1/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab-1' }]; },
      async newTab() { return { id: 'tab-2', title: '', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab-2' }; },
      async closeTab() { return { closed: true }; },
      async request(_tabId, method, params) {
        requests.push({ method, params });
        return { result: { result: { value: { ok: true, text: 'hello', tag: 'DIV' } } } };
      },
    };
    const backend = new BrowserCdpBackend({ protocol });

    const result = await backend.execute({ action: 'query', tab_id: 'tab-1', parameters: { selector: '#app' } });

    expect(result).toMatchObject({ ok: true, value: { ok: true, text: 'hello', tag: 'DIV' } });
    expect(requests[0]?.method).toBe('Runtime.evaluate');
    expect(requests[0]?.params.expression).toContain('document.querySelector');
  });

  it('executes bounded DOM steps in order', async () => {
    const actions: string[] = [];
    const protocol: BrowserCdpProtocol = {
      async status() { return { ready: true, port: 9222 }; },
      async listTabs() { return [{ id: 'tab-1', title: 'Test', url: 'http://127.0.0.1/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab-1' }]; },
      async newTab() { return { id: 'tab-2', title: '', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab-2' }; },
      async closeTab() { return { closed: true }; },
      async request(_tabId, method) { actions.push(method); return { result: { result: { value: { ok: true } } } }; },
    };
    const backend = new BrowserCdpBackend({ protocol });

    const result = await backend.execute({
      steps: [
        { action: 'query', parameters: { selector: '#one' } },
        { action: 'click', parameters: { selector: '#one' } },
      ],
      tab_id: 'tab-1',
    });

    expect(result).toMatchObject({ ok: true, value: { steps: [{ ok: true }, { ok: true }] } });
    expect(actions).toEqual(['Runtime.evaluate', 'Runtime.evaluate']);
  });

  it('does not dispatch later DOM side effects after the caller aborts', async () => {
    const actions: string[] = [];
    const controller = new AbortController();
    const protocol: BrowserCdpProtocol = {
      async status() { return { ready: true, port: 9222 }; },
      async listTabs() { return [{ id: 'tab-1', title: 'Test', url: 'http://127.0.0.1/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab-1' }]; },
      async newTab() { return { id: 'tab-2', title: '', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab-2' }; },
      async closeTab() { return { closed: true }; },
      async request(_tabId, method) {
        actions.push(method);
        controller.abort();
        return { result: { result: { value: { ok: true } } } };
      },
    };
    const backend = new BrowserCdpBackend({ protocol });

    const result = await backend.execute({
      steps: [
        { action: 'query', parameters: { selector: '#one' } },
        { action: 'click', parameters: { selector: '#one' } },
      ],
      tab_id: 'tab-1',
    }, controller.signal);

    expect(result).toMatchObject({ ok: false, error: { code: 'PROCESS_TIMEOUT' } });
    expect(actions).toEqual(['Runtime.evaluate']);
  });

  it('rejects a DOM action without a target tab', async () => {
    const protocol: BrowserCdpProtocol = {
      async status() { return { ready: false, port: 9222 }; },
      async listTabs() { return []; },
      async newTab() { return { id: 'tab-2', title: '', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab-2' }; },
      async closeTab() { return { closed: true }; },
      async request() { return {}; },
    };
    const result = await new BrowserCdpBackend({ protocol }).execute({ action: 'click', parameters: { selector: '#app' } });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  function recoveryHarness(): {
    readonly backend: BrowserCdpBackend;
    readonly launcher: () => Promise<Result<unknown>>;
    readonly calls: string[];
    stop(): void;
    fail(value: boolean): void;
    advance(ms: number): void;
  } {
    let ready = false;
    let fail = false;
    let now = 1_000;
    const calls: string[] = [];
    const protocol: BrowserCdpProtocol = {
      async status() { return { ready, port: 9222 }; },
      async listTabs() {
        calls.push('listTabs');
        return [{ id: 'tab-after-recovery', title: 'Safe', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab-after-recovery' }];
      },
      async newTab() { calls.push('newTab'); return { id: 'new-tab', title: '', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/new-tab' }; },
      async closeTab() { calls.push('closeTab'); return { closed: true }; },
      async request() { calls.push('request'); return { result: { result: { value: true } } }; },
    };
    const launcher = vi.fn(async (): Promise<Result<unknown>> => {
      calls.push('launch');
      if (fail) return err(appError('PROCESS_TIMEOUT', 'Chrome failed to launch', true));
      ready = true;
      return ok({ ready: true, port: 9222, launched: true });
    });
    const backend = new BrowserCdpBackend({ protocol, launcher, recoveryBackoffMs: 1_000, recoveryMaxFailures: 3, now: (): number => now });
    return {
      backend, launcher, calls,
      stop(): void { ready = false; },
      fail(value: boolean): void { fail = value; },
      advance(ms: number): void { now += ms; },
    };
  }

  it('never auto-launches Chrome before an explicit managed launch', async () => {
    const h = recoveryHarness();
    await h.backend.execute({ action: 'list_tabs' });
    expect(h.launcher).not.toHaveBeenCalled();
    const state = await h.backend.execute({ action: 'status' });
    expect(state).toMatchObject({ ok: true, value: { ready: false, port: 9222, recovery: { armed: false, mode: 'on-demand' } } });
  });

  it('automatically reconnects a previously managed Chrome when listing tabs', async () => {
    const h = recoveryHarness();
    await h.backend.execute({ action: 'launch' });
    h.stop();
    const result = await h.backend.execute({ action: 'list_tabs' });
    expect(result).toMatchObject({ ok: true, value: { tabs: [{ id: 'tab-after-recovery' }] } });
    expect(h.launcher).toHaveBeenCalledTimes(2);
    const status = await h.backend.execute({ action: 'status' });
    expect(status).toMatchObject({ ok: true, value: { ready: true, recovery: { armed: true, consecutiveFailures: 0 } } });
    expect(h.launcher).toHaveBeenCalledTimes(2); // status is read-only
  });

  it('fails closed after recovery instead of blindly replaying a tab-specific click', async () => {
    const h = recoveryHarness();
    await h.backend.execute({ action: 'launch' });
    h.stop();
    const result = await h.backend.execute({ action: 'click', tab_id: 'stale-tab', parameters: { selector: '#danger' } });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(h.calls).not.toContain('request');
    expect(h.calls).not.toContain('listTabs');
    const blockedAgain = await h.backend.execute({ action: 'click', tab_id: 'stale-tab', parameters: { selector: '#danger' } });
    expect(blockedAgain).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(h.calls).not.toContain('request');
    const tabs = await h.backend.execute({ action: 'list_tabs' });
    expect(tabs.ok).toBe(true);
    const afterRefresh = await h.backend.execute({ action: 'query', tab_id: 'tab-after-recovery', parameters: { selector: '#safe' } });
    expect(afterRefresh.ok).toBe(true);
  });

  it('aborts an in-flight DOM step sequence after reconnecting instead of clicking an implicit new tab', async () => {
    const h = recoveryHarness();
    await h.backend.execute({ action: 'launch' });
    h.stop();
    const result = await h.backend.execute({
      steps: [
        { action: 'list_tabs', parameters: {} },
        { action: 'click', parameters: { selector: '#danger' } },
      ],
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(h.calls).not.toContain('request');
    expect(h.calls).toContain('listTabs');
    expect((await h.backend.execute({ action: 'list_tabs' })).ok).toBe(true);
  });

  it('serializes concurrent recovery calls into exactly one Chrome launch', async () => {
    const h = recoveryHarness();
    await h.backend.execute({ action: 'launch' });
    h.stop();
    const [first, second] = await Promise.all([
      h.backend.execute({ action: 'list_tabs' }),
      h.backend.execute({ action: 'list_tabs' }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(h.launcher).toHaveBeenCalledTimes(2);
  });

  it('uses backoff and a bounded failure budget instead of launching repeatedly', async () => {
    const h = recoveryHarness();
    await h.backend.execute({ action: 'launch' });
    h.stop();
    h.fail(true);
    const first = await h.backend.execute({ action: 'list_tabs' });
    expect(first.ok).toBe(false);
    expect(h.launcher).toHaveBeenCalledTimes(2);
    const cooldown = await h.backend.execute({ action: 'list_tabs' });
    expect(cooldown).toMatchObject({ ok: false, error: { code: 'PROCESS_TIMEOUT' } });
    expect(h.launcher).toHaveBeenCalledTimes(2);
    h.advance(1_000);
    await h.backend.execute({ action: 'list_tabs' });
    h.advance(2_000);
    await h.backend.execute({ action: 'list_tabs' });
    h.advance(10_000);
    const exhausted = await h.backend.execute({ action: 'list_tabs' });
    expect(exhausted).toMatchObject({ ok: false, error: { code: 'PROCESS_TIMEOUT' } });
    expect(h.launcher).toHaveBeenCalledTimes(4);
    expect(await h.backend.execute({ action: 'status' })).toMatchObject({ ok: true, value: { ready: false, recovery: { armed: true, consecutiveFailures: 3, attemptsRemaining: 0 } } });
    h.fail(false);
    await h.backend.execute({ action: 'launch' });
    expect(await h.backend.execute({ action: 'status' })).toMatchObject({ ok: true, value: { ready: true, recovery: { consecutiveFailures: 0 } } });
  });

  it('does not spawn Chrome for a dry-run or a cancelled request', async () => {
    const h = recoveryHarness();
    await h.backend.execute({ action: 'launch' });
    h.stop();
    const dry = await h.backend.execute({ action: 'list_tabs', dry_run: true });
    expect(dry).toMatchObject({ ok: true, value: { dry_run: true } });
    const controller = new AbortController();
    controller.abort();
    const aborted = await h.backend.execute({ action: 'list_tabs' }, controller.signal);
    expect(aborted).toMatchObject({ ok: false, error: { code: 'PROCESS_TIMEOUT' } });
    expect(h.launcher).toHaveBeenCalledTimes(1);
  });

  it('does not re-launch a healthy managed session on repeated browser checks', async () => {
    const h = recoveryHarness();
    await h.backend.execute({ action: 'launch' });
    await h.backend.execute({ action: 'status' });
    await h.backend.execute({ action: 'status' });
    await h.backend.execute({ action: 'list_tabs' });
    expect(h.launcher).toHaveBeenCalledTimes(1);
  });

});
