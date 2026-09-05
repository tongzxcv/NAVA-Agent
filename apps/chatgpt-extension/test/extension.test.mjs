/* global URL, console */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sharedSource = await readFile(resolve(root, 'src/shared.js'), 'utf8');
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

test('composer guard rejects drafts, active generation, and unsupported DOM', () => {
  assert.equal(api.inspectComposer(documentWith(visibleComposer(''))).ok, true);
  assert.equal(api.inspectComposer(documentWith(visibleComposer(''))).elementKind, 'contenteditable');
  assert.equal(api.inspectComposer(documentWith(visibleComposer('draft'))).errorCode, 'COMPOSER_NOT_EMPTY');
  assert.equal(api.inspectComposer(documentWith(visibleComposer(''), visibleComposer(''))).errorCode, 'DOM_MISMATCH');
  assert.equal(api.inspectComposer({ querySelectorAll: () => [] }).errorCode, 'DOM_MISMATCH');
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
  assert.match(popupHtml, /continue-button/);
  assert.match(popupSource, /CONTINUE_CONVERSATION/);
  assert.match(popupHtml, /same-epoch/);
  const contentSource = await readFile(resolve(root, 'src/content.js'), 'utf8');
  assert.match(contentSource, /ACK_WAKE_SUBMITTED/);
  assert.match(contentSource, /ฉันส่งในแชทแล้ว/);
  assert.match(contentSource, /NAVA_SUBMIT_CONTINUATION_BOOTSTRAP/);
  assert.match(contentSource, /PROJECT_MISMATCH/);
  assert.match(contentSource, /inspectComposer\(document\)/);
  const wakeOnly = contentSource.slice(0, contentSource.indexOf('function submitContinuationBootstrap'));
  assert.doesNotMatch(wakeOnly, /execCommand|button\[data-testid="send-button"\]/);
});
