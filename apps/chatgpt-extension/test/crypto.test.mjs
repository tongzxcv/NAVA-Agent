/* global atob, btoa, TextDecoder, TextEncoder */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cryptoSource = await readFile(resolve(root, 'src/crypto.js'), 'utf8');
const api = (() => {
  const sandbox = {
    atob,
    btoa,
    crypto: webcrypto,
    TextDecoder,
    TextEncoder,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(cryptoSource, sandbox, { filename: 'src/crypto.js' });
  return sandbox.NavaCrypto;
})();

test('persistent binding envelope is encrypted and round-trips with the passphrase', async () => {
  const state = {
    roomId: 'room-1',
    slotKey: 'LEAD-1',
    bindingId: 'binding-1234',
    connectionEpoch: 1,
    conversationRef: 'chatgpt:https://chatgpt.com/c/conversation-1',
    bridgeUrl: 'http://127.0.0.1:18766',
    authToken: 'nava-v1.secret-token-value-123456',
  };
  const envelope = await api.encryptState(state, 'correct horse battery');
  assert.equal(api.isEnvelope(envelope), true);
  assert.equal(JSON.stringify(envelope).includes(state.authToken), false);
  assert.equal(JSON.stringify(envelope).includes('conversationRef'), false);
  assert.equal(JSON.stringify(await api.decryptState(envelope, 'correct horse battery')), JSON.stringify(state));
  await assert.rejects(api.decryptState(envelope, 'wrong passphrase'), (error) => error.code === 'LOCKED');
});

test('short passphrases are rejected before encryption', async () => {
  assert.equal(api.validPassphrase('short'), false);
  await assert.rejects(api.encryptState({ ok: true }, 'short'), (error) => error.code === 'INVALID_PASSPHRASE');
});
