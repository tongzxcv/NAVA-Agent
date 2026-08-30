import { z } from 'zod';
import { defineTool, missingService, type McpToolContext, type McpToolDefinition } from './tool-types.js';

const roomId = z.string().uuid();
const sessionId = z.string().trim().min(16).max(256);
const idempotencyKey = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:/-]+$/);
const slotKey = z.string().trim().min(1).max(32);
const provider = z.enum(['CHATGPT', 'CODEX', 'OTHER']);
const expectedVersion = z.number().int().min(1);
const evidenceRefs = z.array(z.string().trim().min(1).max(512)).max(20).default([]);

const joinSchema = z.object({
  roomId,
  slotKey,
  joinCode: z.string().min(16).max(256),
  provider,
  connectionEpoch: z.number().int().min(1),
}).strict();

const statusSchema = z.union([
  z.object({
    roomId,
    agentSessionId: sessionId,
    taskLimit: z.number().int().min(1).max(100).optional(),
  }).strict(),
  z.object({
    action: z.literal('resume_check'),
    roomId,
    slotKey,
    connectionEpoch: z.number().int().min(0),
    agentSessionId: sessionId.optional(),
  }).strict(),
]);

const inboxSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('read'),
    roomId,
    agentSessionId: sessionId,
    cursor: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }).strict(),
  z.object({
    action: z.literal('ack'),
    roomId,
    agentSessionId: sessionId,
    ackThrough: z.number().int().min(0),
  }).strict(),
]);

const sendSchema = z.object({
  roomId,
  agentSessionId: sessionId,
  targetSlotKey: slotKey,
  kind: z.enum(['UPDATE', 'QUESTION', 'RESULT', 'HANDOFF']),
  subject: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(16 * 1024),
  evidenceRefs,
  nextAction: z.string().max(2 * 1024).optional(),
  priority: z.number().int().min(-10).max(10).optional(),
  replyToId: z.string().uuid().optional(),
  idempotencyKey,
}).strict();

const taskIdentity = {
  roomId,
  agentSessionId: sessionId,
  taskId: z.string().uuid(),
  expectedVersion,
  idempotencyKey,
};

const taskSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('assign'),
    roomId,
    agentSessionId: sessionId,
    assignedSlotKey: slotKey,
    projectKey: z.string().trim().min(1).max(128),
    workspaceId: z.string().trim().min(1).max(128).optional(),
    title: z.string().trim().min(1).max(200),
    brief: z.object({
      summary: z.string().trim().min(1).max(32 * 1024),
      acceptanceCriteria: z.array(z.string().trim().min(1).max(512)).max(20),
      evidenceRefs,
      nextAction: z.string().max(2 * 1024).optional(),
    }).strict(),
    mutationMode: z.enum(['READ_ONLY', 'WRITE']),
    priority: z.number().int().min(-10).max(10).optional(),
    deadlineAt: z.string().datetime().optional(),
    expectedVersion,
    idempotencyKey,
  }).strict(),
  ...(['claim', 'start', 'approve', 'cancel'] as const).map((action) => z.object({ action: z.literal(action), ...taskIdentity }).strict()),
  ...(['wait', 'reject', 'fail'] as const).map((action) => z.object({ action: z.literal(action), ...taskIdentity, reason: z.string().trim().min(1).max(2 * 1024) }).strict()),
  z.object({
    action: z.literal('submit'),
    ...taskIdentity,
    result: z.object({
      summary: z.string().trim().min(1).max(32 * 1024),
      evidenceRefs,
      checkpointId: z.string().trim().min(1).max(128).optional(),
      durableTaskId: z.string().trim().min(1).max(128).optional(),
      nextAction: z.string().max(2 * 1024).optional(),
    }).strict(),
  }).strict(),
]);

const presenceSchema = z.object({
  action: z.enum(['heartbeat', 'park', 'leave']),
  roomId,
  agentSessionId: sessionId,
  projectKey: z.string().trim().min(1).max(128).optional(),
  workspaceId: z.string().trim().min(1).max(128).optional(),
  lastCheckpointId: z.string().trim().min(1).max(128).optional(),
}).strict();

const resourceSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('status'),
    roomId,
    agentSessionId: sessionId,
  }).strict(),
  z.object({
    action: z.literal('request'),
    roomId,
    agentSessionId: sessionId,
    taskId: z.string().uuid(),
    resourceKey: z.string().trim().min(1).max(128),
    units: z.number().int().min(1).max(7).optional(),
    priority: z.number().int().min(0).max(100).optional(),
    idempotencyKey,
  }).strict(),
  ...(['renew', 'release'] as const).map((action) => z.object({
    action: z.literal(action),
    roomId,
    agentSessionId: sessionId,
    leaseId: z.string().uuid(),
  }).strict()),
]);

const adminSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    name: z.string().trim().min(1).max(120),
    idempotencyKey,
    leadSlots: z.number().int().min(1).max(5).optional(),
  }).strict(),
  ...(['pause', 'resume', 'archive', 'add_lead'] as const).map((action) => z.object({
    action: z.literal(action),
    roomId,
    agentSessionId: sessionId,
    expectedVersion,
    idempotencyKey,
  }).strict()),
  z.object({
    action: z.literal('rebind'),
    roomId,
    agentSessionId: sessionId,
    targetSlotKey: slotKey,
    expectedVersion,
    idempotencyKey,
  }).strict(),
]);

const readOnly = { permission: 'READ' as const, annotations: { readOnlyHint: true, destructiveHint: false } };
const write = { permission: 'WRITE' as const, annotations: { readOnlyHint: false, destructiveHint: false } };

export function commandRoomTools(context: McpToolContext): readonly McpToolDefinition[] {
  return [
    defineTool({
      name: 'command_room_join',
      description: 'Join or replace one manual Command Room slot with a one-time join code and the next connection epoch. Returns an opaque agentSessionId once.',
      ...write,
      inputSchema: joinSchema,
      handler: async (input) => context.services.commandRoom?.join(input) ?? missingService(),
    }),
    defineTool({
      name: 'command_room_status',
      description: 'Read bounded room state with an active session, or preflight room/slot/epoch resume authority. A resumed session is READY only after heartbeat read-back.',
      ...readOnly,
      inputSchema: statusSchema,
      handler: async (input) => context.services.commandRoom?.status(input) ?? missingService(),
    }),
    defineTool({
      name: 'command_room_inbox',
      description: 'Read at most 50 immutable messages from a cursor or explicitly acknowledge through one message sequence.',
      ...write,
      inputSchema: inboxSchema,
      handler: async (input) => context.services.commandRoom?.inbox(input) ?? missingService(),
    }),
    defineTool({
      name: 'command_room_send',
      description: 'Send one bounded update, question, result, or handoff with an idempotency key. Direct Lead-to-Lead delivery is blocked.',
      ...write,
      inputSchema: sendSchema,
      handler: async (input) => context.services.commandRoom?.send(input) ?? missingService(),
    }),
    defineTool({
      name: 'command_room_task',
      description: 'Assign and transition versioned READ_ONLY or WRITE tasks. WRITE start acquires the existing workspace writer lease and returns an actionable WAITING result on collision.',
      ...write,
      inputSchema: taskSchema,
      handler: async (input) => context.services.commandRoom?.task(input) ?? missingService(),
    }),
    defineTool({
      name: 'command_room_presence',
      description: 'Heartbeat, park, or leave the current manual agent session with bounded project/checkpoint references.',
      ...write,
      inputSchema: presenceSchema,
      handler: async (input) => context.services.commandRoom?.presence(input) ?? missingService(),
    }),
    defineTool({
      name: 'command_room_resource',
      description: 'Read, request, renew, or release bounded MT5, CPU, VPS, browser, and GPU resource leases. Busy requests queue by priority, aging, then FIFO; mutations are never auto-retried.',
      ...write,
      inputSchema: resourceSchema,
      handler: async (input) => context.services.commandRoom?.resource(input) ?? missingService(),
    }),
    defineTool({
      name: 'command_room_admin',
      description: 'Create, pause, resume, archive, add the next sequential Lead slot up to LEAD-5, or manually rebind a Command Room slot. MAIN cannot bypass NAVA permissions or destructive confirmations.',
      ...write,
      inputSchema: adminSchema,
      handler: async (input) => context.services.commandRoom?.admin(input) ?? missingService(),
    }),
  ];
}
