/* global fetch, AbortSignal, WebSocket */
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BrowserCdpBackend } from '../packages/capabilities/dist/browser-cdp-backend.js';
import { NodeBrowserCdpProtocol } from '../packages/capabilities/dist/browser-cdp-protocol.js';

const PORT = 19473; // Not NAVA's production 9222.
const chromeExecutable = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const outDir = path.join(process.cwd(), '.nava-cdp-smoke');
const evidencePath = path.join(outDir, 'result.json');
const evidence = { run: new Date().toISOString(), port: PORT, isolated: true, stage: 'start', observations: [] };

function verify(condition, message) {
  if (!condition) throw new Error(message);
}
function record(stage, data = {}) {
  evidence.stage = stage;
  evidence.observations.push({ stage, time: new Date().toISOString(), ...data });
  console.log('E2E|' + stage + '|' + JSON.stringify(data));
}
async function waitUntil(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(200);
  }
  throw new Error('Timed out waiting for ' + description);
}
async function assertPortFree() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
async function requestOwnBrowserClose() {
  const url = 'http://127.0.0.1:' + PORT + '/json/version';
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  verify(response.ok, 'Isolated Chrome CDP unavailable for self-close');
  const version = await response.json();
  const websocketUrl = new URL(version.webSocketDebuggerUrl);
  verify(websocketUrl.protocol === 'ws:', 'Unexpected websocket scheme');
  verify(['127.0.0.1', 'localhost'].includes(websocketUrl.hostname) && Number(websocketUrl.port) === PORT, 'Non-isolated browser close was blocked');
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl.href);
    const timer = setTimeout(() => { socket.close(); reject(new Error('Isolated browser self-close timed out')); }, 10000);
    function done(error) {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    }
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })));
    socket.addEventListener('close', () => done());
    // Browser.close often tears down the debugging socket without a clean WS close.
    // Confirm the port is actually offline in waitUntil() instead of rejecting here.
    socket.addEventListener('error', () => done());
  });
}

await mkdir(outDir, { recursive: true });
await assertPortFree();
const profileDir = await mkdtemp(path.join(outDir, 'fresh-profile-'));
const browserProtocol = new NodeBrowserCdpProtocol({ port: PORT, profileDir, chromeExecutable, headless: true });
const backend = new BrowserCdpBackend({ protocol: browserProtocol, launcher: (url, signal) => browserProtocol.launch(url, signal), recoveryBackoffMs: 2000, recoveryMaxFailures: 3 });
let launched = false;
try {
  record('initial-offline', await browserProtocol.status());
  let result = await backend.execute({ action: 'launch', parameters: { url: 'about:blank' } });
  verify(result.ok && result.value.launched === true, 'Isolated Chrome initial launch failed: ' + JSON.stringify(result));
  launched = true;
  record('launched', result.value);
  const initialTabsResult = await backend.execute({ action: 'list_tabs' });
  verify(initialTabsResult.ok && initialTabsResult.value.tabs.length > 0, 'Chrome initially has no tabs');
  const initialTabId = initialTabsResult.value.tabs[0].id;
  record('tabs-before-close', { count: initialTabsResult.value.tabs.length, firstTabId: initialTabId });
  await requestOwnBrowserClose();
  await waitUntil(async () => !(await browserProtocol.status()).ready, 16000, 'isolated Chrome to exit gracefully');
  record('closed-self', await browserProtocol.status());
  result = await backend.execute({ action: 'query', tab_id: initialTabId, parameters: { selector: 'body' } });
  verify(!result.ok && result.error.code === 'INVALID_INPUT', 'Tab command was replayed without rebinding: ' + JSON.stringify(result));
  record('old-tab-blocked', { code: result.error.code });
  let newTabsResult = await backend.execute({ action: 'list_tabs' });
  verify(newTabsResult.ok && newTabsResult.value.tabs.length > 0, 'Recovered Chrome has no tabs: ' + JSON.stringify(newTabsResult));
  const newTabId = newTabsResult.value.tabs[0].id;
  verify(newTabId !== initialTabId, 'Unexpected reuse of stale Chrome tab ID');
  record('recovered-tabs', { count: newTabsResult.value.tabs.length, firstTabId: newTabId });
  result = await backend.execute({ action: 'query', tab_id: newTabId, parameters: { selector: 'body' } });
  verify(result.ok, 'Could not query rebound Chrome tab: ' + JSON.stringify(result));
  record('rebound-query-success', { ok: true });
  const status = await backend.execute({ action: 'status' });
  verify(status.ok && status.value.ready === true && status.value.recovery.consecutiveFailures === 0, 'Recovery health status incorrect');
  record('recovery-health', status.value);
  evidence.result = 'PASS';
} catch (error) {
  evidence.result = 'FAIL';
  evidence.error = error instanceof Error ? error.message : String(error);
  console.error('E2E_FAIL|' + evidence.error);
  process.exitCode = 1;
} finally {
  try {
    if (launched && (await browserProtocol.status()).ready) {
      await requestOwnBrowserClose();
      await waitUntil(async () => !(await browserProtocol.status()).ready, 16000, 'isolated Chrome cleanup');
      record('clean-shutdown');
    }
  } catch (error) {
    record('cleanup-unverified', { error: String(error) });
    evidence.result = 'FAIL';
    process.exitCode = 1;
  }
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
  console.log('E2E_EVIDENCE|' + evidencePath);
}
