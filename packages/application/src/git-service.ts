import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import { DefaultPermissionEngine, type PermissionEngine, type PermissionProfile } from '@lnwjud/permissions';
import {
  GitAdapter,
  type GitCommandResult,
  type GitDiffRequest,
  type GitDiffResult,
  type GitLogRequest,
  type GitLogResult,
  type GitStatusResult,
} from '@lnwjud/git';
import { WorkspacePathGuard, type Workspace, type WorkspaceRepository } from '@lnwjud/workspace';
import type { FileActor } from './file-service.js';
import { isAbsoluteFsPath, resolveWorkspaceForPath } from './workspace-locator.js';

export interface GitRunRequest {
  readonly args: readonly string[];
  readonly workspaceId?: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly userConfirmed?: boolean;
}

export interface GitServiceGate {
  readonly profileProvider: () => PermissionProfile;
  readonly permissionEngine?: PermissionEngine;
}

export class GitService {
  private readonly permissionEngine: PermissionEngine = new DefaultPermissionEngine();

  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly guard: WorkspacePathGuard = new WorkspacePathGuard(),
    private readonly adapter: GitAdapter = new GitAdapter(),
    private readonly gate?: GitServiceGate,
  ) {}

  public async status(actor: FileActor, workspaceId: string, signal?: AbortSignal): Promise<Result<GitStatusResult>> {
    void actor;
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace.ok) return workspace;
    return this.adapter.status(workspace.value.realRootPath, signal);
  }

  public async branch(actor: FileActor, workspaceId: string): Promise<Result<string | null>> {
    void actor;
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace.ok) return workspace;
    return this.adapter.branch(workspace.value.realRootPath);
  }

  public async diff(
    actor: FileActor,
    workspaceId: string,
    request: GitDiffRequest = {},
    signal?: AbortSignal,
  ): Promise<Result<GitDiffResult>> {
    void actor;
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace.ok) return workspace;
    let pathValue: string | undefined;
    if (request.path !== undefined) {
      const resolved = await this.guard.resolveForWrite(workspace.value, request.path);
      if (!resolved.ok) return resolved;
      pathValue = resolved.value.relativePath;
    }
    return this.adapter.diff(workspace.value.realRootPath, {
      ...(pathValue === undefined ? {} : { path: pathValue }),
      ...(request.staged === undefined ? {} : { staged: request.staged }),
      ...(request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes }),
    }, signal);
  }

  public async log(
    actor: FileActor,
    workspaceId: string,
    request: GitLogRequest = {},
    signal?: AbortSignal,
  ): Promise<Result<GitLogResult>> {
    void actor;
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace.ok) return workspace;
    return this.adapter.log(workspace.value.realRootPath, request, signal);
  }

  public async run(actor: FileActor, request: GitRunRequest, signal?: AbortSignal): Promise<Result<GitCommandResult>> {
    void actor;
    const forbidden = forbiddenGitArg(request.args);
    if (forbidden !== null) return err(appError('PERMISSION_DENIED', `Git argument is not permitted: ${forbidden}`));
    const destructive = isDestructiveGitCommand(request.args);
    const cwd = await this.resolveCwd(request.workspaceId, request.cwd);
    if (!cwd.ok) return cwd;
    if (this.gate !== undefined) {
      const profile = this.gate.profileProvider();
      const decision = (this.gate.permissionEngine ?? this.permissionEngine).decide(profile, {
        action: 'git_run',
        level: destructive ? 'DANGEROUS' : 'EXECUTE',
        workspaceId: request.workspaceId ?? '',
        target: cwd.value,
        executable: 'git',
        destructive,
      });
      if (decision === 'DENY') return err(appError('PERMISSION_DENIED', 'Git execution is denied by the permission profile'));
      if (decision === 'ASK' && request.userConfirmed !== true) {
        return err(appError('PERMISSION_REQUIRED', 'Git execution requires permission; rerun with userConfirmed: true'));
      }
    }
    if (destructive && request.userConfirmed !== true) {
      return err(appError('PERMISSION_REQUIRED', 'Destructive Git operation requires explicit chat confirmation; rerun with userConfirmed: true'));
    }
    return this.adapter.run(cwd.value, request.args, request.timeoutMs, signal);
  }

  private async resolveCwd(workspaceId: string | undefined, requestedCwd: string | undefined): Promise<Result<string>> {
    if (requestedCwd !== undefined && isAbsoluteFsPath(requestedCwd)) {
      const workspace = await resolveWorkspaceForPath(this.workspaces, workspaceId, requestedCwd);
      if (!workspace.ok) return workspace;
      return this.existingDirectory(requestedCwd);
    }

    if (workspaceId === undefined || workspaceId.trim().length === 0) {
      return err(appError('INVALID_INPUT', 'workspaceId is required unless cwd is an absolute path'));
    }

    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace.ok) return workspace;
    if (requestedCwd === undefined) return ok(workspace.value.realRootPath);

    const resolved = await this.guard.resolveForRead(workspace.value, requestedCwd);
    if (!resolved.ok) return resolved;
    return this.existingDirectory(resolved.value.realPath ?? resolved.value.absolutePath);
  }

  private async existingDirectory(directoryPath: string): Promise<Result<string>> {
    try {
      const canonical = await realpath(path.resolve(directoryPath));
      if (!(await stat(canonical)).isDirectory()) return err(appError('INVALID_INPUT', 'Git cwd must be a directory'));
      return ok(canonical);
    } catch {
      return err(appError('FILE_NOT_FOUND', 'Git cwd was not found'));
    }
  }

  private async getWorkspace(workspaceId: string): Promise<Result<Workspace>> {
    const workspace = await this.workspaces.get(workspaceId);
    return workspace === null ? err(appError('WORKSPACE_NOT_FOUND', 'Workspace was not found')) : ok(workspace);
  }
}

/** git -c key=value can enable protocol.ext and turn fetch/push into arbitrary command execution. */
export function forbiddenGitArg(args: readonly string[]): string | null {
  for (const arg of args) {
    if (arg === '-c' || arg.startsWith('--config') || arg.startsWith('--exec-path')) return arg;
    if (arg.includes('::')) return arg;
  }
  return null;
}

/** Destructive git subcommands always require explicit chat confirmation via userConfirmed. */
export function isDestructiveGitCommand(args: readonly string[]): boolean {
  const subcommandIndex = args.findIndex((arg) => !arg.startsWith('-'));
  if (subcommandIndex < 0) return false;
  const subcommand = args[subcommandIndex];
  const rest = args.slice(subcommandIndex + 1);
  switch (subcommand) {
    case 'clean':
    case 'filter-branch':
    case 'filter-repo':
    case 'rm':
      return true;
    case 'reset':
      return rest.some((arg) => arg === '--hard');
    case 'push':
      return rest.some((arg) => arg === '--force' || arg === '-f' || arg.startsWith('--force-'));
    case 'reflog':
      return rest.some((arg) => arg === 'delete' || arg === 'expire');
    case 'branch':
      return rest.some((arg) => arg === '-D');
    case 'stash':
      return rest.some((arg) => arg === 'drop' || arg === 'clear');
    default:
      return false;
  }
}
