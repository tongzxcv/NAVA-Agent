/* global URL, console */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sharedSource = await readFile(resolve(root, 'src/shared.js'), 'utf8');
const contentVmSource = await readFile(resolve(root, 'src/content.js'), 'utf8');
const api = (() => {
  const sandbox = { console, Date, URL };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(sharedSource, sandbox, { filename: 'src/shared.js' });
  return sandbox.NavaExtension;
})();

function tab(id, url) {
  return { id, url };
}

function visibleComposer(text = '') {
  return {
    tagName: 'DIV',
    textContent: text,
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
  };
}

function documentWith(control, busy = null) {
  return {
    querySelectorAll: () => [control],
    querySelector: () => busy,
  };
}


function contentControl(text = '') {
  return {
    tagName: 'DIV',
    hidden: false,
    disabled: false,
    textContent: text,
    get innerText() { return this.textContent; },
    getAttribute: () => null,
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    focus() {},
    dispatchEvent() {},
  };
}

function sendButton(disabled = false) {
  return {
    hidden: false,
    disabled,
    clickCount: 0,
    getAttribute: (name) => name === 'aria-disabled' ? (disabled ? 'true' : 'false') : null,
    getClientRects: () => [{}],
    click() { this.clickCount += 1; },
  };
}

async function createContentHarness() {
  const listeners = [];
  const validationMessages = [];
  const state = {
    composers: [contentControl('')],
    buttons: [],
    validation: { ok: true },
  };
  const document = {
    querySelectorAll(selector) {
      if (String(selector).startsWith('[contenteditable')) return state.composers;
      if (String(selector).startsWith('button[')) return state.buttons;
      return [];
    },
    querySelector: () => null,
    execCommand(_command, _ui, data) {
      if (state.composers.length !== 1) return false;
      state.composers[0].textContent = data;
      return true;
    },
    getElementById: () => null,
    createElement: () => ({ setAttribute() {}, append() {}, addEventListener() {} }),
    head: null,
    body: { appendChild() {} },
  };
  const location = { href: 'https://chatgpt.com/g/g-p-project/project' };
  const chrome = {
    runtime: {
      onMessage: { addListener: (listener) => listeners.push(listener) },
      sendMessage: async (message) => {
        validationMessages.push(message);
        return state.validation;
      },
    },
  };
  class TestEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
  const sandbox = {
    chrome,
    console,
    Date,
    document,
    Event: TestEvent,
    InputEvent: TestEvent,
    location,
    navigator: { clipboard: { writeText: async () => {} } },
    URL,
    window: { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(sharedSource, sandbox, { filename: 'src/shared.js' });
  vm.runInNewContext(contentVmSource, sandbox, { filename: 'src/content.js' });

  async function submit(message) {
    assert.equal(listeners.length, 1);
    return new Promise((resolveResponse, reject) => {
      try {
        const open = listeners[0](message, {}, resolveResponse);
        assert.equal(open, true);
      } catch (error) {
        reject(error);
      }
    });
  }

  return {
    state,
    location,
    validationMessages,
    submit,
    makeControl: contentControl,
    makeButton: sendButton,
  };
}

test('conversation identity is exact and ignores only query/hash state', () => {
  assert.equal(api.conversationRefFromUrl('https://chatgpt.com/c/abc?foo=1#top'), 'chatgpt:https://chatgpt.com/c/abc');
  assert.equal(api.conversationRefFromUrl('https://chatgpt.com/g/gpt-1/c/abc'), 'chatgpt:https://chatgpt.com/g/gpt-1/c/abc');
  assert.equal(api.conversationRefFromUrl('https://chatgpt.com/share/abc'), null);
  assert.equal(api.conversationRefFromUrl('https://chat.openai.com/c/abc'), null);
  assert.equal(api.conversationRefFromUrl('https://chatgpt.com/c/abc/extra'), null);
});

test('project identity is derived only from exact ChatGPT Project URLs', () => {
  const conversation = 'https://chatgpt.com/g/g-p-project/c/conversation-1';
  assert.equal(api.projectRefFromUrl(conversation), 'chatgpt-project:https://chatgpt.com/g/g-p-project');
  assert.equal(api.projectRefFromConversationRef(api.conversationRefFromUrl(conversation)), 'chatgpt-project:https://chatgpt.com/g/g-p-project');
  assert.equal(api.projectHomeUrl('chatgpt-project:https://chatgpt.com/g/g-p-project'), 'https://chatgpt.com/g/g-p-project/project');
  assert.equal(api.projectRefFromUrl('https://chatgpt.com/g/gpt-custom/c/conversation-1'), null);
  assert.equal(api.projectRefFromUrl('https://chatgpt.com/c/conversation-1'), null);
});

test('tab selection fails closed for missing and duplicate exact conversations', () => {
  const ref = api.conversationRefFromUrl('https://chatgpt.com/c/abc');
  assert.equal(api.selectExactTab([tab(1, 'https://chatgpt.com/c/other')], ref).errorCode, 'TAB_NOT_FOUND');
  assert.equal(api.selectExactTab([tab(1, 'https://chatgpt.com/c/abc'), tab(2, 'https://chatgpt.com/c/abc?view=1')], ref).errorCode, 'AMBIGUOUS_TAB');
  const selected = api.selectExactTab([tab(1, 'https://chatgpt.com/c/abc')], ref);
  assert.equal(selected.ok, true);
  assert.equal(selected.tab.id, 1);
});

test('pairing validation only accepts the loopback Bridge and live payload', () => {
  const payload = {
    protocolVersion: 1,
    bridgeUrl: 'http://127.0.0.1:18766',
    roomId: 'room-1',
    slotKey: 'LEAD-1',
    bindingId: 'binding-1234',
    challenge: 'x'.repeat(32),
    expiresAt: '2099-01-01T00:00:00.000Z',
    connectionEpoch: 1,
    allowedOrigins: ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  };
  assert.equal(api.validatePairingPayload(payload, Date.parse('2026-08-31T00:00:00.000Z')).ok, true);
  assert.equal(api.validatePairingPayload({ ...payload, bridgeUrl: 'http://localhost:18766' }).code, 'BRIDGE_URL_INVALID');
  assert.equal(api.validatePairingPayload({ ...payload, expiresAt: '2020-01-01T00:00:00.000Z' }).code, 'PAIRING_EXPIRED');
  assert.equal(api.validatePairingPayload({ ...payload, allowedOrigins: ['https://evil.example'] }).code, 'INVALID_PAIRING');
});

test('maximum-length detection only accepts the exact visible ChatGPT terminal message', () => {
  const exact = visibleComposer("You've reached the maximum length for this conversation, but you can keep talking by starting a new chat.");
  const normal = visibleComposer('You can start a new chat whenever you want.');
  assert.equal(api.inspectConversationLimit({ querySelectorAll: () => [exact] }).maxLength, true);
  assert.equal(api.inspectConversationLimit({ querySelectorAll: () => [normal] }).maxLength, false);
  assert.equal(api.inspectConversationLimit({ querySelectorAll: () => [] }).maxLength, false);
});

test('terminal detection distinguishes exact max length from message delivery timeout and captures stable turn identity', () => {
  const timeoutContainer = {
    id: '',
    getAttribute: (name) => name === 'data-testid' ? 'conversation-turn-42' : null,
  };
  const timeout = {
    innerText: 'Message delivery timed out. Please try again.',
    textContent: 'Message delivery timed out. Please try again.',
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    closest: () => timeoutContainer,
  };
  const timeoutDocument = {
    querySelectorAll: (selector) => {
      if (selector.includes('data-message-id') || selector.includes('conversation-turn')) return [timeoutContainer];
      if (selector.includes('[role="alert"]') || selector.includes('[role="status"]')) return [timeout];
      return [];
    },
    querySelector: () => null,
  };
  const detected = api.inspectConversationTerminal(timeoutDocument);
  assert.equal(detected.ok, true);
  assert.equal(detected.terminal, true);
  assert.equal(detected.kind, 'MESSAGE_DELIVERY_TIMEOUT');
  assert.equal(detected.terminalTurnKey, 'timeout:conversation-turn-42');
  assert.equal(detected.generationActive, false);

  const busyDocument = { ...timeoutDocument, querySelector: () => visibleComposer('Stop generating') };
  const busy = api.inspectConversationTerminal(busyDocument);
  assert.equal(busy.kind, 'MESSAGE_DELIVERY_TIMEOUT');
  assert.equal(busy.generationActive, true);

  assert.equal(api.inspectConversationTerminal({ querySelectorAll: () => [], querySelector: () => null }).terminal, false);
});

test('composer guard rejects drafts, active generation, and unsupported DOM', () => {
  assert.equal(api.inspectComposer(documentWith(visibleComposer(''))).ok, true);
  assert.equal(api.inspectComposer(documentWith(visibleComposer(''))).elementKind, 'contenteditable');
  assert.equal(api.inspectComposer(documentWith(visibleComposer('draft'))).errorCode, 'COMPOSER_NOT_EMPTY');
  assert.equal(api.inspectComposer(documentWith(visibleComposer(''), visibleComposer(''))).errorCode, 'DOM_MISMATCH');
  assert.equal(api.inspectComposer({ querySelectorAll: () => [] }).errorCode, 'DOM_MISMATCH');
});


test('continuation bootstrap waits for a send button that appears asynchronously and clicks exactly once', async () => {
  const harness = await createContentHarness();
  const bootstrap = 'SYSTEM BOOTSTRAP';
  const button = harness.makeButton(false);
  globalThis.setTimeout(() => { harness.state.buttons = [button]; }, 10);
  const result = await harness.submit({
    type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
    expectedProjectRef: 'chatgpt-project:https://chatgpt.com/g/g-p-project',
    sourceBindingId: 'binding-1',
    submissionAttemptId: 'attempt-async-button',
    authorityExpiresAt: '2099-01-01T00:00:00.000Z',
    bootstrap,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.submitted, true);
  assert.equal(button.clickCount, 1);
  assert.equal(harness.state.composers[0].textContent, bootstrap);
  assert.equal(harness.validationMessages.length, 1);
});

test('continuation bootstrap waits for a disabled send button to become enabled', async () => {
  const harness = await createContentHarness();
  const bootstrap = 'SYSTEM BOOTSTRAP';
  const button = harness.makeButton(true);
  harness.state.buttons = [button];
  globalThis.setTimeout(() => {
    button.disabled = false;
    button.getAttribute = (name) => name === 'aria-disabled' ? 'false' : null;
  }, 10);
  const result = await harness.submit({
    type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
    expectedProjectRef: 'chatgpt-project:https://chatgpt.com/g/g-p-project',
    sourceBindingId: 'binding-1',
    submissionAttemptId: 'attempt-enabled-later',
    authorityExpiresAt: '2099-01-01T00:00:00.000Z',
    bootstrap,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(button.clickCount, 1);
});

test('continuation bootstrap tolerates React replacing the contenteditable when the exact bootstrap is preserved', async () => {
  const harness = await createContentHarness();
  const bootstrap = 'SYSTEM BOOTSTRAP';
  const button = harness.makeButton(false);
  globalThis.setTimeout(() => {
    harness.state.composers = [harness.makeControl(bootstrap)];
    harness.state.buttons = [button];
  }, 10);
  const result = await harness.submit({
    type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
    expectedProjectRef: 'chatgpt-project:https://chatgpt.com/g/g-p-project',
    sourceBindingId: 'binding-1',
    submissionAttemptId: 'attempt-react-rerender',
    authorityExpiresAt: '2099-01-01T00:00:00.000Z',
    bootstrap,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.state.composers[0].textContent, bootstrap);
  assert.equal(button.clickCount, 1);
});

test('continuation bootstrap fails closed if a user draft appears while waiting', async () => {
  const harness = await createContentHarness();
  const bootstrap = 'SYSTEM BOOTSTRAP';
  globalThis.setTimeout(() => { harness.state.composers = [harness.makeControl('user draft')]; }, 10);
  const result = await harness.submit({
    type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
    expectedProjectRef: 'chatgpt-project:https://chatgpt.com/g/g-p-project',
    sourceBindingId: 'binding-1',
    submissionAttemptId: 'attempt-user-draft',
    authorityExpiresAt: '2099-01-01T00:00:00.000Z',
    bootstrap,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'COMPOSER_NOT_EMPTY');
  assert.equal(harness.validationMessages.length, 0);
});

test('continuation bootstrap submission attempt identity prevents a second click', async () => {
  const harness = await createContentHarness();
  const bootstrap = 'SYSTEM BOOTSTRAP';
  const button = harness.makeButton(false);
  harness.state.buttons = [button];
  const message = {
    type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
    expectedProjectRef: 'chatgpt-project:https://chatgpt.com/g/g-p-project',
    sourceBindingId: 'binding-1',
    submissionAttemptId: 'attempt-dedup-click',
    authorityExpiresAt: '2099-01-01T00:00:00.000Z',
    bootstrap,
  };
  const first = await harness.submit(message);
  const second = await harness.submit(message);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(button.clickCount, 1);
  assert.equal(harness.validationMessages.length, 1);
});

test('continuation bootstrap fails closed if the project changes before submit', async () => {
  const harness = await createContentHarness();
  const bootstrap = 'SYSTEM BOOTSTRAP';
  const button = harness.makeButton(false);
  globalThis.setTimeout(() => {
    harness.location.href = 'https://chatgpt.com/g/g-p-other/project';
    harness.state.buttons = [button];
  }, 10);
  const result = await harness.submit({
    type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
    expectedProjectRef: 'chatgpt-project:https://chatgpt.com/g/g-p-project',
    sourceBindingId: 'binding-1',
    submissionAttemptId: 'attempt-project-change',
    authorityExpiresAt: '2099-01-01T00:00:00.000Z',
    bootstrap,
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'PROJECT_MISMATCH');
  assert.equal(button.clickCount, 0);
});


test('continuation bootstrap refuses to click when background authority validation rejects the source binding', async () => {
  const harness = await createContentHarness();
  const button = harness.makeButton(false);
  harness.state.buttons = [button];
  harness.state.validation = { ok: false, code: 'CONVERSATION_MISMATCH' };
  const result = await harness.submit({
    type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
    expectedProjectRef: 'chatgpt-project:https://chatgpt.com/g/g-p-project',
    sourceBindingId: 'binding-1',
    submissionAttemptId: 'attempt-source-rejected',
    authorityExpiresAt: '2099-01-01T00:00:00.000Z',
    bootstrap: 'SYSTEM BOOTSTRAP',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'CONVERSATION_MISMATCH');
  assert.equal(button.clickCount, 0);
});

test('continuation bootstrap fails closed for ambiguous send controls and expired authority', async () => {
  const ambiguous = await createContentHarness();
  ambiguous.state.buttons = [ambiguous.makeButton(false), ambiguous.makeButton(false)];
  const ambiguousResult = await ambiguous.submit({
    type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
    expectedProjectRef: 'chatgpt-project:https://chatgpt.com/g/g-p-project',
    sourceBindingId: 'binding-1',
    submissionAttemptId: 'attempt-ambiguous-send',
    authorityExpiresAt: '2099-01-01T00:00:00.000Z',
    bootstrap: 'SYSTEM BOOTSTRAP',
  });
  assert.equal(ambiguousResult.ok, false);
  assert.equal(ambiguousResult.errorCode, 'DOM_MISMATCH');
  assert.equal(ambiguous.state.buttons.reduce((sum, button) => sum + button.clickCount, 0), 0);

  const expired = await createContentHarness();
  expired.state.buttons = [expired.makeButton(false)];
  const expiredResult = await expired.submit({
    type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
    expectedProjectRef: 'chatgpt-project:https://chatgpt.com/g/g-p-project',
    sourceBindingId: 'binding-1',
    submissionAttemptId: 'attempt-expired-authority',
    authorityExpiresAt: '2020-01-01T00:00:00.000Z',
    bootstrap: 'SYSTEM BOOTSTRAP',
  });
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.errorCode, 'PAIRING_EXPIRED');
  assert.equal(expired.state.buttons[0].clickCount, 0);
});

test('manifest stays narrow and the Bridge is not a generic MCP proxy', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage', 'alarms', 'scripting']);
  assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*', 'http://127.0.0.1/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://chatgpt.com/*']);
  const bridgeSource = await readFile(resolve(root, 'src/bridge.js'), 'utf8');
  assert.doesNotMatch(bridgeSource, /\/mcp(?:[/'"]|$)/i);
  const popupHtml = await readFile(resolve(root, 'src/popup.html'), 'utf8');
  const popupSource = await readFile(resolve(root, 'src/popup.js'), 'utf8');
  assert.doesNotMatch(popupHtml, /continue-button/);
  assert.doesNotMatch(popupSource, /CONTINUE_CONVERSATION/);
  assert.match(popupHtml, /Auto Continuation ปิดอยู่ทุก Project \/ ทุก Chat/);
  const contentSource = await readFile(resolve(root, 'src/content.js'), 'utf8');
  assert.match(contentSource, /ACK_WAKE_SUBMITTED/);
  assert.match(contentSource, /ฉันส่งในแชทแล้ว/);
  assert.match(contentSource, /NAVA_SUBMIT_CONTINUATION_BOOTSTRAP/);
  assert.match(contentSource, /PROJECT_MISMATCH/);
  assert.match(contentSource, /inspectComposer\(document\)/);
  assert.match(contentSource, /inspectConversationTerminal\(document\)/);
  assert.doesNotMatch(contentSource, /click\([^)]*Retry|aria-label[^\n]*Retry/i);
  assert.doesNotMatch(contentSource, /Message delivery timed out[^\n]*click/i);
  const backgroundSource = await readFile(resolve(root, 'src/background.js'), 'utf8');
  assert.match(backgroundSource, /Do NOT retry, replay, or resubmit the failed user turn/);
  assert.doesNotMatch(backgroundSource, /Retry button|aria-label[^\n]*Retry/i);
  const wakeOnly = contentSource.slice(0, contentSource.indexOf('const continuationSubmissionAttempts'));
  assert.doesNotMatch(wakeOnly, /execCommand|button\[data-testid="send-button"\]/);
  assert.match(contentSource, /NAVA_VALIDATE_CONTINUATION_SUBMISSION/);
  assert.match(contentSource, /continuationSubmissionAttempts/);
});
