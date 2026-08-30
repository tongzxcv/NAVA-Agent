import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import type { DiagnosticLogger, FileActor } from '@lnwjud/application';
import type { PermissionProfile } from '@lnwjud/permissions';
import { APP_NAME, APP_VERSION } from '@lnwjud/shared';
import { readTraceContext, type ActivitySink, type ActivityTracker } from './activity-tracker.js';
import { withProgressHeartbeat, type ProgressNotifyContext } from './progress-heartbeat.js';
import { IncrementalVerifier } from './incremental-verifier.js';
import { RunBudgetGuard, type RunBudgetContext } from './run-budget.js';
import { registerTasksProtocol } from './tasks-protocol.js';
import { ToolRegistry, type McpApplicationServices } from './tool-registry.js';

export const MCP_RESPONSE_BUDGET_BYTES = 8 * 1024 * 1024;
export const NAVA_SERVER_INSTRUCTIONS = [
  'Use NAVA session continuity for multi-step project work.',
  'For Command Room authority, call command_room_presence and command_room_status directly; never place a joinCode or agentSessionId inside tool_batch. Refresh connector if either direct tool is missing.',
  'Call session_resume with a stable projectKey before continuing work from another or a new chat.',
  'Call session_checkpoint before a long operation and after meaningful milestones such as file changes, verification, commits, blockers, or a changed next action.',
  'NAVA also saves a bounded automatic checkpoint after successful workspace mutations when workspaceId is present; verify it before the next mutation.',
  'Store only bounded summaries, evidence references, boundaries, and the next action; never store prompts, credentials, secrets, or raw large logs.',
  'Verify a resumed checkpoint against current Git, workspace, durable task, and Obsidian evidence before mutating files.',
  'For concurrent writers, call workspace_authority or workspace_lease_status first, then follow nava-multi-chat-coordinator and use one expiring writer lease per workspace.',
  'Call workspace_lease_call only with outer fields workspaceId, leaseId, tool, and arguments; put all child-tool fields inside arguments and never flatten them.',
  'Call capabilities or tool_categories after a connector refresh to verify the essential tool surface and manifestVersion; primitive tools remain available.',
  'mcp_health distinguishes local MCP availability from remote control-plane health; unknown means the layer is not observable, not that it is healthy.',
  'Live Logs are bounded in memory and persisted through a rotating file sink; use limit and treat truncated=true as an instruction to narrow the query.',
  'If a chat reports missing tools or a stale schema, Refresh connector first and open a new chat only if refresh does not fix it.',
].join(' ');

export interface McpServerOptions {
  readonly services: McpApplicationServices;
  readonly actor: FileActor;
  readonly diagnostic?: DiagnosticLogger;
  readonly activity?: ActivitySink;
  readonly activityTracker?: ActivityTracker;
  readonly profileProvider?: () => PermissionProfile;
  readonly allowAiDeleteProvider?: () => boolean;
  /** Exposes quota-consuming Codex delegation tools. Disabled unless explicitly enabled. */
  readonly codexToolsEnabled?: boolean;
  /** Exposes the local Command Room broker. Disabled unless explicitly enabled. */
  readonly commandRoomEnabled?: boolean;
  /** Shared across per-request server factories so repeated diff fingerprints can hit cache. */
  readonly incrementalVerifier?: IncrementalVerifier;
  /** Shared across per-request server factories so the run clock starts at the first tool call. */
  readonly runBudgetGuard?: RunBudgetGuard;
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const registry = new ToolRegistry(options.services, options.actor, {
    ...(options.diagnostic === undefined ? {} : { diagnostic: options.diagnostic }),
    ...(options.activity === undefined ? {} : { activity: options.activity }),
    ...(options.activityTracker === undefined ? {} : { activityTracker: options.activityTracker }),
    ...(options.profileProvider === undefined ? {} : { profileProvider: options.profileProvider }),
    ...(options.allowAiDeleteProvider === undefined ? {} : { allowAiDeleteProvider: options.allowAiDeleteProvider }),
    ...(options.codexToolsEnabled === undefined ? {} : { codexToolsEnabled: options.codexToolsEnabled }),
    ...(options.commandRoomEnabled === undefined ? {} : { commandRoomEnabled: options.commandRoomEnabled }),
    ...(options.incrementalVerifier === undefined ? {} : { incrementalVerifier: options.incrementalVerifier }),
  });
  const runBudgetGuard = options.runBudgetGuard ?? new RunBudgetGuard();
  // tasks capability (MCP spec 2025-11-25) exposes existing durable shell
  // background tasks via tasks/get/result/list/cancel. requests.tools.call is
  // intentionally not declared, so clients will not send task-augmented
  // tool calls.
  const server = new McpServer({ name: APP_NAME, version: APP_VERSION }, {
    instructions: NAVA_SERVER_INSTRUCTIONS,
    capabilities: {
      tools: {},
      tasks: { list: {}, cancel: {} },
    },
  });
  registerTasksProtocol(server, options.services);
  for (const tool of registry.list()) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    }, async (input: unknown, context): Promise<CallToolResult> => {
      const dispatchContext = context as ProgressNotifyContext & RunBudgetContext;
      runBudgetGuard.begin(dispatchContext);
      const result = await withProgressHeartbeat(dispatchContext, tool.name, async () => (
        registry.invoke(tool.name, input, readTraceContext(context)) as unknown as Promise<CallToolResult>
      ));
      return enforceResponseBudget(tool.name, runBudgetGuard.finish(dispatchContext, result));
    });
  }
  return server;
}

export function enforceResponseBudget(toolName: string, result: CallToolResult): CallToolResult {
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= MCP_RESPONSE_BUDGET_BYTES) return result;
  const message = oversizedResponseMessage(toolName);
  return {
    isError: true,
    content: [{ type: 'text', text: `RESPONSE_TOO_LARGE: ${message}` }],
    structuredContent: { error: { code: 'RESPONSE_TOO_LARGE', message, recoverable: true } },
  };
}

function oversizedResponseMessage(toolName: string): string {
  if (toolName === 'read_file' || toolName === 'read_files') {
    return 'Result exceeded the safe MCP transport size. Use read_file_page with a smaller pageSize or responseTargetBytes.';
  }
  if (toolName === 'shell') {
    return 'Result exceeded the safe MCP transport size. Lower max_output_bytes or use a background task and read bounded logs.';
  }
  if (toolName === 'accessibility') {
    return 'Result exceeded the safe MCP transport size. Use observe_summary or inspect a smaller set of elements without a screenshot.';
  }
  return 'Result exceeded the safe MCP transport size. Narrow the request or use a paged or bounded tool.';
}
