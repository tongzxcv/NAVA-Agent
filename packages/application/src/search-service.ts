import path from 'node:path';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import { RipgrepAdapter, type ContextDiscoveryMode, type SearchFilesRequest as AdapterFilesRequest, type SearchFilesResult, type SearchTextRequest as AdapterTextRequest, type SearchTextResult } from '@lnwjud/search';
import type { Workspace, WorkspaceRepository } from '@lnwjud/workspace';
import type { FileActor } from './file-service.js';
import { isAbsoluteFsPath, resolveWorkspaceForPath } from './workspace-locator.js';

export interface SearchTextRequest {
  readonly query: string;
  readonly path?: string;
  readonly glob?: string;
  readonly maxResults?: number;
  readonly discovery?: ContextDiscoveryMode;
}

export interface SearchFilesRequest {
  readonly path?: string;
  readonly glob?: string;
  readonly maxResults?: number;
  readonly discovery?: ContextDiscoveryMode;
}

export interface SearchAdapter {
  searchText(request: AdapterTextRequest): Promise<Result<SearchTextResult>>;
  searchFiles(request: AdapterFilesRequest): Promise<Result<SearchFilesResult>>;
}

export class SearchService {
  public constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly adapter: SearchAdapter = new RipgrepAdapter(),
  ) {}

  public async searchText(actor: FileActor, workspaceId: string | undefined, request: SearchTextRequest, signal?: AbortSignal): Promise<Result<SearchTextResult>> {
    void actor;
    const validation = this.validateLimit(request.maxResults);
    if (!validation.ok) return validation;
    if (request.query.length === 0) return err(appError('INVALID_INPUT', 'Search query is required'));
    const workspace = await resolveWorkspaceForPath(this.workspaces, workspaceId, request.path ?? '.');
    if (!workspace.ok) return workspace;
    const rootPath = searchRootPath(workspace.value, request.path);
    if (!rootPath.ok) return rootPath;
    return this.adapter.searchText({
      rootPath: rootPath.value,
      query: request.query,
      ...(request.glob === undefined ? {} : { glob: request.glob }),
      ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
      ...(request.discovery === undefined ? {} : { discovery: request.discovery }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  public async searchFiles(actor: FileActor, workspaceId: string | undefined, request: SearchFilesRequest, signal?: AbortSignal): Promise<Result<SearchFilesResult>> {
    void actor;
    const validation = this.validateLimit(request.maxResults);
    if (!validation.ok) return validation;
    const workspace = await resolveWorkspaceForPath(this.workspaces, workspaceId, request.path ?? '.');
    if (!workspace.ok) return workspace;
    const rootPath = searchRootPath(workspace.value, request.path);
    if (!rootPath.ok) return rootPath;
    return this.adapter.searchFiles({
      rootPath: rootPath.value,
      ...(request.glob === undefined ? {} : { glob: request.glob }),
      ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
      ...(request.discovery === undefined ? {} : { discovery: request.discovery }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  private validateLimit(limit: number | undefined): Result<void> {
    return limit === undefined || Number.isInteger(limit) && limit >= 1 && limit <= 500
      ? ok(undefined)
      : err(appError('INVALID_INPUT', 'Search result limit is invalid'));
  }
}

function searchRootPath(workspace: Workspace, requestedPath: string | undefined): Result<string> {
  if (requestedPath === undefined || requestedPath === '.') return ok(workspace.realRootPath);
  const flavor = path.win32.isAbsolute(workspace.realRootPath) ? path.win32 : path.posix;
  const candidate = isAbsoluteFsPath(requestedPath)
    ? flavor.resolve(requestedPath)
    : flavor.resolve(workspace.realRootPath, requestedPath);
  const withinWorkspace = [workspace.realRootPath, workspace.rootPath].some((root) => {
    const rootFlavor = path.win32.isAbsolute(root) ? path.win32 : path.posix;
    const relative = rootFlavor.relative(rootFlavor.resolve(root), rootFlavor.resolve(candidate));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${rootFlavor.sep}`) && !rootFlavor.isAbsolute(relative));
  });
  return !withinWorkspace
    ? err(appError('PATH_OUTSIDE_WORKSPACE', 'Path is outside the workspace'))
    : ok(candidate);
}
