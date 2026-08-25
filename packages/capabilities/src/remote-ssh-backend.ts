import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import type { CapabilityBackend } from './local-capability-service.js';

type RemoteSshOperation = 'status' | 'test' | 'run' | 'upload' | 'download' | 'wait' | 'logs' | 'result' | 'cancel';
type RemoteSshExecution = 'foreground' | 'background' | 'auto';
type RemoteShell = 'posix' | 'powershell';

interface RemoteSshRequest {
  readonly operation: RemoteSshOperation;
  readonly workspaceId?: string;
  readonly profile?: string;
  readonly remoteShell: RemoteShell;
  readonly executable?: string;
  readonly arguments: readonly string[];
  readonly localPath?: string;
  readonly remotePath?: string;
  readonly execution: RemoteSshExecution;
  readonly taskId?: string;
  readonly timeoutSeconds: number;
  readonly maxOutputBytes: number;
  readonly tailLines?: number;
  readonly includeStdout: boolean;
  readonly includeStderr: boolean;
  readonly dryRun: boolean;
  readonly userConfirmed: boolean;
}

interface RemoteTaskOwner {
  readonly workspaceId: string;
  readonly profile: string;
}

export interface RemoteSshCapabilityOptions {
  readonly runner: CapabilityBackend;
  readonly allowedRoots: readonly string[];
  readonly allowedRootsProvider?: () => Promise<readonly string[]>;
  readonly availabilityProbe?: () => Promise<Result<unknown>>;
  readonly defaultTimeoutSeconds?: number;
  readonly maxOutputBytes?: number;
}

const OPERATIONS: readonly RemoteSshOperation[] = ['status', 'test', 'run', 'upload', 'download', 'wait', 'logs', 'result', 'cancel'];
const EXECUTION_MODES: readonly RemoteSshExecution[] = ['foreground', 'background', 'auto'];
const REMOTE_SHELLS: readonly RemoteShell[] = ['posix', 'powershell'];
const DEFAULT_TIMEOUT_SECONDS = 3_600;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_TIMEOUT_SECONDS = 14_400;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

export class RemoteSshCapabilityBackend implements CapabilityBackend {
  private readonly runner: CapabilityBackend;
  private readonly allowedRoots: readonly string[];
  private readonly allowedRootsProvider: (() => Promise<readonly string[]>) | undefined;
  private readonly availabilityProbe: (() => Promise<Result<unknown>>) | undefined;
  private readonly defaultTimeoutSeconds: number;
  private readonly maxOutputBytes: number;
  private readonly taskOwners = new Map<string, RemoteTaskOwner>();

  public constructor(options: RemoteSshCapabilityOptions) {
    if (options.allowedRoots.length === 0) throw new Error('At least one SSH local root is required');
    this.runner = options.runner;
    this.allowedRoots = options.allowedRoots.map((root) => path.resolve(root));
    this.allowedRootsProvider = options.allowedRootsProvider;
    this.availabilityProbe = options.availabilityProbe;
    this.defaultTimeoutSeconds = clampNumber(options.defaultTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS, 0.1, MAX_TIMEOUT_SECONDS);
    this.maxOutputBytes = Math.floor(clampNumber(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, 1, MAX_OUTPUT_BYTES));
  }

  public async execute(input: unknown, signal?: AbortSignal): Promise<Result<unknown>> {
    const parsed = parseRequest(input, this.defaultTimeoutSeconds, this.maxOutputBytes);
    if (!parsed.ok) return parsed;
    const request = parsed.value;
    if (request.operation === 'status' && request.taskId === undefined) return this.status();
    if (request.workspaceId === undefined) return err(appError('INVALID_INPUT', 'workspaceId is required for SSH task operations'));

    if (request.operation === 'test' || request.operation === 'run' || request.operation === 'upload' || request.operation === 'download') {
      return this.start(request, signal);
    }

    const owner = this.taskOwners.get(request.taskId ?? '');
    if (owner === undefined) return err(appError('PROCESS_NOT_FOUND', 'SSH task was not found'));
    if (owner.workspaceId !== request.workspaceId) return err(appError('PERMISSION_DENIED', 'SSH task belongs to another workspace'));
    if (request.profile !== undefined && owner.profile !== request.profile) return err(appError('PERMISSION_DENIED', 'SSH task belongs to another profile'));
    const result = await this.runner.execute(forwardTaskRequest(request), signal);
    return annotate(result, { backend: 'ssh', profile: owner.profile, workspace_id: owner.workspaceId });
  }

  private async status(): Promise<Result<unknown>> {
    if (this.availabilityProbe !== undefined) {
      const result = await this.availabilityProbe();
      return annotate(result, { backend: 'ssh', local: true, authentication: 'ssh_config_key_or_agent', strict_host_key_checking: true });
    }
    return ok({ available: true, ready: true, backend: 'ssh', local: true, authentication: 'ssh_config_key_or_agent', strict_host_key_checking: true });
  }

  private async start(request: RemoteSshRequest, signal?: AbortSignal): Promise<Result<unknown>> {
    if (request.profile === undefined) return err(appError('INVALID_INPUT', 'SSH profile is required'));
    let executable = 'ssh.exe';
    let arguments_: string[];
    let cwd = (await this.roots())[0];

    if (request.operation === 'test') {
      arguments_ = [...sshOptions(Math.min(30, request.timeoutSeconds)), request.profile, 'exit 0'];
    } else if (request.operation === 'run') {
      if (request.executable === undefined) return err(appError('INVALID_INPUT', 'Remote executable is required'));
      const command = request.remoteShell === 'powershell'
        ? powershellCommand(request.executable, request.arguments)
        : posixCommand(request.executable, request.arguments);
      arguments_ = [...sshOptions(request.timeoutSeconds), request.profile, command];
    } else if (request.operation === 'upload') {
      const local = await this.resolveUpload(request.localPath);
      if (!local.ok) return local;
      if (request.remotePath === undefined) return err(appError('INVALID_INPUT', 'Remote path is required'));
      executable = 'scp.exe';
      cwd = path.dirname(local.value);
      arguments_ = [...scpOptions(request.timeoutSeconds), path.basename(local.value), `${request.profile}:${request.remotePath}`];
    } else {
      const local = await this.resolveDownload(request.localPath);
      if (!local.ok) return local;
      if (request.remotePath === undefined) return err(appError('INVALID_INPUT', 'Remote path is required'));
      executable = 'scp.exe';
      cwd = path.dirname(local.value);
      arguments_ = [...scpOptions(request.timeoutSeconds), `${request.profile}:${request.remotePath}`, path.basename(local.value)];
    }

    const result = await this.runner.execute({
      operation: 'run',
      executable,
      arguments: arguments_,
      cwd,
      execution: request.operation === 'test' ? 'foreground' : request.execution,
      privilege: 'user',
      timeout_seconds: request.operation === 'test' ? Math.min(30, request.timeoutSeconds) : request.timeoutSeconds,
      max_output_bytes: request.maxOutputBytes,
      ...(request.tailLines === undefined ? {} : { tail_lines: request.tailLines }),
      include_stdout: request.includeStdout,
      include_stderr: request.includeStderr,
      dry_run: request.dryRun,
      userConfirmed: request.userConfirmed,
    }, signal);
    const annotated = annotate(result, {
      backend: 'ssh',
      operation: request.operation,
      profile: request.profile,
      workspace_id: request.workspaceId,
      strict_host_key_checking: true,
    });
    if (annotated.ok && isRecord(annotated.value) && typeof annotated.value.task_id === 'string') {
      this.taskOwners.set(annotated.value.task_id, { workspaceId: request.workspaceId!, profile: request.profile });
    }
    return annotated;
  }

  private async resolveUpload(value: string | undefined): Promise<Result<string>> {
    if (value === undefined || !path.isAbsolute(value)) return err(appError('INVALID_INPUT', 'Upload local_path must be absolute'));
    try {
      const candidate = await realpath(value);
      const details = await stat(candidate);
      if (!details.isFile()) return err(appError('INVALID_INPUT', 'Upload local_path must be a file'));
      return (await this.isAllowed(candidate)) ? ok(candidate) : err(appError('PATH_OUTSIDE_WORKSPACE', 'Upload path is outside registered roots'));
    } catch {
      return err(appError('FILE_NOT_FOUND', 'Upload file was not found'));
    }
  }

  private async resolveDownload(value: string | undefined): Promise<Result<string>> {
    if (value === undefined || !path.isAbsolute(value)) return err(appError('INVALID_INPUT', 'Download local_path must be absolute'));
    try {
      const parent = await realpath(path.dirname(value));
      if (!(await this.isAllowed(parent))) return err(appError('PATH_OUTSIDE_WORKSPACE', 'Download path is outside registered roots'));
      const candidate = path.join(parent, path.basename(value));
      try {
        const existing = await realpath(candidate);
        if (!(await this.isAllowed(existing))) return err(appError('PATH_OUTSIDE_WORKSPACE', 'Download target resolves outside registered roots'));
      } catch {
        // A missing destination is valid; scp will create it inside the checked parent.
      }
      return ok(candidate);
    } catch {
      return err(appError('FILE_NOT_FOUND', 'Download parent directory was not found'));
    }
  }

  private async roots(): Promise<readonly string[]> {
    const roots = this.allowedRootsProvider === undefined
      ? this.allowedRoots
      : (await this.allowedRootsProvider()).map((root) => path.resolve(root));
    return Promise.all(roots.map(async (root) => realpath(root).catch(() => path.resolve(root))));
  }

  private async isAllowed(candidate: string): Promise<boolean> {
    return (await this.roots()).some((root) => isWithinRoot(root, candidate));
  }
}

function parseRequest(value: unknown, defaultTimeoutSeconds: number, maxOutputBytes: number): Result<RemoteSshRequest> {
  if (!isRecord(value)) return err(appError('INVALID_INPUT', 'SSH input must be an object'));
  const operation = value.operation === undefined ? 'status' : value.operation;
  if (!isOneOf(operation, OPERATIONS)) return err(appError('INVALID_INPUT', 'SSH operation is invalid'));
  const workspaceId = optionalString(value.workspaceId);
  if (value.workspaceId !== undefined && workspaceId === undefined) return err(appError('INVALID_INPUT', 'workspaceId is invalid'));
  const profile = value.profile === undefined ? undefined : normalizeProfile(value.profile);
  if (value.profile !== undefined && profile === undefined) return err(appError('INVALID_INPUT', 'SSH profile is invalid'));
  const remoteShell = value.remote_shell === undefined ? 'posix' : value.remote_shell;
  if (!isOneOf(remoteShell, REMOTE_SHELLS)) return err(appError('INVALID_INPUT', 'Remote shell is invalid'));
  const executable = optionalString(value.executable);
  if (value.executable !== undefined && (executable === undefined || executable.includes('\0'))) return err(appError('INVALID_INPUT', 'Remote executable is invalid'));
  const arguments_ = value.arguments === undefined ? [] : value.arguments;
  if (!Array.isArray(arguments_) || arguments_.length > 128 || !arguments_.every((item) => typeof item === 'string' && !item.includes('\0') && item.length <= 32_768)) return err(appError('INVALID_INPUT', 'Remote arguments are invalid'));
  const localPath = optionalPath(value.local_path);
  if (value.local_path !== undefined && localPath === undefined) return err(appError('INVALID_INPUT', 'Local path is invalid'));
  const remotePath = optionalRemotePath(value.remote_path);
  if (value.remote_path !== undefined && remotePath === undefined) return err(appError('INVALID_INPUT', 'Remote path is invalid'));
  const execution = value.execution === undefined ? 'auto' : value.execution;
  if (!isOneOf(execution, EXECUTION_MODES)) return err(appError('INVALID_INPUT', 'SSH execution mode is invalid'));
  const taskId = optionalString(value.task_id);
  if (value.task_id !== undefined && taskId === undefined) return err(appError('INVALID_INPUT', 'SSH task ID is invalid'));
  const timeoutSeconds = value.timeout_seconds === undefined ? defaultTimeoutSeconds : value.timeout_seconds;
  if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds) || timeoutSeconds < 0.1 || timeoutSeconds > MAX_TIMEOUT_SECONDS) return err(appError('INVALID_INPUT', 'SSH timeout is invalid'));
  const requestedMaxBytes = value.max_output_bytes === undefined ? maxOutputBytes : value.max_output_bytes;
  if (typeof requestedMaxBytes !== 'number' || !Number.isInteger(requestedMaxBytes) || requestedMaxBytes < 1 || requestedMaxBytes > MAX_OUTPUT_BYTES) return err(appError('INVALID_INPUT', 'SSH output limit is invalid'));
  const tailLines = value.tail_lines === undefined ? undefined : value.tail_lines;
  if (tailLines !== undefined && (typeof tailLines !== 'number' || !Number.isInteger(tailLines) || tailLines < 0 || tailLines > 10_000)) return err(appError('INVALID_INPUT', 'SSH tail limit is invalid'));
  const includeStdout = value.include_stdout === undefined ? true : value.include_stdout;
  const includeStderr = value.include_stderr === undefined ? true : value.include_stderr;
  const dryRun = value.dry_run === undefined ? false : value.dry_run;
  if (typeof includeStdout !== 'boolean' || typeof includeStderr !== 'boolean' || typeof dryRun !== 'boolean') return err(appError('INVALID_INPUT', 'SSH flags are invalid'));
  return ok({
    operation,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(profile === undefined ? {} : { profile }),
    remoteShell,
    ...(executable === undefined ? {} : { executable }),
    arguments: arguments_,
    ...(localPath === undefined ? {} : { localPath }),
    ...(remotePath === undefined ? {} : { remotePath }),
    execution,
    ...(taskId === undefined ? {} : { taskId }),
    timeoutSeconds,
    maxOutputBytes: requestedMaxBytes,
    ...(tailLines === undefined ? {} : { tailLines }),
    includeStdout,
    includeStderr,
    dryRun,
    userConfirmed: value.userConfirmed === true,
  });
}

function sshOptions(timeoutSeconds: number): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `ConnectTimeout=${Math.max(1, Math.min(30, Math.ceil(timeoutSeconds)))}`, '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2'];
}

function scpOptions(timeoutSeconds: number): string[] {
  return ['-B', ...sshOptions(timeoutSeconds).slice(2)];
}

function posixCommand(executable: string, args: readonly string[]): string {
  return [executable, ...args].map((value) => `'${value.replaceAll("'", `'"'"'`)}'`).join(' ');
}

function powershellCommand(executable: string, args: readonly string[]): string {
  const script = ['&', executable, ...args].map((value, index) => index === 0 ? value : `'${value.replaceAll("'", "''")}'`).join(' ');
  return `powershell.exe -NoProfile -NonInteractive -Command "${script.replaceAll('"', '`"')}"`;
}

function forwardTaskRequest(request: RemoteSshRequest): Record<string, unknown> {
  return {
    operation: request.operation,
    task_id: request.taskId,
    timeout_seconds: request.timeoutSeconds,
    max_output_bytes: request.maxOutputBytes,
    ...(request.tailLines === undefined ? {} : { tail_lines: request.tailLines }),
    include_stdout: request.includeStdout,
    include_stderr: request.includeStderr,
    dry_run: request.dryRun,
    userConfirmed: request.userConfirmed,
  };
}

function normalizeProfile(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(trimmed) ? trimmed : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0') ? value.trim() : undefined;
}

function optionalRemotePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 4_096 && !trimmed.includes('\0') && !trimmed.includes('\r') && !trimmed.includes('\n') && !trimmed.startsWith('-') ? trimmed : undefined;
}

function annotate(result: Result<unknown>, metadata: Record<string, unknown>): Result<unknown> {
  if (!result.ok || !isRecord(result.value)) return result;
  return ok({ ...result.value, ...metadata });
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.some((option) => option === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
