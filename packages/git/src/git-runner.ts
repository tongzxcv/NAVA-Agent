import { spawn, type ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { WindowsProcessTree, type ProcessTreeTerminator } from '@lnwjud/process';

export interface GitRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface GitRunner {
  run(args: readonly string[], cwd: string, options?: GitRunOptions): Promise<GitRunResult>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TERMINATION_RETRY_MS = 250;

export function resolveGitExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return 'git';
  const pathEntries = (environment.Path ?? environment.PATH ?? '').split(path.delimiter).filter(Boolean);
  const extensions = (environment.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean);
  for (const rawEntry of pathEntries) {
    const entry = rawEntry.replace(/^"(.*)"$/, '$1');
    for (const extension of extensions) {
      const candidate = path.join(entry, `git${extension.toLowerCase()}`);
      if (!isFile(candidate)) continue;
      if (path.basename(path.dirname(candidate)).toLowerCase() === 'cmd') {
        const installRoot = path.dirname(path.dirname(candidate));
        for (const runtime of ['mingw64', 'mingw32']) {
          const direct = path.join(installRoot, runtime, 'bin', 'git.exe');
          if (isFile(direct)) return direct;
        }
      }
      return candidate;
    }
  }
  return 'git';
}

export class DirectGitRunner implements GitRunner {
  public constructor(
    private readonly processTree: ProcessTreeTerminator = new WindowsProcessTree(),
    private readonly terminationRetryMs = DEFAULT_TERMINATION_RETRY_MS,
    private readonly gitExecutable = resolveGitExecutable(),
  ) {}

  public run(args: readonly string[], cwd: string, options: GitRunOptions = {}): Promise<GitRunResult> {
    if (options.signal?.aborted === true) {
      return Promise.resolve({ exitCode: -1, stdout: '', stderr: 'Git command cancelled' });
    }
    const timeoutMs = clampTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(this.gitExecutable, [...args], {
          cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          shell: false,
          windowsHide: true,
        });
      } catch (error: unknown) {
        resolve({ exitCode: -1, stdout: '', stderr: errorMessage(error) });
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      let terminationRequested = false;
      let terminationReason = '';
      let terminationFailureReported = false;
      const append = (current: string, chunk: Buffer): string => `${current}${chunk.toString('utf8')}`.slice(-MAX_CAPTURE_BYTES);
      const finish = (exitCode: number, extraStderr = ''): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        child.stdout?.removeListener('data', captureStdout);
        child.stderr?.removeListener('data', captureStderr);
        child.removeListener('error', handleError);
        child.removeListener('close', handleClose);
        resolve({ exitCode, stdout, stderr: extraStderr.length === 0 ? stderr : `${stderr}${extraStderr}` });
      };
      const terminate = (reason: string): void => {
        if (settled || terminationRequested) return;
        terminationRequested = true;
        terminationReason = reason;
        clearTimeout(timer);
        void (async (): Promise<void> => {
          while (!settled) {
            const pid = child.pid;
            if (pid !== undefined) {
              try {
                await this.processTree.stop(child, pid);
                finish(-1, reason);
                return;
              } catch (error: unknown) {
                if (!terminationFailureReported) {
                  terminationFailureReported = true;
                  stderr = append(stderr, Buffer.from(`\n${errorMessage(error)}`, 'utf8'));
                }
                if (!isChildLive(child)) await neverSettles();
              }
            }
            await delay(this.terminationRetryMs);
          }
        })();
      };
      const abort = (): void => terminate('Git command cancelled');
      const captureStdout = (chunk: Buffer): void => { stdout = append(stdout, chunk); };
      const captureStderr = (chunk: Buffer): void => { stderr = append(stderr, chunk); };
      const handleError = (error: Error): void => {
        stderr = `${stderr}${error.message}`;
        if (!terminationRequested) finish(-1);
        else if (child.pid === undefined) finish(-1, terminationReason);
      };
      const handleClose = (exitCode: number | null): void => {
        if (!terminationRequested) finish(exitCode ?? -1);
      };
      const timer = setTimeout(() => terminate('Git command timed out'), timeoutMs);
      child.stdout?.on('data', captureStdout);
      child.stderr?.on('data', captureStderr);
      child.on('error', handleError);
      child.on('close', handleClose);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted === true) abort();
    });
  }
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function clampTimeout(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(100, Math.floor(value)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, milliseconds)));
}

function isChildLive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function neverSettles(): Promise<never> {
  return new Promise<never>(() => undefined);
}
