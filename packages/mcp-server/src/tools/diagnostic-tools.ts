import { open } from 'node:fs/promises';
import { Redactor } from '@lnwjud/audit';
import { APP_NAME, APP_VERSION } from '@lnwjud/shared';
import { ok, type Result } from '@lnwjud/domain';
import { z } from 'zod';
import type { ActivityTracker } from '../activity-tracker.js';
import type { McpToolResponse } from '../result-mapper.js';
import { defineTool, type McpApplicationServices, type McpToolDefinition } from './tool-types.js';

const MAX_ACTIVITY_BYTES = 256 * 1024;

export interface DiagnosticToolInvoker {
  invoke(name: string, input: unknown, signal?: AbortSignal): Promise<McpToolResponse>;
  describe(name: string): Pick<McpToolDefinition, 'permission'> | undefined;
}

export function diagnosticTools(
  services: McpApplicationServices,
  activity: ActivityTracker,
  invoker: DiagnosticToolInvoker,
): readonly McpToolDefinition[] {
  return [defineTool({
    name: 'diagnostic_bundle_create',
    description: 'Create a bounded read-only diagnostic snapshot of NAVA health, MCP recovery, durable tasks, in-flight work, crash context, and redacted recent activity.',
    permission: 'READ',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: z.object({
      workspaceId: z.string().trim().min(1).max(128).optional(),
      includeEventLog: z.boolean().default(true),
      tailEntries: z.number().int().min(1).max(500).default(100),
    }).strict(),
    async handler(input, signal): Promise<Result<unknown>> {
      const checks: Record<string, unknown> = {};
      for (const request of diagnosticRequests(input.workspaceId, input.includeEventLog)) {
        if (invoker.describe(request.tool)?.permission !== 'READ') continue;
        checks[request.tool] = responseValue(await invoker.invoke(request.tool, request.input, signal));
      }
      const recentActivity = await readActivityTail(services.activityLogPath, input.tailEntries);
      const redactor = new Redactor();
      const redactedChecks = redactor.redact(checks);
      const issues = Object.entries(redactedChecks as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'object' && value !== null && 'error' in value)
        .map(([source, value]) => ({ source, error: (value as { error: unknown }).error }));
      return ok(redactor.redact({
        product: APP_NAME,
        version: APP_VERSION,
        generatedAt: new Date().toISOString(),
        readOnly: true,
        bounded: true,
        issues,
        inFlight: activity.listInFlight().filter((entry) => entry.toolName !== 'diagnostic_bundle_create'),
        recentActivity,
        checks: redactedChecks,
      }));
    },
  })];
}

function diagnosticRequests(workspaceId: string | undefined, includeEventLog: boolean): readonly { readonly tool: string; readonly input: Record<string, unknown> }[] {
  return [
    { tool: 'health', input: { operation: 'check_all' } },
    { tool: 'mcp_health', input: {} },
    { tool: 'recovery_status', input: workspaceId === undefined ? {} : { workspaceId } },
    { tool: 'task_list', input: {} },
    ...(includeEventLog ? [{ tool: 'crash_trace', input: { max_events: 50 } }] : []),
  ];
}

function responseValue(response: McpToolResponse): unknown {
  if (response.isError === true) return { error: response.structuredContent ?? response.content };
  return response.structuredContent ?? response.content;
}

async function readActivityTail(filePath: string | undefined, tailEntries: number): Promise<unknown> {
  if (filePath === undefined) return { available: false, entries: [] };
  try {
    const handle = await open(filePath, 'r');
    try {
      const size = (await handle.stat()).size;
      const length = Math.min(size, MAX_ACTIVITY_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, Math.max(0, size - length));
      const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-tailEntries);
      return { available: true, truncated: size > length, entries: lines.map(parseLine) };
    } finally {
      await handle.close();
    }
  } catch {
    return { available: false, entries: [] };
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return line.slice(0, 4_096);
  }
}
