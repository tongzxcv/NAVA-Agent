import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  COMMAND_ROOM_MANIFEST_VERSION,
  type CommandRoomAgentRecord,
  type CommandRoomMessageRecord,
  type CommandRoomProvider,
  type CommandRoomRecord,
  type CommandRoomResourceLeaseRecord,
  type CommandRoomResourceRecord,
  type CommandRoomTaskRecord,
} from '@lnwjud/domain';
import { appError, err, ok, type Result } from '@lnwjud/domain';

const MAX_SUMMARY_BYTES = 16 * 1024;
const MAX_SUBJECT_LENGTH = 200;
const MAX_EVIDENCE_REFS = 20;
const DEFAULT_INBOX_LIMIT = 25;
const MAX_INBOX_LIMIT = 50;

export interface CommandRoomJoinRepositoryInput {
  readonly roomId: string;
  readonly slotKey: string;
  readonly joinCodeHash: string;
  readonly sessionHash: string;
  readonly provider: CommandRoomProvider;
  readonly connectionEpoch: number;
  readonly joinedAt: string;
}

export type CommandRoomJoinRepositoryResult =
  | { readonly joined: true; readonly agent: CommandRoomAgentRecord; readonly roomVersion: number }
  | { readonly joined: false; readonly reason: 'ROOM_NOT_FOUND' | 'SLOT_NOT_FOUND' | 'INVALID_JOIN_CODE' | 'STALE_EPOCH' };

export interface CommandRoomAppendMessageInput {
  readonly message: Omit<CommandRoomMessageRecord, 'seq'>;
  readonly recipientAgentIds: readonly string[];
}

export interface CommandRoomAppendMessageResult {
  readonly duplicate: boolean;
  readonly message: CommandRoomMessageRecord;
  readonly roomVersion: number;
}

export interface CommandRoomInboxPage {
  readonly messages: readonly CommandRoomMessageRecord[];
  readonly truncated: boolean;
  readonly nextCursor: number;
}

export type CommandRoomTaskMutationResult =
  | {
    readonly outcome: 'updated';
    readonly duplicate: boolean;
    readonly task: CommandRoomTaskRecord;
    readonly roomVersion: number;
    readonly eventType: string;
  }
  | {
    readonly outcome: 'room_version_conflict';
    readonly currentVersion: number;
  }
  | {
    readonly outcome: 'task_version_conflict';
    readonly currentVersion: number;
  }
  | {
    readonly outcome: 'not_found';
  };

export interface CommandRoomCreateTaskInput {
  readonly task: CommandRoomTaskRecord;
  readonly expectedRoomVersion: number;
  readonly actorAgentId: string;
  readonly eventType: 'ASSIGN';
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export type CommandRoomAdminMutationResult =
  | {
    readonly outcome: 'updated';
    readonly duplicate: boolean;
    readonly room: CommandRoomRecord;
    readonly eventType: string;
    readonly agent?: CommandRoomAgentRecord;
  }
  | { readonly outcome: 'room_version_conflict'; readonly currentVersion: number }
  | { readonly outcome: 'not_found' };

export interface CommandRoomRoomStatusRepositoryInput {
  readonly roomId: string;
  readonly actorAgentId: string;
  readonly expectedVersion: number;
  readonly eventType: 'PAUSE' | 'RESUME' | 'ARCHIVE';
  readonly nextStatus: CommandRoomRecord['status'];
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface CommandRoomRebindRepositoryInput {
  readonly roomId: string;
  readonly actorAgentId: string;
  readonly targetSlotKey: string;
  readonly expectedVersion: number;
  readonly joinCodeHash: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface CommandRoomPresenceRepositoryInput {
  readonly roomId: string;
  readonly agentId: string;
  readonly sessionHash: string;
  readonly action: 'heartbeat' | 'park' | 'leave';
  readonly occurredAt: string;
  readonly projectKey?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly lastCheckpointId?: string | undefined;
}

export interface CommandRoomTransitionTaskInput {
  readonly roomId: string;
  readonly taskId: string;
  readonly actorAgentId: string;
  readonly expectedVersion: number;
  readonly eventType: string;
  readonly nextState: CommandRoomTaskRecord['state'];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly checkpointId?: string | undefined;
  readonly durableTaskId?: string | undefined;
}

export interface CommandRoomRepositoryPort {
  createRoom(input: { readonly room: CommandRoomRecord; readonly agents: readonly CommandRoomAgentRecord[] }): Promise<void>;
  getRoom(id: string): Promise<CommandRoomRecord | null>;
  findRoomByCreationKey(creationKey: string): Promise<CommandRoomRecord | null>;
  listAgents(roomId: string): Promise<readonly CommandRoomAgentRecord[]>;
  getAgentBySlot(roomId: string, slotKey: string): Promise<CommandRoomAgentRecord | null>;
  getAgentBySessionHash(roomId: string, sessionHash: string): Promise<CommandRoomAgentRecord | null>;
  joinAgent(input: CommandRoomJoinRepositoryInput): Promise<CommandRoomJoinRepositoryResult>;
  appendMessage(input: CommandRoomAppendMessageInput): Promise<CommandRoomAppendMessageResult>;
  getCursor(roomId: string, agentId: string): Promise<number>;
  listInbox(roomId: string, agentId: string, cursor: number, limit: number, deliveredAt: string): Promise<CommandRoomInboxPage>;
  ackInbox(roomId: string, agentId: string, ackThrough: number, acknowledgedAt: string): Promise<{ readonly cursor: number; readonly roomVersion: number }>;
  updatePresence(input: CommandRoomPresenceRepositoryInput): Promise<{ readonly agent: CommandRoomAgentRecord; readonly roomVersion: number }>;
  updateRoomStatus(input: CommandRoomRoomStatusRepositoryInput): Promise<CommandRoomAdminMutationResult>;
  rebindAgent(input: CommandRoomRebindRepositoryInput): Promise<CommandRoomAdminMutationResult>;
  getTask(roomId: string, taskId: string): Promise<CommandRoomTaskRecord | null>;
  findTaskByEventKey(roomId: string, actorAgentId: string, idempotencyKey: string): Promise<{ readonly task: CommandRoomTaskRecord; readonly eventType: string } | null>;
  createTask(input: CommandRoomCreateTaskInput): Promise<CommandRoomTaskMutationResult>;
  transitionTask(input: CommandRoomTransitionTaskInput): Promise<CommandRoomTaskMutationResult>;
  listTasks(roomId: string, limit: number): Promise<readonly CommandRoomTaskRecord[]>;
}

export interface CommandRoomWorkspaceLease {
  readonly workspaceId: string;
  readonly leaseId: string;
  readonly owner: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

export interface CommandRoomWorkspaceLeasePort {
  acquire(workspaceId: string, owner: string, ttlSeconds: number): Promise<Result<CommandRoomWorkspaceLease>>;
  status(workspaceId?: string): Promise<Result<readonly CommandRoomWorkspaceLease[]>>;
  renew(workspaceId: string, leaseId: string, ttlSeconds: number): Promise<Result<CommandRoomWorkspaceLease>>;
  release(workspaceId: string, leaseId: string): Promise<Result<{ readonly released: boolean }>>;
}

export interface CommandRoomResourceStatusSnapshot {
  readonly resources: readonly (CommandRoomResourceRecord & { readonly usedUnits: number; readonly availableUnits: number })[];
  readonly leases: readonly CommandRoomResourceLeaseRecord[];
  readonly queueDepth: number;
}

export interface CommandRoomResourcePort {
  status(input: { readonly roomId?: string; readonly now: string }): Promise<CommandRoomResourceStatusSnapshot>;
  request(input: {
    readonly resourceKey: string;
    readonly roomId: string;
    readonly taskId: string;
    readonly agentId: string;
    readonly units: number;
    readonly priority: number;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
    readonly ttlSeconds: number;
  }): Promise<{
    readonly state: 'QUEUED' | 'GRANTED';
    readonly duplicate: boolean;
    readonly requestId: string;
    readonly queuePosition?: number;
    readonly lease?: CommandRoomResourceLeaseRecord;
  }>;
  renew(input: { readonly leaseId: string; readonly agentId: string; readonly renewedAt: string; readonly ttlSeconds: number }): Promise<CommandRoomResourceLeaseRecord>;
  release(input: { readonly leaseId: string; readonly agentId: string; readonly releasedAt: string }): Promise<{ readonly released: boolean }>;
  releaseForTask(roomId: string, taskId: string, releasedAt: string): Promise<number>;
  releaseForAgent(roomId: string, agentId: string, releasedAt: string): Promise<number>;
  releaseForRoom(roomId: string, releasedAt: string): Promise<number>;
}

export interface CommandRoomBrokerDependencies {
  readonly workspaceLeases?: CommandRoomWorkspaceLeasePort;
  readonly resources?: CommandRoomResourcePort;
  readonly workspaceExists?: (workspaceId: string) => Promise<boolean>;
}

export interface CommandRoomEnvelope {
  readonly manifestVersion: string;
  readonly roomVersion: number;
  readonly serverTime: string;
}

export type CommandRoomAdminInput =
  | {
    readonly action: 'create';
    readonly name: string;
    readonly idempotencyKey: string;
    readonly leadSlots?: number | undefined;
  }
  | {
    readonly action: 'pause' | 'resume' | 'archive';
    readonly roomId: string;
    readonly agentSessionId: string;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  }
  | {
    readonly action: 'rebind';
    readonly roomId: string;
    readonly agentSessionId: string;
    readonly targetSlotKey: string;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  };

export interface CommandRoomCreateResponse extends CommandRoomEnvelope {
  readonly action: 'create';
  readonly duplicate: boolean;
  readonly room: CommandRoomRecord;
  readonly joinCodes: Readonly<Record<string, string>>;
}

export interface CommandRoomLifecycleResponse extends CommandRoomEnvelope {
  readonly action: 'pause' | 'resume' | 'archive';
  readonly duplicate: boolean;
  readonly room: CommandRoomRecord;
}

export interface CommandRoomRebindResponse extends CommandRoomEnvelope {
  readonly action: 'rebind';
  readonly duplicate: boolean;
  readonly room: CommandRoomRecord;
  readonly targetSlotKey: string;
  readonly requiredConnectionEpoch: number;
  readonly joinCode?: string;
}

export type CommandRoomAdminResponse = CommandRoomCreateResponse | CommandRoomLifecycleResponse | CommandRoomRebindResponse;

export interface CommandRoomJoinInput {
  readonly roomId: string;
  readonly slotKey: string;
  readonly joinCode: string;
  readonly provider: CommandRoomProvider;
  readonly connectionEpoch: number;
}

export interface CommandRoomJoinResponse extends CommandRoomEnvelope {
  readonly roomId: string;
  readonly agent: PublicCommandRoomAgent;
  readonly agentSessionId: string;
}

export interface PublicCommandRoomAgent {
  readonly id: string;
  readonly slotKey: string;
  readonly role: CommandRoomAgentRecord['role'];
  readonly provider: CommandRoomProvider;
  readonly state: CommandRoomAgentRecord['state'];
  readonly projectKey?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly connectionEpoch: number;
  readonly lastHeartbeatAt?: string;
  readonly currentTaskId?: string;
  readonly lastCheckpointId?: string | undefined;
}

export interface CommandRoomSendInput {
  readonly roomId: string;
  readonly agentSessionId: string;
  readonly targetSlotKey: string;
  readonly kind: CommandRoomMessageRecord['kind'];
  readonly subject: string;
  readonly summary: string;
  readonly evidenceRefs?: readonly string[] | undefined;
  readonly nextAction?: string | undefined;
  readonly priority?: number | undefined;
  readonly replyToId?: string | undefined;
  readonly idempotencyKey: string;
}

export interface CommandRoomSendResponse extends CommandRoomEnvelope {
  readonly duplicate: boolean;
  readonly message: CommandRoomMessageRecord;
}

export type CommandRoomInboxInput =
  | {
    readonly action: 'read';
    readonly roomId: string;
    readonly agentSessionId: string;
    readonly cursor?: number | undefined;
    readonly limit?: number | undefined;
  }
  | {
    readonly action: 'ack';
    readonly roomId: string;
    readonly agentSessionId: string;
    readonly ackThrough: number;
  };

export interface CommandRoomInboxReadResponse extends CommandRoomEnvelope {
  readonly action: 'read';
  readonly cursor: number;
  readonly nextCursor: number;
  readonly truncated: boolean;
  readonly messages: readonly CommandRoomMessageRecord[];
}

export interface CommandRoomInboxAckResponse extends CommandRoomEnvelope {
  readonly action: 'ack';
  readonly cursor: number;
}

export interface CommandRoomStatusInput {
  readonly roomId: string;
  readonly agentSessionId: string;
  readonly taskLimit?: number | undefined;
}

export interface CommandRoomStatusResponse extends CommandRoomEnvelope {
  readonly room: CommandRoomRecord;
  readonly agents: readonly PublicCommandRoomAgent[];
  readonly tasks: readonly CommandRoomTaskRecord[];
  readonly workspaceLeases: {
    readonly observable: boolean;
    readonly sourceTool: 'workspace_lease_status';
    readonly entries: readonly CommandRoomWorkspaceLease[];
  };
  readonly resources: {
    readonly mode: 'SCHEDULED' | 'PHASE_1_MANUAL';
    readonly entries: readonly (CommandRoomResourceRecord & { readonly usedUnits: number; readonly availableUnits: number })[];
    readonly leases: readonly CommandRoomResourceLeaseRecord[];
    readonly queueDepth: number;
  };
}

export interface CommandRoomPresenceInput {
  readonly action: 'heartbeat' | 'park' | 'leave';
  readonly roomId: string;
  readonly agentSessionId: string;
  readonly projectKey?: string | undefined;
  readonly workspaceId?: string | undefined;
  readonly lastCheckpointId?: string | undefined;
}

export interface CommandRoomPresenceResponse extends CommandRoomEnvelope {
  readonly action: CommandRoomPresenceInput['action'];
  readonly agent: PublicCommandRoomAgent;
}

export type CommandRoomResourceInput =
  | {
    readonly action: 'status';
    readonly roomId: string;
    readonly agentSessionId: string;
  }
  | {
    readonly action: 'request';
    readonly roomId: string;
    readonly agentSessionId: string;
    readonly taskId: string;
    readonly resourceKey: string;
    readonly units?: number | undefined;
    readonly priority?: number | undefined;
    readonly idempotencyKey: string;
  }
  | {
    readonly action: 'renew' | 'release';
    readonly roomId: string;
    readonly agentSessionId: string;
    readonly leaseId: string;
  };

export interface CommandRoomResourceResponse extends CommandRoomEnvelope {
  readonly action: CommandRoomResourceInput['action'];
  readonly mode: 'SCHEDULED' | 'PHASE_1_MANUAL';
  readonly automaticScheduling: false;
  readonly entries: readonly (CommandRoomResourceRecord & { readonly usedUnits: number; readonly availableUnits: number })[];
  readonly leases: readonly CommandRoomResourceLeaseRecord[];
  readonly queueDepth: number;
  readonly request?: {
    readonly state: 'QUEUED' | 'GRANTED';
    readonly duplicate: boolean;
    readonly requestId: string;
    readonly queuePosition?: number;
    readonly lease?: CommandRoomResourceLeaseRecord;
  };
  readonly released?: boolean;
  readonly instruction?: string;
}

export type CommandRoomTaskInput =
  | {
    readonly action: 'assign';
    readonly roomId: string;
    readonly agentSessionId: string;
    readonly assignedSlotKey: string;
    readonly projectKey: string;
    readonly workspaceId?: string | undefined;
    readonly title: string;
    readonly brief: CommandRoomTaskRecord['brief'];
    readonly mutationMode: CommandRoomTaskRecord['mutationMode'];
    readonly priority?: number | undefined;
    readonly deadlineAt?: string | undefined;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  }
  | {
    readonly action: 'claim' | 'start' | 'approve' | 'cancel';
    readonly roomId: string;
    readonly agentSessionId: string;
    readonly taskId: string;
    readonly expectedVersion: number;
    readonly idempotencyKey: string;
  }
  | {
    readonly action: 'wait' | 'reject' | 'fail';
    readonly roomId: string;
    readonly agentSessionId: string;
    readonly taskId: string;
    readonly expectedVersion: number;
    readonly reason: string;
    readonly idempotencyKey: string;
  }
  | {
    readonly action: 'submit';
    readonly roomId: string;
    readonly agentSessionId: string;
    readonly taskId: string;
    readonly expectedVersion: number;
    readonly result: {
      readonly summary: string;
      readonly evidenceRefs?: readonly string[] | undefined;
      readonly checkpointId?: string | undefined;
      readonly durableTaskId?: string | undefined;
      readonly nextAction?: string | undefined;
    };
    readonly idempotencyKey: string;
  };

export interface CommandRoomTaskResponse extends CommandRoomEnvelope {
  readonly action: CommandRoomTaskInput['action'];
  readonly duplicate: boolean;
  readonly task: CommandRoomTaskRecord;
  readonly workspaceLease?: CommandRoomWorkspaceLease;
  readonly leaseConflict?: {
    readonly workspaceId: string;
    readonly message: string;
    readonly retryable: true;
  };
}

export class CommandRoomBroker {
  public constructor(
    private readonly repository: CommandRoomRepositoryPort,
    private readonly now: () => Date = () => new Date(),
    private readonly dependencies: CommandRoomBrokerDependencies = {},
  ) {}

  public async admin(input: CommandRoomAdminInput): Promise<Result<CommandRoomAdminResponse>> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!validKey(idempotencyKey)) return err(appError('INVALID_INPUT', 'idempotencyKey must contain 1 to 128 safe characters'));
    if (input.action === 'create') {
      const name = input.name.trim();
      if (name.length === 0 || name.length > 120) return err(appError('INVALID_INPUT', 'name must contain 1 to 120 characters'));
      const existing = await this.repository.findRoomByCreationKey(idempotencyKey);
      if (existing !== null) {
        return ok({ ...envelope(existing.version, this.now()), action: 'create', duplicate: true, room: existing, joinCodes: {} });
      }
      const leadSlots = input.leadSlots ?? 5;
      if (!Number.isInteger(leadSlots) || leadSlots < 1 || leadSlots > 5) return err(appError('INVALID_INPUT', 'leadSlots must be an integer from 1 to 5'));
      const createdAt = this.now().toISOString();
      const roomId = randomUUID();
      const room: CommandRoomRecord = {
        id: roomId,
        name,
        status: 'ACTIVE',
        policy: { directLeadMessaging: false },
        version: 1,
        creationKey: idempotencyKey,
        createdAt,
        updatedAt: createdAt,
      };
      const slots = ['MAIN', ...Array.from({ length: leadSlots }, (_, index) => `LEAD-${index + 1}`)];
      const joinCodes: Record<string, string> = {};
      const agents = slots.map((slotKey): CommandRoomAgentRecord => {
        const joinCode = opaqueToken();
        joinCodes[slotKey] = joinCode;
        return {
          id: randomUUID(),
          roomId,
          slotKey,
          role: slotKey === 'MAIN' ? 'MAIN' : 'LEAD',
          provider: 'CHATGPT',
          state: 'AVAILABLE',
          connectionEpoch: 0,
          capabilities: [],
          joinCodeHash: hash(joinCode),
          createdAt,
          updatedAt: createdAt,
        };
      });
      try {
        await this.repository.createRoom({ room, agents });
      } catch (error: unknown) {
        const raced = await this.repository.findRoomByCreationKey(idempotencyKey);
        if (raced === null) return err(appError('INTERNAL_ERROR', error instanceof Error ? error.message : 'Command Room creation failed', true));
        return ok({ ...envelope(raced.version, this.now()), action: 'create', duplicate: true, room: raced, joinCodes: {} });
      }
      return ok({ ...envelope(room.version, this.now()), action: 'create', duplicate: false, room, joinCodes });
    }

    const authenticated = await this.authenticate(input.roomId, input.agentSessionId, true);
    if (!authenticated.ok) return authenticated;
    if (authenticated.value.agent.role !== 'MAIN') return err(appError('PERMISSION_DENIED', 'Only MAIN can manage the Command Room'));
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) return err(appError('INVALID_INPUT', 'expectedVersion must be a positive integer'));
    const occurredAt = this.now().toISOString();

    if (input.action === 'rebind') {
      const targetSlotKey = input.targetSlotKey.trim().toUpperCase();
      const target = await this.repository.getAgentBySlot(input.roomId, targetSlotKey);
      if (target === null) return err(appError('INVALID_INPUT', 'targetSlotKey must identify a Command Room slot'));
      if (target.currentTaskId !== undefined) return err(appError('PERMISSION_REQUIRED', 'Cannot rebind a Lead that still owns a task; finish, fail, cancel, or park it first', true));
      const joinCode = opaqueToken();
      const changed = await this.repository.rebindAgent({
        roomId: input.roomId,
        actorAgentId: authenticated.value.agent.id,
        targetSlotKey,
        expectedVersion: input.expectedVersion,
        joinCodeHash: hash(joinCode),
        idempotencyKey,
        occurredAt,
      });
      if (changed.outcome !== 'updated') return adminMutationError(changed, input.expectedVersion);
      const agent = changed.agent;
      if (agent === undefined) return err(appError('INTERNAL_ERROR', 'Rebound Command Room slot was not returned', true));
      return ok({
        ...envelope(changed.room.version, this.now()),
        action: 'rebind',
        duplicate: changed.duplicate,
        room: changed.room,
        targetSlotKey,
        requiredConnectionEpoch: agent.connectionEpoch + 1,
        ...(changed.duplicate ? {} : { joinCode }),
      });
    }

    const nextStatus = input.action === 'pause' ? 'PAUSED' : input.action === 'resume' ? 'ACTIVE' : 'ARCHIVED';
    const currentStatus = authenticated.value.room.status;
    if (input.action === 'resume' && currentStatus === 'ARCHIVED') return err(appError('PERMISSION_DENIED', 'Archived Command Rooms cannot be resumed'));
    const changed = await this.repository.updateRoomStatus({
      roomId: input.roomId,
      actorAgentId: authenticated.value.agent.id,
      expectedVersion: input.expectedVersion,
      eventType: input.action.toUpperCase() as 'PAUSE' | 'RESUME' | 'ARCHIVE',
      nextStatus,
      idempotencyKey,
      occurredAt,
    });
    if (changed.outcome !== 'updated') return adminMutationError(changed, input.expectedVersion);
    if (!changed.duplicate && (input.action === 'pause' || input.action === 'archive')) {
      await this.releaseRoomLeases(input.roomId, occurredAt);
    }
    return ok({
      ...envelope(changed.room.version, this.now()),
      action: input.action,
      duplicate: changed.duplicate,
      room: changed.room,
    });
  }

  public async join(input: CommandRoomJoinInput): Promise<Result<CommandRoomJoinResponse>> {
    const room = await this.repository.getRoom(input.roomId);
    if (room === null) return err(appError('FILE_NOT_FOUND', 'Command Room was not found'));
    if (room.status !== 'ACTIVE') return err(appError('PERMISSION_REQUIRED', `Command Room is ${room.status.toLowerCase()}`, true));
    if (input.joinCode.length < 16 || input.joinCode.length > 256) return err(appError('INVALID_INPUT', 'joinCode is invalid'));
    if (!Number.isInteger(input.connectionEpoch) || input.connectionEpoch < 1) return err(appError('INVALID_INPUT', 'connectionEpoch must be a positive integer'));
    const agentSessionId = opaqueToken();
    const joined = await this.repository.joinAgent({
      roomId: room.id,
      slotKey: input.slotKey.trim().toUpperCase(),
      joinCodeHash: hash(input.joinCode),
      sessionHash: hash(agentSessionId),
      provider: input.provider,
      connectionEpoch: input.connectionEpoch,
      joinedAt: this.now().toISOString(),
    });
    if (!joined.joined) return err(joinError(joined.reason));
    return ok({
      ...envelope(joined.roomVersion, this.now()),
      roomId: room.id,
      agent: publicAgent(joined.agent),
      agentSessionId,
    });
  }

  public async send(input: CommandRoomSendInput): Promise<Result<CommandRoomSendResponse>> {
    const authenticated = await this.authenticate(input.roomId, input.agentSessionId);
    if (!authenticated.ok) return authenticated;
    const sender = authenticated.value.agent;
    const target = await this.repository.getAgentBySlot(input.roomId, input.targetSlotKey.trim().toUpperCase());
    if (target === null) return err(appError('FILE_NOT_FOUND', 'Target Command Room slot was not found'));
    if (sender.role === 'LEAD' && target.role !== 'MAIN') {
      return err(appError('PERMISSION_DENIED', 'Lead-to-Lead messages are disabled; send through MAIN'));
    }
    if (sender.id === target.id) return err(appError('INVALID_INPUT', 'sender and target must be different slots'));
    const subject = input.subject.trim();
    const summary = input.summary.trim();
    const evidenceRefs = input.evidenceRefs ?? [];
    if (subject.length === 0 || subject.length > MAX_SUBJECT_LENGTH) return err(appError('INVALID_INPUT', `subject must contain 1 to ${MAX_SUBJECT_LENGTH} characters`));
    if (summary.length === 0 || Buffer.byteLength(summary, 'utf8') > MAX_SUMMARY_BYTES) return err(appError('INVALID_INPUT', 'summary must be non-empty and at most 16 KiB'));
    if (evidenceRefs.length > MAX_EVIDENCE_REFS || evidenceRefs.some((entry) => entry.length === 0 || entry.length > 512)) {
      return err(appError('INVALID_INPUT', 'evidenceRefs must contain at most 20 bounded references'));
    }
    if (!validKey(input.idempotencyKey)) return err(appError('INVALID_INPUT', 'idempotencyKey must contain 1 to 128 safe characters'));
    if (input.nextAction !== undefined && Buffer.byteLength(input.nextAction, 'utf8') > 2_048) return err(appError('INVALID_INPUT', 'nextAction must be at most 2 KiB'));
    const createdAt = this.now().toISOString();
    const appended = await this.repository.appendMessage({
      message: {
        id: randomUUID(),
        roomId: input.roomId,
        senderAgentId: sender.id,
        kind: input.kind,
        subject,
        body: {
          summary,
          evidenceRefs: [...evidenceRefs],
          ...(input.nextAction === undefined ? {} : { nextAction: input.nextAction.trim() }),
        },
        priority: input.priority ?? 0,
        idempotencyKey: input.idempotencyKey,
        createdAt,
        ...(input.replyToId === undefined ? {} : { replyToId: input.replyToId }),
      },
      recipientAgentIds: [target.id],
    });
    if (appended.duplicate && !sameMessage(appended.message, input, subject, summary, evidenceRefs)) {
      return err(appError('INVALID_INPUT', 'idempotencyKey was already used with different message content'));
    }
    return ok({
      ...envelope(appended.roomVersion, this.now()),
      duplicate: appended.duplicate,
      message: appended.message,
    });
  }

  public async inbox(input: CommandRoomInboxInput): Promise<Result<CommandRoomInboxReadResponse | CommandRoomInboxAckResponse>> {
    const authenticated = await this.authenticate(input.roomId, input.agentSessionId);
    if (!authenticated.ok) return authenticated;
    const agent = authenticated.value.agent;
    if (input.action === 'ack') {
      if (!Number.isInteger(input.ackThrough) || input.ackThrough < 0) return err(appError('INVALID_INPUT', 'ackThrough must be a non-negative integer'));
      const acked = await this.repository.ackInbox(input.roomId, agent.id, input.ackThrough, this.now().toISOString());
      return ok({
        ...envelope(acked.roomVersion, this.now()),
        action: 'ack',
        cursor: acked.cursor,
      });
    }
    const storedCursor = await this.repository.getCursor(input.roomId, agent.id);
    const cursor = input.cursor ?? storedCursor;
    const limit = input.limit ?? DEFAULT_INBOX_LIMIT;
    if (!Number.isInteger(cursor) || cursor < 0) return err(appError('INVALID_INPUT', 'cursor must be a non-negative integer'));
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INBOX_LIMIT) return err(appError('INVALID_INPUT', 'limit must be an integer from 1 to 50'));
    const page = await this.repository.listInbox(input.roomId, agent.id, cursor, limit, this.now().toISOString());
    const room = await this.repository.getRoom(input.roomId);
    if (room === null) return err(appError('FILE_NOT_FOUND', 'Command Room was not found'));
    return ok({
      ...envelope(room.version, this.now()),
      action: 'read',
      cursor,
      nextCursor: page.nextCursor,
      truncated: page.truncated,
      messages: page.messages,
    });
  }

  public async status(input: CommandRoomStatusInput): Promise<Result<CommandRoomStatusResponse>> {
    const authenticated = await this.authenticate(input.roomId, input.agentSessionId, true);
    if (!authenticated.ok) return authenticated;
    const taskLimit = input.taskLimit ?? 50;
    if (!Number.isInteger(taskLimit) || taskLimit < 1 || taskLimit > 100) return err(appError('INVALID_INPUT', 'taskLimit must be an integer from 1 to 100'));
    const now = this.now();
    const [room, agents, tasks, workspaceLeaseResult, resourceSnapshot] = await Promise.all([
      this.repository.getRoom(input.roomId),
      this.repository.listAgents(input.roomId),
      this.repository.listTasks(input.roomId, taskLimit),
      this.dependencies.workspaceLeases?.status(),
      this.dependencies.resources?.status({ roomId: input.roomId, now: now.toISOString() }),
    ]);
    if (room === null) return err(appError('FILE_NOT_FOUND', 'Command Room was not found'));
    const ownerPrefix = `command-room:${input.roomId}:`;
    const workspaceEntries = workspaceLeaseResult?.ok === true
      ? workspaceLeaseResult.value.filter((lease) => lease.owner.startsWith(ownerPrefix))
      : [];
    return ok({
      ...envelope(room.version, now),
      room,
      agents: agents.map(publicAgent),
      tasks,
      workspaceLeases: {
        observable: workspaceLeaseResult?.ok === true,
        sourceTool: 'workspace_lease_status',
        entries: workspaceEntries,
      },
      resources: resourceSnapshot === undefined
        ? { mode: 'PHASE_1_MANUAL', entries: [], leases: [], queueDepth: 0 }
        : { mode: 'SCHEDULED', entries: resourceSnapshot.resources, leases: resourceSnapshot.leases, queueDepth: resourceSnapshot.queueDepth },
    });
  }

  public async presence(input: CommandRoomPresenceInput): Promise<Result<CommandRoomPresenceResponse>> {
    const authenticated = await this.authenticate(input.roomId, input.agentSessionId);
    if (!authenticated.ok) return authenticated;
    for (const [field, value] of [['projectKey', input.projectKey], ['workspaceId', input.workspaceId], ['lastCheckpointId', input.lastCheckpointId]] as const) {
      if (value !== undefined && (value.trim().length < 1 || value.trim().length > 128)) return err(appError('INVALID_INPUT', `${field} must contain 1 to 128 characters`));
    }
    const updated = await this.repository.updatePresence({
      roomId: input.roomId,
      agentId: authenticated.value.agent.id,
      sessionHash: hash(input.agentSessionId),
      action: input.action,
      occurredAt: this.now().toISOString(),
      ...(input.projectKey === undefined ? {} : { projectKey: input.projectKey.trim() }),
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId.trim() }),
      ...(input.lastCheckpointId === undefined ? {} : { lastCheckpointId: input.lastCheckpointId.trim() }),
    });
    await this.reconcilePresenceLeases(input.action, authenticated.value.agent, this.now().toISOString());
    const latestAgent = await this.repository.getAgentBySessionHash(input.roomId, hash(input.agentSessionId));
    return ok({
      ...envelope(updated.roomVersion, this.now()),
      action: input.action,
      agent: publicAgent(latestAgent ?? updated.agent),
    });
  }

  public async resource(input: CommandRoomResourceInput): Promise<Result<CommandRoomResourceResponse>> {
    const authenticated = await this.authenticate(input.roomId, input.agentSessionId);
    if (!authenticated.ok) return authenticated;
    const resources = this.dependencies.resources;
    if (resources === undefined) {
      if (input.action !== 'status') return err(appError('INTERNAL_ERROR', 'Command Room resource scheduler is unavailable', true));
      return ok({
        ...envelope(authenticated.value.room.version, this.now()),
        action: 'status',
        mode: 'PHASE_1_MANUAL',
        automaticScheduling: false,
        entries: [],
        leases: [],
        queueDepth: 0,
        instruction: 'Resource scheduler is not wired into this runtime.',
      });
    }
    const occurredAt = this.now().toISOString();
    try {
      let request: CommandRoomResourceResponse['request'];
      let released: boolean | undefined;
      if (input.action === 'request') {
        if (!validKey(input.idempotencyKey)) return err(appError('INVALID_INPUT', 'idempotencyKey must contain 1 to 128 safe characters'));
        const task = await this.repository.getTask(input.roomId, input.taskId);
        if (task === null || task.assignedAgentId !== authenticated.value.agent.id) return err(appError('PERMISSION_DENIED', 'Resource requests require a task assigned to this agent'));
        if (task.state !== 'RUNNING') return err(appError('INVALID_INPUT', 'Resource requests require a RUNNING task'));
        request = await resources.request({
          resourceKey: input.resourceKey.trim(),
          roomId: input.roomId,
          taskId: input.taskId,
          agentId: authenticated.value.agent.id,
          units: input.units ?? 1,
          priority: input.priority ?? Math.max(0, task.priority),
          idempotencyKey: input.idempotencyKey,
          requestedAt: occurredAt,
          ttlSeconds: 900,
        });
      } else if (input.action === 'renew') {
        const lease = await resources.renew({ leaseId: input.leaseId, agentId: authenticated.value.agent.id, renewedAt: occurredAt, ttlSeconds: 900 });
        request = { state: 'GRANTED', duplicate: false, requestId: lease.leaseId, lease };
      } else if (input.action === 'release') {
        released = (await resources.release({ leaseId: input.leaseId, agentId: authenticated.value.agent.id, releasedAt: occurredAt })).released;
      }
      const snapshot = await resources.status({ roomId: input.roomId, now: occurredAt });
      return ok({
        ...envelope(authenticated.value.room.version, this.now()),
        action: input.action,
        mode: 'SCHEDULED',
        automaticScheduling: false,
        entries: snapshot.resources,
        leases: snapshot.leases,
        queueDepth: snapshot.queueDepth,
        ...(request === undefined ? {} : { request }),
        ...(released === undefined ? {} : { released }),
      });
    } catch (error: unknown) {
      return err(appError('PERMISSION_REQUIRED', error instanceof Error ? error.message : 'Command Room resource operation failed', true));
    }
  }

  public async task(input: CommandRoomTaskInput): Promise<Result<CommandRoomTaskResponse>> {
    const authenticated = await this.authenticate(input.roomId, input.agentSessionId);
    if (!authenticated.ok) return authenticated;
    const actor = authenticated.value.agent;
    if (!validKey(input.idempotencyKey)) return err(appError('INVALID_INPUT', 'idempotencyKey must contain 1 to 128 safe characters'));

    if (input.action === 'assign') {
      if (actor.role !== 'MAIN') return err(appError('PERMISSION_DENIED', 'Only MAIN can assign Command Room tasks'));
      if (input.mutationMode === 'WRITE') {
        if (input.workspaceId === undefined) return err(appError('INVALID_INPUT', 'WRITE tasks require workspaceId'));
        if (this.dependencies.workspaceExists !== undefined && !(await this.dependencies.workspaceExists(input.workspaceId))) {
          return err(appError('WORKSPACE_NOT_FOUND', 'WRITE tasks require a registered workspaceId'));
        }
      }
      const assigned = await this.repository.getAgentBySlot(input.roomId, input.assignedSlotKey.trim().toUpperCase());
      if (assigned === null) return err(appError('INVALID_INPUT', 'assignedSlotKey must identify a Command Room participant slot'));
      const valid = validateTaskBrief(input);
      if (!valid.ok) return valid;
      const occurredAt = this.now().toISOString();
      const task: CommandRoomTaskRecord = {
        id: randomUUID(),
        roomId: input.roomId,
        projectKey: input.projectKey.trim(),
        title: input.title.trim(),
        brief: {
          summary: input.brief.summary.trim(),
          acceptanceCriteria: [...input.brief.acceptanceCriteria],
          evidenceRefs: [...input.brief.evidenceRefs],
          ...(input.brief.nextAction === undefined ? {} : { nextAction: input.brief.nextAction.trim() }),
        },
        mutationMode: input.mutationMode,
        state: 'QUEUED',
        priority: input.priority ?? 0,
        assignedAgentId: assigned.id,
        createdByAgentId: actor.id,
        version: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId.trim() }),
        ...(input.deadlineAt === undefined ? {} : { deadlineAt: input.deadlineAt }),
      };
      const created = await this.repository.createTask({
        task,
        expectedRoomVersion: input.expectedVersion,
        actorAgentId: actor.id,
        eventType: 'ASSIGN',
        payload: { assignedSlotKey: assigned.slotKey, projectKey: task.projectKey, mutationMode: task.mutationMode },
        idempotencyKey: input.idempotencyKey,
        occurredAt,
      });
      return taskMutationResponse(created, input.action, input, this.now());
    }

    const replay = await this.repository.findTaskByEventKey(input.roomId, actor.id, input.idempotencyKey);
    if (replay !== null) {
      const expectedEvent = input.action.toUpperCase();
      if (replay.task.id !== input.taskId || replay.eventType !== expectedEvent) {
        return err(appError('INVALID_INPUT', 'idempotencyKey was already used for a different task mutation'));
      }
      const room = await this.repository.getRoom(input.roomId);
      if (room === null) return err(appError('FILE_NOT_FOUND', 'Command Room was not found'));
      return ok({ ...envelope(room.version, this.now()), action: input.action, duplicate: true, task: replay.task });
    }

    const task = await this.repository.getTask(input.roomId, input.taskId);
    if (task === null) return err(appError('FILE_NOT_FOUND', 'Command Room task was not found'));
    const decision = taskDecision(input.action, actor, task);
    if (!decision.ok) return decision;
    const payload = taskPayload(input);
    if (!payload.ok) return payload;
    const occurredAt = this.now().toISOString();
    let workspaceLease: CommandRoomWorkspaceLease | undefined;
    if (input.action === 'start' && task.mutationMode === 'WRITE') {
      if (task.workspaceId === undefined) return err(appError('INVALID_INPUT', 'WRITE task has no workspaceId'));
      const workspaceLeases = this.dependencies.workspaceLeases;
      if (workspaceLeases === undefined) return err(appError('INTERNAL_ERROR', 'Workspace lease service is unavailable', true));
      const acquired = await workspaceLeases.acquire(task.workspaceId, workspaceLeaseOwner(input.roomId, actor.slotKey, task.id), 900);
      if (!acquired.ok) {
        const waiting = await this.repository.transitionTask({
          roomId: input.roomId,
          taskId: task.id,
          actorAgentId: actor.id,
          expectedVersion: input.expectedVersion,
          eventType: 'START',
          nextState: 'WAITING',
          payload: { reason: acquired.error.message, workspaceId: task.workspaceId },
          idempotencyKey: input.idempotencyKey,
          occurredAt,
        });
        const response = taskMutationResponse(waiting, input.action, input, this.now());
        return response.ok
          ? ok({ ...response.value, leaseConflict: { workspaceId: task.workspaceId, message: acquired.error.message, retryable: true } })
          : response;
      }
      workspaceLease = acquired.value;
    }
    const transitioned = await this.repository.transitionTask({
      roomId: input.roomId,
      taskId: task.id,
      actorAgentId: actor.id,
      expectedVersion: input.expectedVersion,
      eventType: input.action.toUpperCase(),
      nextState: nextTaskState(input.action),
      payload: payload.value,
      idempotencyKey: input.idempotencyKey,
      occurredAt,
      ...(input.action === 'submit' && input.result.checkpointId !== undefined ? { checkpointId: input.result.checkpointId } : {}),
      ...(input.action === 'submit' && input.result.durableTaskId !== undefined ? { durableTaskId: input.result.durableTaskId } : {}),
    });
    if (transitioned.outcome !== 'updated' && workspaceLease !== undefined) {
      await this.dependencies.workspaceLeases?.release(workspaceLease.workspaceId, workspaceLease.leaseId);
    }
    if (transitioned.outcome === 'updated' && !transitioned.duplicate && ['wait', 'submit', 'fail', 'cancel'].includes(input.action)) {
      await this.releaseTaskLeases(task, occurredAt);
    }
    const response = taskMutationResponse(transitioned, input.action, input, this.now());
    return response.ok && workspaceLease !== undefined ? ok({ ...response.value, workspaceLease }) : response;
  }

  private async reconcilePresenceLeases(action: CommandRoomPresenceInput['action'], agent: CommandRoomAgentRecord, occurredAt: string): Promise<void> {
    if (action === 'park' || action === 'leave') {
      if (agent.currentTaskId !== undefined) {
        const task = await this.repository.getTask(agent.roomId, agent.currentTaskId);
        if (task !== null) {
          if (task.state === 'RUNNING') {
            await this.repository.transitionTask({
              roomId: task.roomId,
              taskId: task.id,
              actorAgentId: agent.id,
              expectedVersion: task.version,
              eventType: action.toUpperCase(),
              nextState: 'WAITING',
              payload: { reason: `Agent ${action} released active leases` },
              idempotencyKey: `presence-${action}:${task.version}`,
              occurredAt,
            });
          }
          await this.releaseTaskLeases(task, occurredAt);
        }
      }
      await this.dependencies.resources?.releaseForAgent(agent.roomId, agent.id, occurredAt);
      return;
    }
    if (agent.currentTaskId === undefined) return;
    const task = await this.repository.getTask(agent.roomId, agent.currentTaskId);
    if (task === null || task.state !== 'RUNNING') return;
    if (task.mutationMode === 'WRITE' && task.workspaceId !== undefined && this.dependencies.workspaceLeases !== undefined) {
      const active = await this.dependencies.workspaceLeases.status(task.workspaceId);
      const lease = active.ok
        ? active.value.find((entry) => entry.owner === workspaceLeaseOwner(agent.roomId, agent.slotKey, task.id))
        : undefined;
      if (lease !== undefined) {
        await this.dependencies.workspaceLeases.renew(task.workspaceId, lease.leaseId, 900);
      } else {
        await this.repository.transitionTask({
          roomId: task.roomId,
          taskId: task.id,
          actorAgentId: agent.id,
          expectedVersion: task.version,
          eventType: 'LEASE_EXPIRED',
          nextState: 'WAITING',
          payload: { reason: 'Workspace writer lease expired; start the task again to reacquire it' },
          idempotencyKey: `lease-expired:${task.version}`,
          occurredAt,
        });
        await this.dependencies.resources?.releaseForTask(task.roomId, task.id, occurredAt);
        return;
      }
    }
    if (this.dependencies.resources !== undefined) {
      const snapshot = await this.dependencies.resources.status({ roomId: agent.roomId, now: occurredAt });
      for (const lease of snapshot.leases.filter((entry) => entry.owner.agentId === agent.id && entry.owner.taskId === task.id)) {
        await this.dependencies.resources.renew({ leaseId: lease.leaseId, agentId: agent.id, renewedAt: occurredAt, ttlSeconds: 900 });
      }
    }
  }

  private async releaseTaskLeases(task: CommandRoomTaskRecord, occurredAt: string): Promise<void> {
    if (task.workspaceId !== undefined && this.dependencies.workspaceLeases !== undefined) {
      const active = await this.dependencies.workspaceLeases.status(task.workspaceId);
      if (active.ok) {
        const prefix = `command-room:${task.roomId}:`;
        for (const lease of active.value.filter((entry) => entry.owner.startsWith(prefix) && entry.owner.endsWith(`:${task.id}`))) {
          await this.dependencies.workspaceLeases.release(task.workspaceId, lease.leaseId);
        }
      }
    }
    await this.dependencies.resources?.releaseForTask(task.roomId, task.id, occurredAt);
  }

  private async releaseRoomLeases(roomId: string, occurredAt: string): Promise<void> {
    if (this.dependencies.workspaceLeases !== undefined) {
      const active = await this.dependencies.workspaceLeases.status();
      if (active.ok) {
        const prefix = `command-room:${roomId}:`;
        for (const lease of active.value.filter((entry) => entry.owner.startsWith(prefix))) {
          await this.dependencies.workspaceLeases.release(lease.workspaceId, lease.leaseId);
        }
      }
    }
    await this.dependencies.resources?.releaseForRoom(roomId, occurredAt);
  }

  private async authenticate(roomId: string, agentSessionId: string, allowInactive: boolean = false): Promise<Result<{ readonly room: CommandRoomRecord; readonly agent: CommandRoomAgentRecord }>> {
    if (agentSessionId.length < 16 || agentSessionId.length > 256) return err(appError('PERMISSION_DENIED', 'Command Room session is invalid'));
    const room = await this.repository.getRoom(roomId);
    if (room === null) return err(appError('FILE_NOT_FOUND', 'Command Room was not found'));
    if (!allowInactive && room.status !== 'ACTIVE') return err(appError('PERMISSION_REQUIRED', `Command Room is ${room.status.toLowerCase()}`, true));
    const agent = await this.repository.getAgentBySessionHash(roomId, hash(agentSessionId));
    if (agent === null || agent.state === 'OFFLINE') return err(appError('PERMISSION_DENIED', 'Command Room session is invalid or no longer active'));
    return ok({ room, agent });
  }
}

function workspaceLeaseOwner(roomId: string, slotKey: string, taskId: string): string {
  return `command-room:${roomId}:${slotKey}:${taskId}`;
}

function envelope(roomVersion: number, now: Date): CommandRoomEnvelope {
  return { manifestVersion: COMMAND_ROOM_MANIFEST_VERSION, roomVersion, serverTime: now.toISOString() };
}

function publicAgent(agent: CommandRoomAgentRecord): PublicCommandRoomAgent {
  return {
    id: agent.id,
    slotKey: agent.slotKey,
    role: agent.role,
    provider: agent.provider,
    state: agent.state,
    connectionEpoch: agent.connectionEpoch,
    ...(agent.projectKey === undefined ? {} : { projectKey: agent.projectKey }),
    ...(agent.workspaceId === undefined ? {} : { workspaceId: agent.workspaceId }),
    ...(agent.lastHeartbeatAt === undefined ? {} : { lastHeartbeatAt: agent.lastHeartbeatAt }),
    ...(agent.currentTaskId === undefined ? {} : { currentTaskId: agent.currentTaskId }),
    ...(agent.lastCheckpointId === undefined ? {} : { lastCheckpointId: agent.lastCheckpointId }),
  };
}

function joinError(reason: Exclude<CommandRoomJoinRepositoryResult, { joined: true }>['reason']): ReturnType<typeof appError> {
  switch (reason) {
    case 'ROOM_NOT_FOUND': return appError('FILE_NOT_FOUND', 'Command Room was not found');
    case 'SLOT_NOT_FOUND': return appError('FILE_NOT_FOUND', 'Command Room slot was not found');
    case 'STALE_EPOCH': return appError('INVALID_INPUT', 'connectionEpoch must be exactly one greater than the current slot epoch');
    case 'INVALID_JOIN_CODE': return appError('PERMISSION_DENIED', 'joinCode is invalid, expired, or already used');
  }
}

function adminMutationError(
  result: Exclude<CommandRoomAdminMutationResult, { outcome: 'updated' }>,
  expectedVersion: number,
): Result<never> {
  return result.outcome === 'not_found'
    ? err(appError('FILE_NOT_FOUND', 'Command Room was not found'))
    : err(appError('INVALID_INPUT', `Room version conflict: expected ${expectedVersion}, current ${result.currentVersion}`));
}

function validateTaskBrief(input: Extract<CommandRoomTaskInput, { action: 'assign' }>): Result<void> {
  if (input.projectKey.trim().length < 1 || input.projectKey.trim().length > 128) return err(appError('INVALID_INPUT', 'projectKey must contain 1 to 128 characters'));
  if (input.workspaceId !== undefined && (input.workspaceId.trim().length < 1 || input.workspaceId.trim().length > 128)) return err(appError('INVALID_INPUT', 'workspaceId must contain 1 to 128 characters'));
  if (input.title.trim().length < 1 || input.title.trim().length > 200) return err(appError('INVALID_INPUT', 'title must contain 1 to 200 characters'));
  if (Buffer.byteLength(JSON.stringify(input.brief), 'utf8') > 32 * 1024 || input.brief.summary.trim().length === 0) return err(appError('INVALID_INPUT', 'brief must be non-empty and at most 32 KiB'));
  if (input.brief.acceptanceCriteria.length > 20 || input.brief.acceptanceCriteria.some((entry) => entry.length < 1 || entry.length > 512)) return err(appError('INVALID_INPUT', 'acceptanceCriteria must contain at most 20 bounded entries'));
  if (input.brief.evidenceRefs.length > MAX_EVIDENCE_REFS || input.brief.evidenceRefs.some((entry) => entry.length < 1 || entry.length > 512)) return err(appError('INVALID_INPUT', 'brief evidenceRefs must contain at most 20 bounded references'));
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) return err(appError('INVALID_INPUT', 'expectedVersion must be a positive integer'));
  return ok(undefined);
}

function taskDecision(action: Exclude<CommandRoomTaskInput['action'], 'assign'>, actor: CommandRoomAgentRecord, task: CommandRoomTaskRecord): Result<void> {
  const assigned = task.assignedAgentId === actor.id;
  if (action === 'approve' || action === 'reject' || action === 'cancel') {
    if (actor.role !== 'MAIN') return err(appError('PERMISSION_DENIED', `Only MAIN can ${action} a task`));
  } else if (!assigned) {
    return err(appError('PERMISSION_DENIED', 'Task is assigned to another Command Room slot'));
  }
  const allowed: Readonly<Record<typeof action, readonly CommandRoomTaskRecord['state'][]>> = {
    claim: ['QUEUED'],
    start: ['CLAIMED', 'WAITING'],
    wait: ['CLAIMED', 'RUNNING'],
    submit: ['RUNNING', 'WAITING'],
    approve: ['REVIEW'],
    reject: ['REVIEW'],
    fail: ['QUEUED', 'CLAIMED', 'RUNNING', 'WAITING'],
    cancel: ['QUEUED', 'CLAIMED', 'RUNNING', 'WAITING', 'REVIEW'],
  };
  return allowed[action].includes(task.state)
    ? ok(undefined)
    : err(appError('INVALID_INPUT', `Cannot ${action} a task in ${task.state} state`));
}

function nextTaskState(action: Exclude<CommandRoomTaskInput['action'], 'assign'>): CommandRoomTaskRecord['state'] {
  switch (action) {
    case 'claim': return 'CLAIMED';
    case 'start': return 'RUNNING';
    case 'wait':
    case 'reject': return 'WAITING';
    case 'submit': return 'REVIEW';
    case 'approve': return 'COMPLETED';
    case 'fail': return 'FAILED';
    case 'cancel': return 'CANCELLED';
  }
}

function taskPayload(input: Exclude<CommandRoomTaskInput, { action: 'assign' }>): Result<Readonly<Record<string, unknown>>> {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) return err(appError('INVALID_INPUT', 'expectedVersion must be a positive integer'));
  if (input.action === 'wait' || input.action === 'reject' || input.action === 'fail') {
    const reason = input.reason.trim();
    return reason.length < 1 || Buffer.byteLength(reason, 'utf8') > 2_048
      ? err(appError('INVALID_INPUT', 'reason must be non-empty and at most 2 KiB'))
      : ok({ reason });
  }
  if (input.action !== 'submit') return ok({});
  const summary = input.result.summary.trim();
  const evidenceRefs = input.result.evidenceRefs ?? [];
  if (summary.length < 1 || Buffer.byteLength(summary, 'utf8') > 32 * 1024) return err(appError('INVALID_INPUT', 'result summary must be non-empty and at most 32 KiB'));
  if (evidenceRefs.length > MAX_EVIDENCE_REFS || evidenceRefs.some((entry) => entry.length < 1 || entry.length > 512)) return err(appError('INVALID_INPUT', 'result evidenceRefs must contain at most 20 bounded references'));
  if (input.result.nextAction !== undefined && Buffer.byteLength(input.result.nextAction, 'utf8') > 2_048) return err(appError('INVALID_INPUT', 'result nextAction must be at most 2 KiB'));
  return ok({
    summary,
    evidenceRefs: [...evidenceRefs],
    ...(input.result.checkpointId === undefined ? {} : { checkpointId: input.result.checkpointId }),
    ...(input.result.durableTaskId === undefined ? {} : { durableTaskId: input.result.durableTaskId }),
    ...(input.result.nextAction === undefined ? {} : { nextAction: input.result.nextAction.trim() }),
  });
}

function taskMutationResponse(
  result: CommandRoomTaskMutationResult,
  action: CommandRoomTaskInput['action'],
  input: CommandRoomTaskInput,
  now: Date,
): Result<CommandRoomTaskResponse> {
  switch (result.outcome) {
    case 'updated':
      if (result.eventType !== action.toUpperCase()) return err(appError('INVALID_INPUT', 'idempotencyKey was already used for a different task mutation'));
      if (action === 'assign' && result.duplicate) {
        const assigned = input as Extract<CommandRoomTaskInput, { action: 'assign' }>;
        if (result.task.title !== assigned.title.trim() || result.task.projectKey !== assigned.projectKey.trim()) {
          return err(appError('INVALID_INPUT', 'idempotencyKey was already used with different task content'));
        }
      }
      return ok({ ...envelope(result.roomVersion, now), action, duplicate: result.duplicate, task: result.task });
    case 'room_version_conflict':
      return err(appError('INVALID_INPUT', `Room version conflict: expected ${input.expectedVersion}, current ${result.currentVersion}`));
    case 'task_version_conflict':
      return err(appError('INVALID_INPUT', `Task version conflict: expected ${input.expectedVersion}, current ${result.currentVersion}`));
    case 'not_found':
      return err(appError('FILE_NOT_FOUND', 'Command Room or task was not found'));
  }
}

function sameMessage(
  message: CommandRoomMessageRecord,
  input: CommandRoomSendInput,
  subject: string,
  summary: string,
  evidenceRefs: readonly string[],
): boolean {
  return message.kind === input.kind
    && message.subject === subject
    && message.body.summary === summary
    && JSON.stringify(message.body.evidenceRefs) === JSON.stringify(evidenceRefs)
    && message.body.nextAction === input.nextAction?.trim()
    && message.replyToId === input.replyToId;
}

function validKey(value: string): boolean {
  return value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9._:/-]+$/.test(value);
}

function opaqueToken(): string {
  return randomBytes(24).toString('base64url');
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
