import { appError, err, ok, type AppErrorCode, type Result } from '@lnwjud/domain';
import { z } from 'zod';
import type { McpToolResponse } from '../result-mapper.js';
import { defineTool, missingService, type McpToolContext, type McpToolDefinition } from './tool-types.js';

const workspaceId = z.string().trim().min(1).max(128);
const leaseId = z.string().uuid();
const ttlSeconds = z.number().int().min(60).max(7_200).default(900);
const leaseToolNames = new Set(['workspace_lease_acquire', 'workspace_lease_status', 'workspace_lease_renew', 'workspace_lease_release', 'workspace_lease_call']);

export interface WorkspaceLeaseInvoker {
  invoke(name: string, input: unknown, signal?: AbortSignal): Promise<McpToolResponse>;
  describe(name: string): Pick<McpToolDefinition, 'permission'> | undefined;
}

export function workspaceLeaseTools(context: McpToolContext, invoker: WorkspaceLeaseInvoker): readonly McpToolDefinition[] {
  return [
    defineTool({
      name: 'workspace_lease_acquire',
      description: 'Acquire one expiring writer lease for a workspace. Reads remain concurrent; conflicting workspace mutations are blocked until release or expiry.',
      permission: 'WRITE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: z.object({ workspaceId, owner: z.string().trim().min(1).max(128), ttlSeconds }).strict(),
      async handler(input): Promise<Result<unknown>> {
        if (context.services.workspaceLeases === undefined) return missingService();
        const info = await context.services.workspaceInfo?.info(context.actor, input.workspaceId);
        if (info !== undefined && !info.ok) return info;
        return context.services.workspaceLeases.acquire(input.workspaceId, input.owner, input.ttlSeconds);
      },
    }),
    defineTool({
      name: 'workspace_lease_status',
      description: 'List active non-expired workspace writer leases and their owners, heartbeats, and expiry times.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: z.object({ workspaceId: workspaceId.optional() }).strict(),
      async handler(input): Promise<Result<unknown>> {
        return context.services.workspaceLeases?.status(input.workspaceId) ?? missingService();
      },
    }),
    defineTool({
      name: 'workspace_lease_renew',
      description: 'Refresh an owned workspace writer lease before it expires.',
      permission: 'WRITE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: z.object({ workspaceId, leaseId, ttlSeconds }).strict(),
      async handler(input): Promise<Result<unknown>> {
        return context.services.workspaceLeases?.renew(input.workspaceId, input.leaseId, input.ttlSeconds) ?? missingService();
      },
    }),
    defineTool({
      name: 'workspace_lease_release',
      description: 'Release an owned workspace writer lease using its opaque lease ID.',
      permission: 'WRITE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: z.object({ workspaceId, leaseId }).strict(),
      async handler(input): Promise<Result<unknown>> {
        return context.services.workspaceLeases?.release(input.workspaceId, input.leaseId) ?? missingService();
      },
    }),
    defineTool({
      name: 'workspace_lease_call',
      description: 'Run one non-read MCP tool under a matching writer lease. Exact wrapper fields: workspaceId, leaseId, tool, arguments. Put every child-tool field inside arguments. Do not flatten child fields or use operation/name instead of tool. Child permissions and confirmations still apply.',
      permission: 'DANGEROUS',
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: z.object({
        workspaceId,
        leaseId,
        tool: z.string().trim().min(1).max(128),
        arguments: z.record(z.string(), z.unknown()).default({}),
      }).strict(),
      async handler(input, signal): Promise<Result<unknown>> {
        const target = invoker.describe(input.tool);
        if (target === undefined) return err(appError('INVALID_INPUT', `Unknown MCP tool: ${input.tool}`));
        if (target.permission === 'READ') return err(appError('INVALID_INPUT', 'workspace_lease_call is only for non-read tools'));
        if (leaseToolNames.has(input.tool) || input.tool === 'tool_batch') return err(appError('INVALID_INPUT', `Nested ${input.tool} calls are not allowed`));
        const argumentWorkspace = typeof input.arguments.workspaceId === 'string' ? input.arguments.workspaceId : undefined;
        if (argumentWorkspace !== undefined && argumentWorkspace !== input.workspaceId) {
          return err(appError('INVALID_INPUT', 'Child workspaceId must match the leased workspace'));
        }
        const response = await invoker.invoke(input.tool, {
          ...input.arguments,
          _workspaceLeaseId: input.leaseId,
          _workspaceLeaseWorkspaceId: input.workspaceId,
        }, signal);
        if (response.isError === true) return responseError(response);
        return ok({ tool: input.tool, workspaceId: input.workspaceId, result: response.structuredContent ?? response.content });
      },
    }),
  ];
}

function responseError(response: McpToolResponse): Result<never> {
  const error = response.structuredContent !== null && typeof response.structuredContent === 'object' && 'error' in response.structuredContent
    ? (response.structuredContent as { error?: unknown }).error
    : undefined;
  if (typeof error === 'object' && error !== null) {
    const code = 'code' in error && isAppErrorCode(error.code) ? error.code : 'INTERNAL_ERROR';
    const message = 'message' in error && typeof error.message === 'string' ? error.message : 'Leased child tool failed';
    const recoverable = 'recoverable' in error && error.recoverable === true;
    return err(appError(code, message, recoverable));
  }
  return err(appError('INTERNAL_ERROR', 'Leased child tool failed', true));
}

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && new Set<AppErrorCode>([
    'INVALID_INPUT', 'WORKSPACE_NOT_FOUND', 'PATH_OUTSIDE_WORKSPACE', 'SECRET_ACCESS_DENIED', 'PERMISSION_DENIED',
    'PERMISSION_REQUIRED', 'FILE_NOT_FOUND', 'FILE_TOO_LARGE', 'BINARY_FILE', 'PROCESS_NOT_FOUND', 'PROCESS_TIMEOUT',
    'EXECUTABLE_NOT_FOUND', 'SEARCH_FAILED', 'RESPONSE_TOO_LARGE', 'GIT_NOT_REPOSITORY', 'CODEX_NOT_AVAILABLE', 'INTERNAL_ERROR',
  ]).has(value as AppErrorCode);
}
