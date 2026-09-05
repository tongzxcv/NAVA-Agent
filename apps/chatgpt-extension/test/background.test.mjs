/* global URL, atob, btoa, console, TextDecoder, TextEncoder */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function storageArea() {
  const values = new Map();
  return {
    accessLevel: null,
    values,
    async get(key) {
      if (typeof key === 'string') return values.has(key) ? { [key]: values.get(key) } : {};
      return Object.fromEntries(values);
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
    },
    async clear() {
      values.clear();
    },
    async setAccessLevel(options) {
      this.accessLevel = options.accessLevel;
    },
  };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function createHarness() {
  const messageListeners = [];
  const alarmListeners = [];
  const startupListeners = [];
  const local = storageArea();
  const session = storageArea();
  const alarms = { created: [], cleared: [] };
  const fetchCalls = [];
  const tabs = [{ id: 17, url: 'https://chatgpt.com/c/conversation-1' }];
  const sentMessages = [];
  const scriptInjections = [];
  let sendMessageFailures = 0;
  let wakes = [];
  let bridgeOnline = true;
  let supervisorResponse = { body: { ok: true, outcome: 'published', supervisorSync: 'OK' }, status: 200 };
  let recoveryBindings = [];
  let terminalRecoveryResponse = { body: { ok: true, outcome: 'wait', reason: 'NO_SAFE_CHECKPOINT' }, status: 200 };
  let continuationSubmitResponse = null;
  let inspectResponse = { ok: true, conversationRef: 'chatgpt:https://chatgpt.com/c/conversation-1', limit: { ok: true, maxLength: false }, composer: { ok: true } };

  const chrome = {
    runtime: {
      getURL: (path = '/') => `chrome-extension://${'a'.repeat(32)}${path}`,
      onMessage: { addListener: (listener) => messageListeners.push(listener) },
      onStartup: { addListener: (listener) => startupListeners.push(listener) },
    },
    storage: { local, session },
    tabs: {
      query: async () => tabs,
      create: async ({ url }) => { const created = { id: 30, url }; tabs.push(created); return created; },
      get: async (tabId) => tabs.find((item) => item.id === tabId),
      sendMessage: async (tabId, message) => {
        sentMessages.push({ tabId, message });
        if (sendMessageFailures > 0) {
          sendMessageFailures -= 1;
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        if (message?.type === 'NAVA_INSPECT_CHAT_STATE') return inspectResponse;
        if (message?.type === 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP') {
          if (continuationSubmitResponse !== null) return continuationSubmitResponse;
          const target = tabs.find((item) => item.id === tabId);
          if (target) target.url = 'https://chatgpt.com/g/g-p-project/c/conversation-2';
          return { ok: true, submitted: true, projectRef: message.expectedProjectRef };
        }
        return { ok: true };
      },
    },
    scripting: {
      executeScript: async (details) => { scriptInjections.push(details); return []; },
    },
    alarms: {
      create: async (name, info) => alarms.created.push({ name, info }),
      clear: async (name) => {
        alarms.cleared.push(name);
        return true;
      },
      onAlarm: { addListener: (listener) => alarmListeners.push(listener) },
    },
  };

  const sandbox = {
    atob,
    btoa,
    chrome,
    console,
    crypto: webcrypto,
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url: String(url), options });
      if (!bridgeOnline) throw new Error('offline');
      if (String(url).endsWith('/v1/pair/confirm')) {
        let requestedBindingId = 'binding-1234';
        try { requestedBindingId = JSON.parse(options.body ?? '{}').bindingId ?? requestedBindingId; } catch {}
        return jsonResponse({
          outcome: 'paired',
          authToken: requestedBindingId === 'binding-continuation' ? 'nava-v1.continuation-token-value-123456' : 'nava-v1.secret-token-value-123456',
          binding: { id: requestedBindingId, connectionEpoch: 1 },
        });
      }
      if (String(url).endsWith('/recover')) return jsonResponse({ ok: true, bindings: recoveryBindings });
      if (String(url).endsWith('/terminal-recovery')) return jsonResponse(terminalRecoveryResponse.body, terminalRecoveryResponse.status);
      if (String(url).endsWith('/supervisor')) return jsonResponse(supervisorResponse.body, supervisorResponse.status);
      if (String(url).includes('/wakes?limit=')) return jsonResponse({ wakes });
      if (String(url).endsWith('/v1/bindings/binding-1234/continuation')) return jsonResponse({ continuation: { bindingId: 'binding-continuation', challenge: 'c'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z', connectionEpoch: 1 } });
      return jsonResponse({ ok: true });
    },
    TextDecoder,
    TextEncoder,
    URL,
    setTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.importScripts = (...names) => {
    for (const name of names) {
      const source = requireSource(name);
      vm.runInNewContext(source, sandbox, { filename: `src/${name}` });
    }
  };

  const source = await readFile(resolve(root, 'src/background.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'src/background.js' });

  async function send(message, sender = {}) {
    assert.equal(messageListeners.length, 1);
    return new Promise((resolveResponse, reject) => {
      try {
        const keepChannelOpen = messageListeners[0](message, sender, resolveResponse);
        assert.equal(keepChannelOpen, true);
      } catch (error) {
        reject(error);
      }
    });
  }

  return {
    alarmListeners,
    alarms,
    fetchCalls,
    local,
    send,
    session,
    sentMessages,
    scriptInjections,
    setSendMessageFailures: (value) => { sendMessageFailures = value; },
    setBridgeOnline: (value) => { bridgeOnline = value; },
    setSupervisorResponse: (body, status = 200) => { supervisorResponse = { body, status }; },
    setRecoveryBindings: (value) => { recoveryBindings = value; },
    setTerminalRecoveryResponse: (body, status = 200) => { terminalRecoveryResponse = { body, status }; },
    setContinuationSubmitResponse: (value) => { continuationSubmitResponse = value; },
    setTabs: (value) => { tabs.splice(0, tabs.length, ...value); },
    getTabs: () => tabs.map((item) => ({ ...item })),
    setInspectResponse: (value) => { inspectResponse = value; },
    setTabUrl: (value) => { tabs[0].url = value; },
    setWakes: (value) => { wakes = value; },
    startupListeners,
  };

  function requireSource(name) {
    return sourceCache.get(name);
  }
}

const sourceCache = new Map();
for (const name of ['shared.js', 'crypto.js', 'bridge.js']) {
  sourceCache.set(name, await readFile(resolve(root, 'src', name), 'utf8'));
}

const payload = JSON.stringify({
  protocolVersion: 1,
  bridgeUrl: 'http://127.0.0.1:18766',
  roomId: 'room-1',
  slotKey: 'LEAD-1',
  bindingId: 'binding-1234',
  challenge: 'x'.repeat(32),
  expiresAt: '2099-01-01T00:00:00.000Z',
  connectionEpoch: 1,
  allowedOrigins: [`chrome-extension://${'a'.repeat(32)}`],
});

test('pair persists only an encrypted envelope, unlocks after session loss, and starts one-minute polling', async () => {
  const harness = await createHarness();
  const paired = await harness.send({
    type: 'PAIR_ACTIVE_TAB',
    payloadText: payload,
    passphrase: 'correct horse battery',
  });
  assert.equal(paired.ok, true, JSON.stringify(paired));
  assert.equal(harness.session.accessLevel, 'TRUSTED_CONTEXTS');
  const envelope = harness.local.values.get('nava.commandRoomBindingEncrypted');
  assert.equal(typeof envelope.ciphertext, 'string');
  assert.equal(JSON.stringify(envelope).includes('nava-v1.secret-token-value-123456'), false);
  assert.equal(harness.session.values.get('nava.commandRoomBinding').authToken, 'nava-v1.secret-token-value-123456');
  assert.equal(JSON.stringify(harness.alarms.created.at(-1)), JSON.stringify({
    name: 'nava.commandRoomWakePoll',
    info: { periodInMinutes: 1 },
  }));

  await harness.session.clear();
  assert.equal(JSON.stringify(await harness.send({ type: 'GET_STATE' })), JSON.stringify({ ok: false, code: 'LOCKED' }));
  assert.equal(JSON.stringify(await harness.send({ type: 'CHECK_WAKES' })), JSON.stringify({ ok: false, code: 'LOCKED' }));
  assert.equal(JSON.stringify(await harness.send({ type: 'UNLOCK_STATE', passphrase: 'wrong passphrase' })), JSON.stringify({
    ok: false,
    code: 'INVALID_PASSPHRASE',
  }));
  const unlocked = await harness.send({ type: 'UNLOCK_STATE', passphrase: 'correct horse battery' });
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.state.bindingId, 'binding-1234');

  const checked = await harness.send({ type: 'CHECK_WAKES' });
  assert.equal(JSON.stringify(checked), JSON.stringify({ ok: true, deliveredCount: 0, failedCount: 0, pendingCount: 0, supervisorSync: 'OK' }));
  const automatic = await harness.alarmListeners[0]({ name: 'nava.commandRoomWakePoll' });
  assert.equal(JSON.stringify(automatic), JSON.stringify({ ok: true, deliveredCount: 0, failedCount: 0, pendingCount: 0, supervisorSync: 'OK' }));
  assert.equal(harness.fetchCalls.filter((call) => call.url.includes('/wakes?limit=')).length, 2);
});



test('unlock migrates a legacy singleton into a multi-binding registry and recovers open same-installation bindings without re-pair', async () => {
  const harness = await createHarness();
  const lead3Payload = JSON.stringify({
    protocolVersion: 1,
    bridgeUrl: 'http://127.0.0.1:18766',
    roomId: 'room-1',
    slotKey: 'LEAD-3',
    bindingId: 'binding-3',
    challenge: 'y'.repeat(32),
    expiresAt: '2099-01-01T00:00:00.000Z',
    connectionEpoch: 1,
    allowedOrigins: [`chrome-extension://${'a'.repeat(32)}`],
  });
  harness.setTabs([{ id: 33, url: 'https://chatgpt.com/c/conversation-3' }]);
  const paired = await harness.send({
    type: 'PAIR_ACTIVE_TAB',
    payloadText: lead3Payload,
    passphrase: 'correct horse battery',
  });
  assert.equal(paired.ok, true);
  assert.equal(paired.state.bindingId, 'binding-3');

  harness.setTabs([
    { id: 17, url: 'https://chatgpt.com/c/conversation-1' },
    { id: 33, url: 'https://chatgpt.com/c/conversation-3' },
  ]);
  harness.setRecoveryBindings([{
    conversationRef: 'chatgpt:https://chatgpt.com/c/conversation-1',
    binding: {
      id: 'binding-1234',
      roomId: 'room-1',
      slotKey: 'LEAD-1',
      connectionEpoch: 1,
      state: 'PAIRED',
    },
    authToken: 'nava-v1.recovered-token-value-123456',
  }]);

  const pairCallsBefore = harness.fetchCalls.filter((call) => call.url.endsWith('/v1/pair/confirm')).length;
  await harness.session.clear();
  const unlocked = await harness.send({ type: 'UNLOCK_STATE', passphrase: 'correct horse battery' });
  assert.equal(unlocked.ok, true, JSON.stringify(unlocked));

  const registry = harness.session.values.get('nava.commandRoomBindings');
  assert.equal(registry.registryVersion, 1);
  assert.equal(
    JSON.stringify(registry.bindings.map((state) => state.bindingId).sort()),
    JSON.stringify(['binding-1234', 'binding-3']),
  );
  assert.equal(
    harness.fetchCalls.filter((call) => call.url.endsWith('/v1/pair/confirm')).length,
    pairCallsBefore,
  );
  assert.equal(harness.fetchCalls.some((call) => call.url.endsWith('/v1/bindings/binding-3/recover')), true);
  assert.equal(harness.fetchCalls.some((call) => call.url.endsWith('/v1/bindings/binding-1234/supervisor')), true);
  assert.equal(harness.fetchCalls.some((call) => call.url.endsWith('/v1/bindings/binding-3/supervisor')), true);

  const sync = await harness.send({ type: 'SYNC_SUPERVISOR_STATE' });
  assert.equal(sync.ok, true);
  assert.equal(sync.supervisorSync, 'OK');
});

test('existing exact tab rehydrates the content listener after extension reload without spending a failed attempt', async () => {
  const harness = await createHarness();
  await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });
  harness.setWakes([{
    id: 'wake-rehydrate', bindingId: 'binding-1234', eventKey: 'USER_WAKE:rehydrate', reason: 'USER_WAKE',
    state: 'QUEUED', attemptCount: 0,
  }]);
  harness.setSendMessageFailures(1);

  const checked = await harness.send({ type: 'CHECK_WAKES' });
  assert.equal(JSON.stringify(checked), JSON.stringify({ ok: true, deliveredCount: 1, failedCount: 0, pendingCount: 0, supervisorSync: 'OK' }));
  assert.equal(harness.sentMessages.length, 2);
  assert.equal(harness.scriptInjections.length, 1);
  assert.equal(JSON.stringify(harness.scriptInjections[0]), JSON.stringify({
    target: { tabId: 17 },
    files: ['src/shared.js', 'src/content.js'],
  }));
  assert.equal(harness.fetchCalls.filter((call) => call.url.includes('/wake-rehydrate/attempt')).length, 1);
  assert.equal(harness.fetchCalls.filter((call) => call.url.includes('/wake-rehydrate/delivered')).length, 1);
  assert.equal(harness.fetchCalls.some((call) => call.url.includes('/wake-rehydrate/failed')), false);
});

test('delivered wakes wait for explicit exact-tab acknowledgement without redelivery', async () => {
  const harness = await createHarness();
  await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });
  harness.setWakes([{
    id: 'wake-delivered', bindingId: 'binding-1234', eventKey: 'USER_WAKE:delivered', reason: 'USER_WAKE',
    state: 'DELIVERED', attemptCount: 1,
  }]);

  const checked = await harness.send({ type: 'CHECK_WAKES' });
  assert.equal(JSON.stringify(checked), JSON.stringify({ ok: true, deliveredCount: 0, failedCount: 0, pendingCount: 1, supervisorSync: 'OK' }));
  assert.equal(harness.sentMessages.length, 0);
  assert.equal(harness.fetchCalls.some((call) => call.url.includes('/wake-delivered/attempt')), false);

  const wrongTab = await harness.send(
    { type: 'ACK_WAKE_SUBMITTED', wakeId: 'wake-delivered' },
    { tab: { id: 18, url: 'https://chatgpt.com/c/other' } },
  );
  assert.equal(JSON.stringify(wrongTab), JSON.stringify({ ok: false, code: 'CONVERSATION_MISMATCH' }));
  assert.equal(harness.fetchCalls.some((call) => call.url.includes('/wake-delivered/submitted')), false);

  const acknowledged = await harness.send(
    { type: 'ACK_WAKE_SUBMITTED', wakeId: 'wake-delivered' },
    { tab: { id: 17, url: 'https://chatgpt.com/c/conversation-1' } },
  );
  assert.equal(acknowledged.ok, true);
  assert.equal(acknowledged.wakeId, 'wake-delivered');
  assert.equal(harness.fetchCalls.filter((call) => call.url.includes('/wake-delivered/submitted')).length, 1);
});

test('continuation readiness is fail-closed and requests a same-epoch challenge only at exact max length', async () => {
  const harness = await createHarness();
  harness.setTabUrl('https://chatgpt.com/g/g-p-project/c/conversation-1');
  await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });
  harness.setInspectResponse({
    ok: true,
    conversationRef: 'chatgpt:https://chatgpt.com/g/g-p-project/c/conversation-1',
    limit: { ok: true, maxLength: false },
    composer: { ok: true },
  });

  const normal = await harness.send({ type: 'CHECK_CONTINUATION_READY' });
  assert.equal(JSON.stringify(normal), JSON.stringify({ ok: true, ready: false, reason: 'NOT_AT_MAX_LENGTH' }));
  assert.equal(harness.fetchCalls.some((call) => call.url.endsWith('/continuation')), false);

  harness.setInspectResponse({
    ok: true,
    conversationRef: 'chatgpt:https://chatgpt.com/g/g-p-project/c/conversation-1',
    limit: { ok: true, maxLength: true, trigger: 'EXACT_MAX_LENGTH_MESSAGE' },
    composer: { ok: false, errorCode: 'COMPOSER_NOT_EMPTY' },
  });
  assert.equal(JSON.stringify(await harness.send({ type: 'CHECK_CONTINUATION_READY' })), JSON.stringify({ ok: false, code: 'COMPOSER_NOT_EMPTY' }));
  assert.equal(harness.fetchCalls.some((call) => call.url.endsWith('/continuation')), false);

  harness.setInspectResponse({
    ok: true,
    conversationRef: 'chatgpt:https://chatgpt.com/g/g-p-project/c/conversation-1',
    limit: { ok: true, maxLength: true, trigger: 'EXACT_MAX_LENGTH_MESSAGE' },
    composer: { ok: true },
  });
  const ready = await harness.send({ type: 'CHECK_CONTINUATION_READY' });
  assert.equal(ready.ok, true);
  assert.equal(ready.ready, true);
  assert.equal(ready.sameEpoch, true);
  assert.equal(ready.connectionEpoch, 1);
  assert.equal(ready.continuation.connectionEpoch, 1);
  assert.equal(harness.fetchCalls.filter((call) => call.url.endsWith('/continuation')).length, 1);
});

test('message delivery timeout waits while generation or durable work is active and never creates a continuation tab', async () => {
  const harness = await createHarness();
  harness.setTabUrl('https://chatgpt.com/g/g-p-project/c/conversation-1');
  await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });

  harness.setInspectResponse({
    ok: true,
    conversationRef: 'chatgpt:https://chatgpt.com/g/g-p-project/c/conversation-1',
    limit: { ok: true, maxLength: false },
    terminal: {
      ok: true, terminal: true, kind: 'MESSAGE_DELIVERY_TIMEOUT',
      terminalTurnKey: 'timeout:conversation-turn-9', generationActive: true,
    },
    composer: { ok: true },
  });
  const generating = await harness.send({ type: 'CONTINUE_CONVERSATION' });
  assert.equal(generating.ok, true);
  assert.equal(generating.ready, false);
  assert.equal(generating.recoveryReason, 'GENERATION_ACTIVE');
  assert.equal(harness.fetchCalls.some((call) => call.url.endsWith('/terminal-recovery')), false);
  assert.equal(harness.getTabs().length, 1);

  harness.setInspectResponse({
    ok: true,
    conversationRef: 'chatgpt:https://chatgpt.com/g/g-p-project/c/conversation-1',
    limit: { ok: true, maxLength: false },
    terminal: {
      ok: true, terminal: true, kind: 'MESSAGE_DELIVERY_TIMEOUT',
      terminalTurnKey: 'timeout:conversation-turn-9', generationActive: false,
    },
    composer: { ok: true },
  });
  harness.setTerminalRecoveryResponse({ ok: true, outcome: 'wait', reason: 'DURABLE_TASK_RUNNING', checkpointId: 'checkpoint-running' });
  const running = await harness.send({ type: 'CONTINUE_CONVERSATION' });
  assert.equal(running.ok, true);
  assert.equal(running.ready, false);
  assert.equal(running.recoveryReason, 'DURABLE_TASK_RUNNING');
  assert.equal(harness.getTabs().length, 1);
  assert.equal(harness.sentMessages.some((entry) => entry.message?.type === 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP'), false);
});

test('safe message delivery timeout creates one same-project same-epoch continuation and never replays the failed user turn', async () => {
  const harness = await createHarness();
  harness.setTabUrl('https://chatgpt.com/g/g-p-project/c/conversation-1');
  await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });
  harness.setInspectResponse({
    ok: true,
    conversationRef: 'chatgpt:https://chatgpt.com/g/g-p-project/c/conversation-1',
    limit: { ok: true, maxLength: false },
    terminal: {
      ok: true, terminal: true, kind: 'MESSAGE_DELIVERY_TIMEOUT',
      terminalTurnKey: 'timeout:conversation-turn-10', generationActive: false,
    },
    composer: { ok: true },
  });
  harness.setTerminalRecoveryResponse({
    ok: true,
    outcome: 'authorized',
    recoveryId: 'recovery-safe-1',
    checkpointId: 'checkpoint-after-side-effects',
    continuation: {
      bindingId: 'binding-continuation', challenge: 'c'.repeat(43),
      expiresAt: '2099-01-01T00:00:00.000Z', connectionEpoch: 1,
    },
  });

  const [first, concurrent] = await Promise.all([
    harness.send({ type: 'CONTINUE_CONVERSATION' }),
    harness.send({ type: 'CONTINUE_CONVERSATION' }),
  ]);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.outcome, 'CONTINUED');
  assert.equal(concurrent.outcome, 'CONTINUED');
  assert.equal(first.terminalKind, 'MESSAGE_DELIVERY_TIMEOUT');
  assert.equal(first.recoveryId, 'recovery-safe-1');
  assert.equal(first.checkpointId, 'checkpoint-after-side-effects');
  assert.equal(first.sameEpoch, true);
  assert.equal(first.connectionEpoch, 1);
  assert.equal(first.projectRef, 'chatgpt-project:https://chatgpt.com/g/g-p-project');
  const bootstraps = harness.sentMessages.filter((entry) => entry.message?.type === 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP');
  assert.equal(bootstraps.length, 1);
  assert.match(bootstraps[0].message.bootstrap, /Authoritative checkpoint: checkpoint-after-side-effects/);
  assert.match(bootstraps[0].message.bootstrap, /Do NOT retry, replay, or resubmit the failed user turn/);
  assert.match(bootstraps[0].message.bootstrap, /resume strictly after that checkpoint/);
  assert.equal(harness.fetchCalls.filter((call) => call.url.endsWith('/terminal-recovery')).length, 1);
  assert.equal(harness.fetchCalls.filter((call) => call.url.endsWith('/v1/pair/confirm')).length, 2);
  assert.equal(harness.getTabs().length, 2);
  const state = harness.session.values.get('nava.commandRoomBinding');
  assert.equal(state.connectionEpoch, 1);
  assert.equal(state.bindingId, 'binding-continuation');
});

test('timeout recovery ledger survives extension session loss and blocks duplicate tabs or bootstrap after a failed delivery', async () => {
  const harness = await createHarness();
  harness.setTabUrl('https://chatgpt.com/g/g-p-project/c/conversation-1');
  await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });
  const timeoutInspect = {
    ok: true,
    conversationRef: 'chatgpt:https://chatgpt.com/g/g-p-project/c/conversation-1',
    limit: { ok: true, maxLength: false },
    terminal: {
      ok: true, terminal: true, kind: 'MESSAGE_DELIVERY_TIMEOUT',
      terminalTurnKey: 'timeout:conversation-turn-restart', generationActive: false,
    },
    composer: { ok: true },
  };
  harness.setInspectResponse(timeoutInspect);
  harness.setTerminalRecoveryResponse({
    ok: true,
    outcome: 'authorized',
    recoveryId: 'recovery-restart-1',
    checkpointId: 'checkpoint-restart-safe',
    continuation: {
      bindingId: 'binding-continuation', challenge: 'c'.repeat(43),
      expiresAt: '2099-01-01T00:00:00.000Z', connectionEpoch: 1,
    },
  });
  harness.setContinuationSubmitResponse({ ok: false, errorCode: 'SUBMIT_FAILED' });

  const failed = await harness.send({ type: 'CONTINUE_CONVERSATION' });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'SUBMIT_FAILED');
  assert.equal(harness.getTabs().length, 2);
  assert.equal(harness.sentMessages.filter((entry) => entry.message?.type === 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP').length, 1);
  const ledger = harness.local.values.get('nava.terminalRecoveryLedgerV2');
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].recoveryId, 'recovery-restart-1');
  assert.equal(ledger[0].stage, 'TAB_CREATED');

  await harness.session.clear();
  const unlocked = await harness.send({ type: 'UNLOCK_STATE', passphrase: 'correct horse battery' });
  assert.equal(unlocked.ok, true);
  harness.setContinuationSubmitResponse(null);
  harness.setInspectResponse(timeoutInspect);
  const repeated = await harness.send({ type: 'CONTINUE_CONVERSATION' });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.ready, false);
  assert.equal(repeated.reason, 'RECOVERY_ALREADY_HANDLED');
  assert.equal(harness.getTabs().length, 2);
  assert.equal(harness.sentMessages.filter((entry) => entry.message?.type === 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP').length, 1);
});

test('transient timeout without an authoritative safe checkpoint fails closed without retry or rollover', async () => {
  const harness = await createHarness();
  harness.setTabUrl('https://chatgpt.com/g/g-p-project/c/conversation-1');
  await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });
  harness.setInspectResponse({
    ok: true,
    conversationRef: 'chatgpt:https://chatgpt.com/g/g-p-project/c/conversation-1',
    limit: { ok: true, maxLength: false },
    terminal: {
      ok: true, terminal: true, kind: 'MESSAGE_DELIVERY_TIMEOUT',
      terminalTurnKey: 'timeout:conversation-turn-transient', generationActive: false,
    },
    composer: { ok: true },
  });
  harness.setTerminalRecoveryResponse({ ok: true, outcome: 'wait', reason: 'NO_SAFE_CHECKPOINT' });
  const result = await harness.send({ type: 'CONTINUE_CONVERSATION' });
  assert.equal(result.ok, true);
  assert.equal(result.ready, false);
  assert.equal(result.recoveryReason, 'NO_SAFE_CHECKPOINT');
  assert.equal(harness.getTabs().length, 1);
  assert.equal(harness.sentMessages.length, 1); // only inspection
});

test('auto continuation creates a same-project conversation, atomically pairs the same epoch, and persists the new encrypted binding', async () => {
  const harness = await createHarness();
  harness.setTabUrl('https://chatgpt.com/g/g-p-project/c/conversation-1');
  await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });
  harness.setInspectResponse({
    ok: true,
    conversationRef: 'chatgpt:https://chatgpt.com/g/g-p-project/c/conversation-1',
    limit: { ok: true, maxLength: true, trigger: 'EXACT_MAX_LENGTH_MESSAGE' },
    composer: { ok: true },
  });
  const result = await harness.send({ type: 'CONTINUE_CONVERSATION' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.outcome, 'CONTINUED');
  assert.equal(result.sameEpoch, true);
  assert.equal(result.connectionEpoch, 1);
  assert.equal(result.supervisorSync, 'OK');
  assert.equal(result.projectRef, 'chatgpt-project:https://chatgpt.com/g/g-p-project');
  assert.equal(result.conversationRef, 'chatgpt:https://chatgpt.com/g/g-p-project/c/conversation-2');
  const state = harness.session.values.get('nava.commandRoomBinding');
  assert.equal(state.bindingId, 'binding-continuation');
  assert.equal(state.connectionEpoch, 1);
  assert.equal(state.conversationRef, result.conversationRef);
  assert.equal(state.supervisorSync, 'OK');
  assert.equal(harness.fetchCalls.some((call) => call.url.endsWith('/v1/bindings/binding-continuation/supervisor')), true);
  const envelope = harness.local.values.get('nava.commandRoomBindingEncrypted');
  assert.equal(JSON.stringify(envelope).includes('nava-v1.continuation-token-value-123456'), false);
});

test('supervisor synchronization degrades or fails closed without blocking paired core work', async () => {
  const harness = await createHarness();
  const paired = await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });
  assert.equal(paired.ok, true);
  assert.equal(paired.state.supervisorSync, 'OK');

  harness.setSupervisorResponse({ code: 'HTTP_500' }, 500);
  const degraded = await harness.send({ type: 'SYNC_SUPERVISOR_STATE' });
  assert.equal(degraded.ok, false);
  assert.equal(degraded.supervisorSync, 'DEGRADED');
  const coreCheck = await harness.send({ type: 'CHECK_WAKES' });
  assert.equal(coreCheck.ok, true);
  assert.equal(coreCheck.supervisorSync, 'DEGRADED');

  harness.setSupervisorResponse({ code: 'SUPERVISOR_STALE_EPOCH' }, 409);
  const failed = await harness.send({ type: 'SYNC_SUPERVISOR_STATE' });
  assert.equal(failed.ok, false);
  assert.equal(failed.supervisorSync, 'FAILED');
  const state = await harness.send({ type: 'GET_STATE' });
  assert.equal(state.ok, true);
  assert.equal(state.state.supervisorSync, 'FAILED');
});

test('offline polling returns a safe error and does not fabricate delivery', async () => {
  const harness = await createHarness();
  await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });
  harness.setBridgeOnline(false);
  assert.equal(JSON.stringify(await harness.send({ type: 'CHECK_WAKES' })), JSON.stringify({ ok: false, code: 'BRIDGE_UNAVAILABLE' }));
});
