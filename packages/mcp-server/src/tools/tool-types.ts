import { err, ok, type Result } from '@lnwjud/domain';
import type { CapabilityService } from '@lnwjud/capabilities';
import type { ExtensionsService } from '@lnwjud/extensions';
import type {
  ApplyPatchRequest,
  CommandRoomBroker,
  CodexService,
  DeleteFileRequest,
  FileActor,
  FileService,
  GitService,
  MoveFileRequest,
  ProcessService,
  ProjectService,
  ReadFileRequest,
  ReadFilesRequest,
  SearchService,
  WorkspaceIndexService,
  WorkspaceQueryService,
  WriteFileRequest,
} from '@lnwjud/application';
import type { z } from 'zod';
import type { ContextEconomyRuntime } from '../context-economy.js';
import type { ActivityTracker } from '../activity-tracker.js';

export interface WorkspaceInfoPort {
  info(actor: FileActor, workspaceId: string): Promise<Result<unknown>>;
  list?(actor: FileActor): Promise<Result<unknown>>;
  register?(actor: FileActor, request: {
    readonly parentWorkspaceId: string;
    readonly path: string;
    readonly displayName?: string;
  }): Promise<Result<unknown>>;
}

export interface ProjectSnapshotPort {
  snapshot(actor: FileActor, workspaceId: string): Promise<Result<unknown>>;
}

export interface WorkspaceLeaseRecord {
  readonly workspaceId: string;
  readonly leaseId: string;
  readonly owner: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

export interface WorkspaceLeasePort {
  acquire(workspaceId: string, owner: string, ttlSeconds: number): Promise<Result<WorkspaceLeaseRecord>>;
  status(workspaceId?: string): Promise<Result<readonly WorkspaceLeaseRecord[]>>;
  renew(workspaceId: string, leaseId: string, ttlSeconds: number): Promise<Result<WorkspaceLeaseRecord>>;
  release(workspaceId: string, leaseId: string): Promise<Result<{ readonly released: boolean }>>;
  assertMutationAllowed(workspaceId: string, leaseId?: string): Promise<Result<void>>;
}

export interface McpApplicationServices {
  readonly runtimeStatePath?: string;
  readonly activityLogPath?: string;
  readonly localProviders?: () => { readonly pdfProvider?: string; readonly lspCommands?: Readonly<Record<string, string>> };
  readonly capabilities?: CapabilityService;
  readonly commandRoom?: Pick<CommandRoomBroker, 'join' | 'status' | 'inbox' | 'send' | 'task' | 'presence' | 'resource' | 'admin'>;
  readonly extensions?: ExtensionsService;
  readonly workspaceInfo?: WorkspaceInfoPort;
  readonly workspaceLeases?: WorkspaceLeasePort;
  readonly workspaceQuery?: Pick<WorkspaceQueryService, 'tree'>;
  readonly projectSnapshot?: ProjectSnapshotPort;
  readonly project?: Pick<ProjectService, 'detect'>;
  readonly file?: Pick<FileService, 'readFile' | 'readFiles' | 'writeFile' | 'applyPatch' | 'moveFile' | 'copyFile' | 'deleteFile'>;
  readonly search?: Pick<SearchService, 'searchFiles' | 'searchText'>;
  readonly workspaceIndex?: Pick<WorkspaceIndexService, 'indexWorkspace' | 'status' | 'startWatch' | 'stopWatch'>;
  readonly git?: Pick<GitService, 'status' | 'diff' | 'log' | 'run'>;
  readonly process?: Pick<ProcessService, 'start' | 'list' | 'status' | 'logs' | 'stop' | 'startProjectCommand'>;
  readonly codex?: Pick<CodexService, 'status' | 'run' | 'list' | 'taskStatus' | 'taskLogs' | 'stop'>;
}

export interface McpToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
}

export type McpPermissionLevel = 'READ' | 'WRITE' | 'EXECUTE' | 'DANGEROUS';

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly permission: McpPermissionLevel;
  readonly annotations: McpToolAnnotations;
  readonly inputSchema: z.ZodType;
  parse(input: unknown): Result<unknown>;
  execute(input: unknown, signal: AbortSignal): Promise<Result<unknown>>;
}

export interface McpToolContext {
  readonly actor: FileActor;
  readonly services: McpApplicationServices;
  readonly contextEconomy: ContextEconomyRuntime;
  readonly activity?: ActivityTracker;
  /** Late-bound actual registry definitions for on-demand discovery; never grants authorization. */
  readonly toolDefinitions?: () => readonly McpToolDefinition[];
}

export interface ToolConfig<T extends z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly permission: McpPermissionLevel;
  readonly annotations: McpToolAnnotations;
  readonly inputSchema: T;
  handler(input: z.infer<T>, signal: AbortSignal): Promise<Result<unknown>>;
}

export function defineTool<T extends z.ZodType>(config: ToolConfig<T>): McpToolDefinition {
  return {
    name: config.name,
    description: config.description,
    permission: config.permission,
    annotations: config.annotations,
    inputSchema: config.inputSchema,
    parse(input: unknown): Result<unknown> {
      const parsed = config.inputSchema.safeParse(input);
      return parsed.success ? ok(parsed.data) : err({ code: 'INVALID_INPUT', message: invalidInputMessage(parsed.error.issues), recoverable: false });
    },
    execute(input: unknown, signal: AbortSignal): Promise<Result<unknown>> {
      return config.handler(input as z.infer<T>, signal);
    },
  };
}

function invalidInputMessage(issues: readonly unknown[]): string {
  const details = issues.slice(0, 5).map(schemaIssueDetail).filter((detail): detail is string => detail !== undefined);
  return details.length === 0 ? 'Tool input is invalid' : `Tool input is invalid: ${details.join('; ')}`;
}

function schemaIssueDetail(issue: unknown): string | undefined {
  if (!isRecord(issue)) return undefined;
  const path = Array.isArray(issue.path)
    ? issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number').join('.')
    : '';
  const field = path.length > 0 ? path : 'input';
  if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
    const keys = issue.keys.filter((key): key is string => typeof key === 'string').slice(0, 5);
    return keys.length > 0 ? `unknown field(s): ${keys.join(', ')}` : `${field}: unknown field`;
  }
  if (issue.code === 'invalid_type' && typeof issue.expected === 'string') return `${field}: expected ${issue.expected}`;
  if (issue.code === 'invalid_format' && typeof issue.format === 'string') return `${field}: expected ${issue.format}`;
  return `${field}: invalid value`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function missingService<T>(): Result<T> {
  return err({ code: 'INTERNAL_ERROR', message: 'MCP application service is unavailable', recoverable: true });
}

export type { ApplyPatchRequest, DeleteFileRequest, MoveFileRequest, ReadFileRequest, ReadFilesRequest, WriteFileRequest };
