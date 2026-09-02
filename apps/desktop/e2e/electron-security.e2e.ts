import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { monitorElectronProcess } from './electron-e2e-diagnostics.js';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainEntry = path.join(desktopRoot, 'dist', 'main', 'main.js');
const electronDistPath = path.join(desktopRoot, 'node_modules', 'electron', 'dist');
const electronExecutable = path.join(electronDistPath, 'electron.exe');

test('renderer cannot access Node globals', async () => {
  test.setTimeout(60_000);
  const devToolsPort = await findEphemeralPort();
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-security-data-'));
  const electronProcess = spawn(electronExecutable, [`--remote-debugging-port=${devToolsPort}`, `--user-data-dir=${dataRoot}`, mainEntry], {
    cwd: desktopRoot,
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      LNWJUD_DATA_PATH: dataRoot,
      LNWJUD_E2E_FIXTURE: '1',
    },
  });
  const diagnostics = monitorElectronProcess(electronProcess, 'security');
  diagnostics.phase(`spawned:pid=${electronProcess.pid ?? 'unknown'}:devtools=${devToolsPort}`);

  try {
    await waitForDevTools(devToolsPort, electronProcess, diagnostics.stderr);
    diagnostics.phase('devtools-ready');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${devToolsPort}`);
    diagnostics.phase('cdp-connected');
    const context = browser.contexts()[0];
    if (context === undefined) throw new Error('Electron did not create a browser context');
    await expect.poll(() => context.pages().length, { timeout: 15_000, interval: 250 }).toBeGreaterThan(0);
    const page = context.pages()[0];
    if (page === undefined) throw new Error('Electron did not create a renderer page');
    await expect(page.getByRole('banner').getByText('NAVA Agent', { exact: true })).toBeVisible({ timeout: 30_000 });
    diagnostics.phase('renderer-ready');
    await expect.poll(async () => page.evaluate(() => ({
      process: typeof Reflect.get(window, 'process'),
      require: typeof Reflect.get(window, 'require'),
      api: typeof window.lnwjud?.listWorkspaces,
    })), { timeout: 20_000, intervals: [100, 250, 500] }).toEqual({ process: 'undefined', require: 'undefined', api: 'function' });
    diagnostics.phase('preload-contract-ready');
    await browser.close();
  } finally {
    diagnostics.phase('teardown-start');
    await terminateProcessTree(electronProcess);
    diagnostics.phase('process-termination-returned');
    await removeTemporaryRoot(dataRoot);
    diagnostics.phase('temporary-root-cleaned');
    diagnostics.dump();
  }
});

async function findEphemeralPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
  if (address === null || typeof address === 'string') throw new Error('Could not allocate an ephemeral port');
  return address.port;
}

async function waitForDevTools(port: number, electronProcess: ChildProcess, stderr: () => string): Promise<void> {
  await expect.poll(async () => {
    if (electronProcess.exitCode !== null) throw new Error(`Electron exited with ${electronProcess.exitCode}: ${stderr()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      return response.ok;
    } catch {
      return false;
    }
  }, { timeout: 20_000, intervals: [50, 100, 250] }).toBe(true);
}

async function terminateProcessTree(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.pid === undefined) return;
  const killer = spawn('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'], {
    shell: false,
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });
  killer.unref();
  await Promise.race([
    new Promise<void>((resolve) => process.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 8_000)),
  ]);
}

async function removeTemporaryRoot(root: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  }
  console.warn(`E2E cleanup left temporary root for OS cleanup: ${root}`);
}
