import { spawn, type ChildProcess } from 'node:child_process';
import { DEFAULT_SEARCH_RESULTS, err, MAX_PROCESS_LOG_BYTES, MAX_SEARCH_RESULTS, ok, type Result } from '@lnwjud/domain';
import { PathExecutableResolver, type ExecutableResolver } from './executable-resolver.js';
import {
  classifyContextPath,
  DEFAULT_CONTEXT_IGNORE_GLOBS,
  type ContextDiscoveryMode,
} from './context-economy.js';

export interface ProcessRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
  readonly outputLimited?: boolean;
}

export interface ProcessRunOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly maxStdoutBytes?: number;
}

export interface ProcessRunner {
  run(command: string, args: readonly string[], cwd: string, options?: ProcessRunOptions): Promise<ProcessRunResult>;
}

const PROCESS_TERMINATION_GRACE_MS = 750;

export class DirectProcessRunner implements ProcessRunner {
  public run(command: string, args: readonly string[], cwd: string, options: ProcessRunOptions = {}): Promise<ProcessRunResult> {
    return new Promise((resolve) => {
      const child = spawn(command, [...args], {
        cwd,
        shell: false,
        windowsHide: true,
        // A separate process group lets POSIX terminate descendants as one unit.
        // Windows uses taskkill /T below because ChildProcess.kill() only targets
        // the immediate process and descendants can keep inherited stdio open.
        detached: process.platform !== 'win32',
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let outputLimited = false;
      let settled = false;
      let terminationStarted = false;
      let terminationTimer: ReturnType<typeof setTimeout> | undefined;
      const maxStdoutBytes = normalizeCaptureLimit(options.maxStdoutBytes, MAX_PROCESS_LOG_BYTES);

      const capture = (chunks: Buffer[], currentBytes: number, chunk: Buffer, limit: number): { readonly bytes: number; readonly limited: boolean } => {
        const remaining = Math.max(0, limit - currentBytes);
        if (remaining === 0) return { bytes: currentBytes, limited: chunk.byteLength > 0 };
        const captured = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
        if (captured.byteLength > 0) chunks.push(Buffer.from(captured));
        return { bytes: currentBytes + captured.byteLength, limited: chunk.byteLength > remaining };
      };
      const finish = (exitCode: number): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        if (terminationTimer !== undefined) clearTimeout(terminationTimer);
        options.signal?.removeEventListener('abort', abort);
        resolve({
          exitCode,
          stdout: Buffer.concat(stdoutChunks, stdoutBytes).toString('utf8'),
          stderr: Buffer.concat(stderrChunks, stderrBytes).toString('utf8'),
          ...(timedOut ? { timedOut: true } : {}),
          ...(outputLimited ? { outputLimited: true } : {}),
        });
      };
      const terminate = (reason: 'timeout' | 'output-limit'): void => {
        if (reason === 'timeout') timedOut = true;
        else outputLimited = true;
        if (terminationStarted || settled) return;
        terminationStarted = true;
        terminateProcessTree(child);
        // Never let a process that ignores/defers termination hold the MCP call
        // open indefinitely. Descendants can retain pipe handles on Windows even
        // after the direct child exits, so bound completion independently of close.
        terminationTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
          finish(-1);
        }, PROCESS_TERMINATION_GRACE_MS);
      };
      const abort = (): void => { terminate('timeout'); };

      const timeoutMs = options.timeoutMs;
      const timer = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(abort, timeoutMs)
        : undefined;
      if (options.signal?.aborted) abort();
      else options.signal?.addEventListener('abort', abort, { once: true });
      child.stdout?.on('data', (chunk: Buffer) => {
        if (settled) return;
        const captured = capture(stdoutChunks, stdoutBytes, chunk, maxStdoutBytes);
        stdoutBytes = captured.bytes;
        if (captured.limited) terminate('output-limit');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (settled) return;
        const captured = capture(stderrChunks, stderrBytes, chunk, MAX_PROCESS_LOG_BYTES);
        stderrBytes = captured.bytes;
        if (captured.limited) terminate('output-limit');
      });
      child.on('error', (error: Error) => {
        const captured = capture(stderrChunks, stderrBytes, Buffer.from(error.message, 'utf8'), MAX_PROCESS_LOG_BYTES);
        stderrBytes = captured.bytes;
        finish(-1);
      });
      child.on('close', (exitCode) => finish(exitCode ?? -1));
    });
  }
}

function normalizeCaptureLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1024, Math.floor(value))
    : fallback;
}

function terminateProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => {
        try { child.kill(); } catch { /* best effort */ }
      });
      killer.unref();
      return;
    } catch {
      try { child.kill(); } catch { /* best effort */ }
      return;
    }
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* best effort */ }
  }
}

export interface SearchTextRequest {
  readonly rootPath: string;
  readonly query: string;
  readonly glob?: string;
  readonly maxResults?: number;
  readonly discovery?: ContextDiscoveryMode;
  readonly signal?: AbortSignal;
}

export interface SearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface SearchTextResult {
  readonly matches: readonly SearchMatch[];
  readonly truncated: boolean;
  readonly warning?: string;
}

export interface SearchFilesRequest {
  readonly rootPath: string;
  readonly glob?: string;
  readonly maxResults?: number;
  readonly discovery?: ContextDiscoveryMode;
  readonly signal?: AbortSignal;
}

export interface SearchFilesResult {
  readonly paths: readonly string[];
  readonly truncated: boolean;
  readonly warning?: string;
}

const SEARCH_PROCESS_TIMEOUT_MS = 45_000;
const SEARCH_PROCESS_CAPTURE_BYTES = 2 * 1024 * 1024;
const AUTOMATIC_TEXT_MAX_FILE_SIZE = '2M';

export class RipgrepAdapter {
  public constructor(
    private readonly resolver: ExecutableResolver = new PathExecutableResolver(),
    private readonly runner: ProcessRunner = new DirectProcessRunner(),
  ) {}

  public async searchText(request: SearchTextRequest): Promise<Result<SearchTextResult>> {
    const maxResults = request.maxResults ?? DEFAULT_SEARCH_RESULTS;
    if (request.query.length === 0 || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_SEARCH_RESULTS) {
      return err({ code: 'INVALID_INPUT', message: 'Search query or result limit is invalid', recoverable: false });
    }
    const executable = await this.resolver.resolve('rg');
    if (!executable.ok) return executable;
    const discovery = request.discovery ?? 'automatic';
    const args = ['--json', '--no-heading', '--color', 'never', '--hidden', '--no-ignore'];
    if (discovery === 'automatic') {
      this.appendDefaultGlobs(args);
      args.push('--max-filesize', AUTOMATIC_TEXT_MAX_FILE_SIZE);
    }
    if (request.glob !== undefined) args.push('--glob', request.glob);
    args.push('--', request.query, '.');
    const processResult = await this.runner.run(executable.value, args, request.rootPath, {
      timeoutMs: SEARCH_PROCESS_TIMEOUT_MS,
      maxStdoutBytes: SEARCH_PROCESS_CAPTURE_BYTES,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const warning = searchProcessWarning(processResult);
    const matches: SearchMatch[] = [];
    for (const line of processResult.stdout.split(/\r?\n/)) {
      const match = this.parseMatch(line);
      if (match === null) continue;
      if (discovery === 'automatic' && !classifyContextPath(match.path, discovery).discoverable) continue;
      matches.push(match);
      if (matches.length >= maxResults) break;
    }
    if (warning !== undefined && matches.length === 0) {
      return err({ code: 'SEARCH_FAILED', message: warning, recoverable: true });
    }
    return ok({
      matches,
      truncated: processResult.timedOut === true || processResult.outputLimited === true || warning !== undefined || matches.length >= maxResults && processResult.stdout.includes('"type":"match"'),
      ...(warning === undefined ? {} : { warning }),
    });
  }

  public async searchFiles(request: SearchFilesRequest): Promise<Result<SearchFilesResult>> {
    const maxResults = request.maxResults ?? DEFAULT_SEARCH_RESULTS;
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_SEARCH_RESULTS) {
      return err({ code: 'INVALID_INPUT', message: 'Search result limit is invalid', recoverable: false });
    }
    const executable = await this.resolver.resolve('rg');
    if (!executable.ok) return executable;
    const discovery = request.discovery ?? 'automatic';
    const args = ['--files', '--hidden', '--no-ignore'];
    if (discovery === 'automatic') this.appendDefaultGlobs(args);
    if (request.glob !== undefined) args.push('--glob', request.glob);
    args.push('--');
    const processResult = await this.runner.run(executable.value, args, request.rootPath, {
      timeoutMs: SEARCH_PROCESS_TIMEOUT_MS,
      maxStdoutBytes: SEARCH_PROCESS_CAPTURE_BYTES,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const warning = searchProcessWarning(processResult);
    const discoveredPaths = processResult.stdout
      .split(/\r?\n/)
      .filter((entry) => entry.length > 0)
      .filter((entry) => discovery === 'explicit' || classifyContextPath(entry, discovery).discoverable);
    if (warning !== undefined && discoveredPaths.length === 0) {
      return err({ code: 'SEARCH_FAILED', message: warning, recoverable: true });
    }
    const paths = discoveredPaths.slice(0, maxResults);
    return ok({
      paths,
      truncated: processResult.timedOut === true || processResult.outputLimited === true || warning !== undefined || discoveredPaths.length > maxResults,
      ...(warning === undefined ? {} : { warning }),
    });
  }

  private parseMatch(line: string): SearchMatch | null {
    try {
      const value: unknown = JSON.parse(line);
      if (!this.isMatchRecord(value)) return null;
      return { path: value.data.path.text, line: value.data.line_number, text: value.data.lines.text.replace(/\r?\n$/, '') };
    } catch {
      return null;
    }
  }

  private appendDefaultGlobs(args: string[]): void {
    for (const glob of DEFAULT_CONTEXT_IGNORE_GLOBS) args.push('--glob', glob);
  }

  private isMatchRecord(value: unknown): value is MatchRecord {
    if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'match' || !('data' in value)) return false;
    const data = value.data;
    if (typeof data !== 'object' || data === null || !('path' in data) || !('line_number' in data) || !('lines' in data)) return false;
    if (typeof data.path !== 'object' || data.path === null || !('text' in data.path) || typeof data.path.text !== 'string') return false;
    if (typeof data.line_number !== 'number' || typeof data.lines !== 'object' || data.lines === null || !('text' in data.lines) || typeof data.lines.text !== 'string') return false;
    return true;
  }
}

function searchProcessWarning(result: ProcessRunResult): string | undefined {
  if (result.timedOut === true || result.outputLimited === true || result.exitCode === 0 || result.exitCode === 1) return undefined;
  const diagnostic = result.stderr.trim().replace(/\s+/g, ' ').slice(0, 240);
  return `Search process exited with code ${result.exitCode}${diagnostic.length === 0 ? '' : `: ${diagnostic}`}`;
}

interface MatchRecord {
  readonly type: 'match';
  readonly data: {
    readonly path: { readonly text: string };
    readonly line_number: number;
    readonly lines: { readonly text: string };
  };
}
