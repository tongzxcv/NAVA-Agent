export const COMMAND_ROOM_MANIFEST_VERSION = '1.0.0';

export type CommandRoomStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type CommandRoomRole = 'MAIN' | 'LEAD';
export type CommandRoomProvider = 'CHATGPT' | 'CODEX' | 'OTHER';
export type CommandRoomAgentState = 'AVAILABLE' | 'ONLINE' | 'WORKING' | 'WAITING' | 'SLEEPING' | 'OFFLINE';
export type CommandRoomMessageKind = 'UPDATE' | 'QUESTION' | 'RESULT' | 'HANDOFF';
export type CommandRoomReceiptStatus = 'QUEUED' | 'DELIVERED' | 'ACKED' | 'EXPIRED' | 'DEAD_LETTER';
export type CommandRoomMutationMode = 'READ_ONLY' | 'WRITE';
export type CommandRoomTaskState = 'QUEUED' | 'CLAIMED' | 'RUNNING' | 'WAITING' | 'REVIEW' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type CommandRoomBindingState = 'CHALLENGED' | 'PAIRED' | 'STALE' | 'REVOKED' | 'REPLACED';
export type CommandRoomWakeDeliveryState = 'QUEUED' | 'ATTEMPTING' | 'DELIVERED' | 'SUBMITTED' | 'MANUAL_FALLBACK' | 'DEAD_LETTER' | 'CANCELLED';
export type CommandRoomWakeReason = 'TASK_ASSIGNED' | 'HANDOFF_READY' | 'USER_WAKE';

export interface CommandRoomPolicy {
  readonly directLeadMessaging: boolean;
}

export interface CommandRoomRecord {
  readonly id: string;
  readonly name: string;
  readonly status: CommandRoomStatus;
  readonly policy: CommandRoomPolicy;
  readonly version: number;
  readonly creationKey: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export interface CommandRoomAgentRecord {
  readonly id: string;
  readonly roomId: string;
  readonly slotKey: string;
  readonly role: CommandRoomRole;
  readonly provider: CommandRoomProvider;
  readonly state: CommandRoomAgentState;
  readonly projectKey?: string;
  readonly workspaceId?: string;
  readonly connectionEpoch: number;
  readonly currentTaskId?: string;
  readonly lastHeartbeatAt?: string;
  readonly lastCheckpointId?: string;
  readonly capabilities: readonly string[];
  readonly joinCodeHash?: string;
  readonly sessionHash?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CommandRoomMessageBody {
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly nextAction?: string;
}

export interface CommandRoomMessageRecord {
  readonly seq: number;
  readonly id: string;
  readonly roomId: string;
  readonly senderAgentId: string;
  readonly kind: CommandRoomMessageKind;
  readonly subject: string;
  readonly body: CommandRoomMessageBody;
  readonly priority: number;
  readonly replyToId?: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface CommandRoomTaskBrief {
  readonly summary: string;
  readonly acceptanceCriteria: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly nextAction?: string | undefined;
}

export interface CommandRoomTaskRecord {
  readonly id: string;
  readonly roomId: string;
  readonly projectKey: string;
  readonly workspaceId?: string;
  readonly title: string;
  readonly brief: CommandRoomTaskBrief;
  readonly mutationMode: CommandRoomMutationMode;
  readonly state: CommandRoomTaskState;
  readonly priority: number;
  readonly assignedAgentId?: string;
  readonly createdByAgentId: string;
  readonly checkpointId?: string;
  readonly durableTaskId?: string;
  readonly version: number;
  readonly claimedAt?: string;
  readonly startedAt?: string;
  readonly deadlineAt?: string;
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CommandRoomBindingRecord {
  readonly id: string;
  readonly roomId: string;
  readonly agentId: string;
  readonly slotKey: string;
  readonly provider: CommandRoomProvider;
  readonly extensionInstallationId?: string;
  readonly encryptedConversationRef?: string;
  readonly conversationRefFingerprint?: string;
  readonly connectionEpoch: number;
  readonly state: CommandRoomBindingState;
  readonly challengeHash?: string;
  readonly challengeExpiresAt?: string;
  readonly pairedAt?: string;
  readonly lastSeenAt?: string;
  readonly revokedAt?: string;
  readonly replacedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CommandRoomWakeDeliveryRecord {
  readonly id: string;
  readonly roomId: string;
  readonly agentId: string;
  readonly bindingId: string;
  readonly eventKey: string;
  readonly taskId?: string;
  readonly reason: CommandRoomWakeReason;
  readonly state: CommandRoomWakeDeliveryState;
  readonly attemptCount: number;
  readonly lastAttemptAt?: string;
  readonly nextEligibleAt?: string;
  readonly deliveredAt?: string;
  readonly submittedAt?: string;
  readonly lastErrorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CommandRoomResourceKind = 'MT5_TERMINAL' | 'CPU_HEAVY' | 'VPS_WRITER' | 'MANAGED_BROWSER_WRITER' | 'GPU_HEAVY';
export type CommandRoomResourceRequestState = 'QUEUED' | 'GRANTED' | 'RELEASED' | 'CANCELLED';

export interface CommandRoomResourceRecord {
  readonly resourceKey: string;
  readonly kind: CommandRoomResourceKind;
  readonly capacity: number;
  readonly enabled: boolean;
  readonly policy: Readonly<Record<string, unknown>>;
}

export interface CommandRoomResourceLeaseRecord {
  readonly leaseId: string;
  readonly resourceKey: string;
  readonly owner: {
    readonly roomId: string;
    readonly taskId: string;
    readonly agentId: string;
  };
  readonly units: number;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}
