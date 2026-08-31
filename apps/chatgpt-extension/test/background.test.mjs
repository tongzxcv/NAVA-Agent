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

  const chrome = {
    runtime: {
      getURL: (path = '/') => `chrome-extension://${'a'.repeat(32)}${path}`,
      onMessage: { addListener: (listener) => messageListeners.push(listener) },
      onStartup: { addListener: (listener) => startupListeners.push(listener) },
    },
    storage: { local, session },
    tabs: {
      query: async () => tabs,
      sendMessage: async (tabId, message) => {
        sentMessages.push({ tabId, message });
        if (sendMessageFailures > 0) {
          sendMessageFailures -= 1;
          throw new Error('Could not establish connection. Receiving end does not exist.');
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
        return jsonResponse({
          outcome: 'paired',
          authToken: 'nava-v1.secret-token-value-123456',
          binding: { id: 'binding-1234', connectionEpoch: 1 },
        });
      }
      if (String(url).includes('/wakes?limit=')) return jsonResponse({ wakes });
      return jsonResponse({ ok: true });
    },
    TextDecoder,
    TextEncoder,
    URL,
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
  assert.equal(JSON.stringify(checked), JSON.stringify({ ok: true, deliveredCount: 0, failedCount: 0, pendingCount: 0 }));
  const automatic = await harness.alarmListeners[0]({ name: 'nava.commandRoomWakePoll' });
  assert.equal(JSON.stringify(automatic), JSON.stringify({ ok: true, deliveredCount: 0, failedCount: 0, pendingCount: 0 }));
  assert.equal(harness.fetchCalls.filter((call) => call.url.includes('/wakes?limit=')).length, 2);
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
  assert.equal(JSON.stringify(checked), JSON.stringify({ ok: true, deliveredCount: 1, failedCount: 0, pendingCount: 0 }));
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
  assert.equal(JSON.stringify(checked), JSON.stringify({ ok: true, deliveredCount: 0, failedCount: 0, pendingCount: 1 }));
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

test('offline polling returns a safe error and does not fabricate delivery', async () => {
  const harness = await createHarness();
  await harness.send({ type: 'PAIR_ACTIVE_TAB', payloadText: payload, passphrase: 'correct horse battery' });
  harness.setBridgeOnline(false);
  assert.equal(JSON.stringify(await harness.send({ type: 'CHECK_WAKES' })), JSON.stringify({ ok: false, code: 'BRIDGE_UNAVAILABLE' }));
});
