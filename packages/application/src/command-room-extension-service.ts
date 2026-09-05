import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  CommandRoomBindingRecord,
  CommandRoomProvider,
  CommandRoomSupervisorStateRecord,
  CommandRoomTerminalRecoveryRecord,
  CommandRoomSupervisorSync,
  CommandRoomWakeDeliveryRecord,
  CommandRoomWakeReason,
} from '@lnwjud/domain';

const DEFAULT_PAIRING_TTL_SECONDS = 300;
const MIN_PAIRING_TTL_SECONDS = 30;
const MAX_PAIRING_TTL_SECONDS = 600;
const DEFAULT_WAKE_COOLDOWN_SECONDS = 60;
const DEFAULT_WAKE_MAX_PER_BINDING_HOUR = 12;
const DEFAULT_WAKE_MAX_PER_ROOM_HOUR = 48;
const DEFAULT_WAKE_CIRCUIT_BREAKER_THRESHOLD = 3;
const WAKE_ALLOWLIST = new Set<CommandRoomWakeReason>(['TASK_ASSIGNED', 'HANDOFF_READY', 'USER_WAKE']);

export interface CommandRoomExtensionRepositoryPort {
  createChallenge(input: {
    readonly id: string;
    readonly roomId: string;
    readonly agentId: string;
    readonly slotKey: string;
    readonly provider: CommandRoomProvider;
    readonly connectionEpoch: number;
    readonly challengeHash: string;
    readonly challengeExpiresAt: string;
    readonly createdAt: string;
  }): Promise<CommandRoomBindingRecord>;
  confirmPairing(input: {
    readonly bindingId: string;
    readonly roomId: string;
    readonly agentId: string;
    readonly connectionEpoch: number;
    readonly challengeHash: string;
    readonly extensionInstallationId: string;
    readonly encryptedConversationRef: string;
    readonly conversationRefFingerprint: string;
    readonly confirmedAt: string;
  }): Promise<
    | { readonly outcome: 'paired'; readonly binding: CommandRoomBindingRecord }
    | { readonly outcome: 'not_found' | 'challenge_mismatch' | 'challenge_expired' | 'stale_epoch' | 'invalid_state' }
  >;
  getActiveBinding(roomId: string, agentId: string, connectionEpoch: number): Promise<CommandRoomBindingRecord | null>;
  getBinding(bindingId: string): Promise<CommandRoomBindingRecord | null>;
  listActiveBindingsForInstallation(extensionInstallationId: string): Promise<readonly CommandRoomBindingRecord[]>;
  getTerminalRecoveryByKey(recoveryKey: string): Promise<CommandRoomTerminalRecoveryRecord | null>;
  reserveTerminalRecovery(input: {
    readonly id: string;
    readonly recoveryKey: string;
    readonly roomId: string;
    readonly agentId: string;
    readonly slotKey: string;
    readonly projectKey: string;
    readonly workspaceId: string;
    readonly connectionEpoch: number;
    readonly bindingId: string;
    readonly sourceConversationFingerprint: string;
    readonly terminalTurnFingerprint: string;
    readonly checkpointId: string;
    readonly kind: 'MESSAGE_DELIVERY_TIMEOUT';
    readonly createdAt: string;
  }): Promise<
    | { readonly outcome: 'reserved' | 'existing'; readonly recovery: CommandRoomTerminalRecoveryRecord }
    | { readonly outcome: 'binding_not_active' | 'stale_epoch' | 'identity_mismatch' }
  >;
  claimTerminalRecovery(input: {
    readonly recoveryKey: string;
    readonly bindingId: string;
    readonly connectionEpoch: number;
    readonly claimedAt: string;
  }): Promise<CommandRoomTerminalRecoveryRecord | null>;
  authorizeTerminalRecovery(input: {
    readonly recoveryKey: string;
    readonly bindingId: string;
    readonly connectionEpoch: number;
    readonly continuationBindingId: string;
    readonly authorizedAt: string;
  }): Promise<CommandRoomTerminalRecoveryRecord | null>;
  getAgentAuthority(roomId: string, agentId: string): Promise<{
    readonly roomId: string;
    readonly agentId: string;
    readonly slotKey: string;
    readonly role: 'MAIN' | 'LEAD';
    readonly projectKey?: string;
    readonly workspaceId?: string;
    readonly connectionEpoch: number;
  } | null>;
  getWake(id: string): Promise<CommandRoomWakeDeliveryRecord | null>;
  listRecoverableWakes(now: string, limit?: number): Promise<readonly CommandRoomWakeDeliveryRecord[]>;
  listRecoverableWakesForBinding(bindingId: string, now: string, limit?: number): Promise<readonly CommandRoomWakeDeliveryRecord[]>;
  beginWakeAttempt(id: string, attemptedAt: string, nextEligibleAt: string): Promise<CommandRoomWakeDeliveryRecord | null>;
  markWakeDelivered(id: string, deliveredAt: string): Promise<CommandRoomWakeDeliveryRecord | null>;
  markWakeSubmitted(id: string, submittedAt: string): Promise<CommandRoomWakeDeliveryRecord | null>;
  markWakeAttemptFailed(id: string, occurredAt: string, nextEligibleAt: string, errorCode: string): Promise<CommandRoomWakeDeliveryRecord | null>;
  touch(bindingId: string, seenAt: string): Promise<CommandRoomBindingRecord | null>;
  getWakePolicySnapshot(input: {
    readonly roomId: string;
    readonly agentId: string;
    readonly bindingId: string;
    readonly cooldownSince: string;
    readonly hourlySince: string;
  }): Promise<{
    readonly coalescedDelivery: CommandRoomWakeDeliveryRecord | null;
    readonly bindingWakeCount: number;
    readonly roomWakeCount: number;
    readonly unansweredSubmittedCount: number;
    readonly lastHeartbeatAt?: string;
  }>;
  enqueueWake(input: {
    readonly id: string;
    readonly roomId: string;
    readonly agentId: string;
    readonly bindingId: string;
    readonly eventKey: string;
    readonly taskId?: string;
    readonly reason: CommandRoomWakeReason;
    readonly nextEligibleAt: string;
    readonly createdAt: string;
  }): Promise<
    | { readonly outcome: 'queued'; readonly duplicate: boolean; readonly delivery: CommandRoomWakeDeliveryRecord }
    | { readonly outcome: 'binding_not_active' | 'stale_epoch' | 'not_found' }
  >;
  revoke(bindingId: string, revokedAt: string): Promise<CommandRoomBindingRecord | null>;
  replace(bindingId: string, replacedAt: string): Promise<CommandRoomBindingRecord | null>;
}

export interface CommandRoomSupervisorStateRepositoryPort {
  publish(input: {
    readonly roomId: string;
    readonly agentId: string;
    readonly slotKey: string;
    readonly projectKey: string;
    readonly workspaceId: string;
    readonly connectionEpoch: number;
    readonly bindingId: string;
    readonly bindingFingerprint: string;
    readonly status: CommandRoomSupervisorStateRecord['status'];
    readonly nextAction?: string;
    readonly safeToContinue: boolean;
    readonly needsUser: boolean;
    readonly checkpointId: string;
    readonly durableTaskIds: readonly string[];
    readonly publishedAt: string;
  }): Promise<
    | { readonly outcome: 'published'; readonly state: CommandRoomSupervisorStateRecord }
    | { readonly outcome: 'not_found' | 'binding_not_active' | 'stale_epoch' | 'identity_mismatch' }
  >;
  markSyncStatus(input: {
    readonly roomId: string;
    readonly agentId: string;
    readonly bindingId: string;
    readonly connectionEpoch: number;
    readonly supervisorSync: Exclude<CommandRoomSupervisorSync, 'OK'>;
    readonly updatedAt: string;
  }): Promise<CommandRoomSupervisorStateRecord | null>;
}

export interface CommandRoomSupervisorCheckpointSnapshot {
  readonly id: string;
  readonly projectKey: string;
  readonly workspaceId: string;
  readonly status: CommandRoomSupervisorStateRecord['status'];
  readonly nextAction?: string;
  readonly safeToContinue: boolean;
  readonly needsUser: boolean;
  readonly durableTaskIds: readonly string[];
}

export type CommandRoomSupervisorCheckpointResolver = (input: {
  readonly projectKey: string;
  readonly workspaceId: string;
}) => Promise<CommandRoomSupervisorCheckpointSnapshot | null>;

export interface CommandRoomTerminalRecoverySafetySnapshot {
  readonly workspaceLeaseActive: boolean;
  readonly durableTasks: readonly {
    readonly taskId: string;
    readonly state: 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled' | 'termination_unverified' | 'missing';
  }[];
  readonly ambiguous: boolean;
}

export type CommandRoomTerminalRecoverySafetyResolver = (input: {
  readonly projectKey: string;
  readonly workspaceId: string;
  readonly durableTaskIds: readonly string[];
}) => Promise<CommandRoomTerminalRecoverySafetySnapshot>;

export type CommandRoomTerminalRecoveryResponse =
  | { readonly outcome: 'authorized'; readonly recoveryId: string; readonly checkpointId: string; readonly continuation: PairingChallengeResponse }
  | { readonly outcome: 'duplicate'; readonly recoveryId: string; readonly checkpointId: string }
  | { readonly outcome: 'wait'; readonly reason: 'GENERATION_ACTIVE' | 'NO_SAFE_CHECKPOINT' | 'CHECKPOINT_WORKING' | 'CHECKPOINT_NOT_SAFE' | 'WORKSPACE_BUSY' | 'DURABLE_TASK_RUNNING'; readonly checkpointId?: string }
  | { readonly outcome: 'failed'; readonly reason: 'UNAUTHORIZED' | 'IDENTITY_MISMATCH' | 'STALE_EPOCH' | 'SAFETY_EVIDENCE_UNAVAILABLE' | 'DURABLE_TASK_AMBIGUOUS' | 'RECOVERY_RESERVATION_FAILED' };

export type SyncCommandRoomSupervisorStateResponse =
  | { readonly outcome: 'published'; readonly supervisorSync: 'OK'; readonly state: CommandRoomSupervisorStateRecord }
  | { readonly outcome: 'no_checkpoint' | 'degraded'; readonly supervisorSync: 'DEGRADED' }
  | { readonly outcome: 'unauthorized' | 'identity_mismatch' | 'stale_epoch' | 'unsupported'; readonly supervisorSync: 'FAILED' };

export interface CommandRoomExtensionServiceOptions {
  readonly randomId?: () => string;
  readonly randomChallenge?: () => string;
  readonly wakeCooldownSeconds?: number;
  readonly wakeMaxPerBindingHour?: number;
  readonly wakeMaxPerRoomHour?: number;
  readonly wakeCircuitBreakerThreshold?: number;
  readonly supervisorStateRepository?: CommandRoomSupervisorStateRepositoryPort;
  readonly checkpointResolver?: CommandRoomSupervisorCheckpointResolver;
  readonly terminalRecoverySafetyResolver?: CommandRoomTerminalRecoverySafetyResolver;
}

export interface PairingChallengeResponse {
  readonly bindingId: string;
  readonly challenge: string;
  readonly expiresAt: string;
  readonly connectionEpoch: number;
}

export type QueueWakeResponse =
  | { readonly outcome: 'queued'; readonly duplicate: boolean; readonly delivery: CommandRoomWakeDeliveryRecord }
  | { readonly outcome: 'coalesced'; readonly delivery: CommandRoomWakeDeliveryRecord }
  | { readonly outcome: 'unpaired' | 'binding_not_active' | 'stale_epoch' | 'not_found' }
  | { readonly outcome: 'binding_budget_exhausted' | 'room_budget_exhausted' | 'circuit_open' };

export class CommandRoomExtensionService {
  private readonly randomId: () => string;
  private readonly randomChallenge: () => string;
  private readonly wakeCooldownSeconds: number;
  private readonly wakeMaxPerBindingHour: number;
  private readonly wakeMaxPerRoomHour: number;
  private readonly wakeCircuitBreakerThreshold: number;
  private readonly supervisorStateRepository: CommandRoomSupervisorStateRepositoryPort | undefined;
  private readonly checkpointResolver: CommandRoomSupervisorCheckpointResolver | undefined;
  private readonly terminalRecoverySafetyResolver: CommandRoomTerminalRecoverySafetyResolver | undefined;

  public constructor(
    private readonly repository: CommandRoomExtensionRepositoryPort,
    options: CommandRoomExtensionServiceOptions = {},
  ) {
    this.randomId = options.randomId ?? randomUUID;
    this.randomChallenge = options.randomChallenge ?? ((): string => randomBytes(32).toString('base64url'));
    this.wakeCooldownSeconds = requireIntegerOption(options.wakeCooldownSeconds ?? DEFAULT_WAKE_COOLDOWN_SECONDS, 'wakeCooldownSeconds', 60, 3_600);
    this.wakeMaxPerBindingHour = requireIntegerOption(options.wakeMaxPerBindingHour ?? DEFAULT_WAKE_MAX_PER_BINDING_HOUR, 'wakeMaxPerBindingHour', 1, 120);
    this.wakeMaxPerRoomHour = requireIntegerOption(options.wakeMaxPerRoomHour ?? DEFAULT_WAKE_MAX_PER_ROOM_HOUR, 'wakeMaxPerRoomHour', 1, 600);
    this.wakeCircuitBreakerThreshold = requireIntegerOption(
      options.wakeCircuitBreakerThreshold ?? DEFAULT_WAKE_CIRCUIT_BREAKER_THRESHOLD,
      'wakeCircuitBreakerThreshold', 1, 20,
    );
    this.supervisorStateRepository = options.supervisorStateRepository;
    this.checkpointResolver = options.checkpointResolver;
    this.terminalRecoverySafetyResolver = options.terminalRecoverySafetyResolver;
  }

  public async createPairingChallenge(input: {
    readonly roomId: string;
    readonly agentId: string;
    readonly slotKey: string;
    readonly provider: CommandRoomProvider;
    readonly connectionEpoch: number;
    readonly now: string;
    readonly ttlSeconds?: number;
  }): Promise<PairingChallengeResponse> {
    const ttlSeconds = input.ttlSeconds ?? DEFAULT_PAIRING_TTL_SECONDS;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_PAIRING_TTL_SECONDS || ttlSeconds > MAX_PAIRING_TTL_SECONDS) {
      throw new Error(`Pairing TTL must be an integer between ${MIN_PAIRING_TTL_SECONDS} and ${MAX_PAIRING_TTL_SECONDS} seconds.`);
    }
    const challenge = this.randomChallenge();
    if (challenge.length < 32) throw new Error('Pairing challenge entropy source returned an invalid token.');
    const bindingId = this.randomId();
    const expiresAt = addSeconds(input.now, ttlSeconds);
    await this.repository.createChallenge({
      id: bindingId,
      roomId: input.roomId,
      agentId: input.agentId,
      slotKey: input.slotKey,
      provider: input.provider,
      connectionEpoch: input.connectionEpoch,
      challengeHash: hashSecret(challenge),
      challengeExpiresAt: expiresAt,
      createdAt: input.now,
    });
    return { bindingId, challenge, expiresAt, connectionEpoch: input.connectionEpoch };
  }

  public async confirmPairing(input: {
    readonly bindingId: string;
    readonly roomId: string;
    readonly agentId: string;
    readonly connectionEpoch: number;
    readonly challenge: string;
    readonly extensionInstallationId: string;
    readonly encryptedConversationRef: string;
    readonly conversationRefFingerprint: string;
    readonly confirmedAt: string;
  }): Promise<Awaited<ReturnType<CommandRoomExtensionRepositoryPort['confirmPairing']>>> {
    if (input.challenge.length < 32) return { outcome: 'challenge_mismatch' };
    requireOpaqueId(input.extensionInstallationId, 'extensionInstallationId');
    requireOpaqueId(input.conversationRefFingerprint, 'conversationRefFingerprint');
    if (input.encryptedConversationRef.length < 16) throw new Error('encryptedConversationRef is too short.');
    return this.repository.confirmPairing({
      bindingId: input.bindingId,
      roomId: input.roomId,
      agentId: input.agentId,
      connectionEpoch: input.connectionEpoch,
      challengeHash: hashSecret(input.challenge),
      extensionInstallationId: input.extensionInstallationId,
      encryptedConversationRef: input.encryptedConversationRef,
      conversationRefFingerprint: input.conversationRefFingerprint,
      confirmedAt: input.confirmedAt,
    });
  }

  public async confirmPairingByBinding(input: {
    readonly bindingId: string;
    readonly challenge: string;
    readonly extensionInstallationId: string;
    readonly encryptedConversationRef: string;
    readonly conversationRefFingerprint: string;
    readonly confirmedAt: string;
  }): Promise<Awaited<ReturnType<CommandRoomExtensionRepositoryPort['confirmPairing']>>> {
    const binding = await this.repository.getBinding(input.bindingId);
    if (binding === null) return { outcome: 'not_found' };
    return this.confirmPairing({
      bindingId: binding.id,
      roomId: binding.roomId,
      agentId: binding.agentId,
      connectionEpoch: binding.connectionEpoch,
      challenge: input.challenge,
      extensionInstallationId: input.extensionInstallationId,
      encryptedConversationRef: input.encryptedConversationRef,
      conversationRefFingerprint: input.conversationRefFingerprint,
      confirmedAt: input.confirmedAt,
    });
  }

  public getBinding(bindingId: string): Promise<CommandRoomBindingRecord | null> {
    return this.repository.getBinding(bindingId);
  }

  public async createContinuationChallenge(input: {
    readonly bindingId: string;
    readonly extensionInstallationId: string;
    readonly now: string;
    readonly ttlSeconds?: number;
  }): Promise<PairingChallengeResponse | null> {
    const binding = await this.authenticateBinding(input.bindingId, input.extensionInstallationId);
    if (binding === null) return null;
    return this.createPairingChallenge({
      roomId: binding.roomId,
      agentId: binding.agentId,
      slotKey: binding.slotKey,
      provider: binding.provider,
      connectionEpoch: binding.connectionEpoch,
      now: input.now,
      ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds }),
    });
  }

  public async authenticateBinding(bindingId: string, extensionInstallationId: string): Promise<CommandRoomBindingRecord | null> {
    const binding = await this.repository.getBinding(bindingId);
    if (binding === null || binding.state !== 'PAIRED' || binding.extensionInstallationId !== extensionInstallationId) return null;
    const active = await this.repository.getActiveBinding(binding.roomId, binding.agentId, binding.connectionEpoch);
    return active?.id === binding.id ? active : null;
  }

  public async recoverBindingsForInstallation(input: {
    readonly bindingId: string;
    readonly extensionInstallationId: string;
    readonly conversationRefFingerprints: readonly string[];
  }): Promise<readonly CommandRoomBindingRecord[] | null> {
    const authenticated = await this.authenticateBinding(input.bindingId, input.extensionInstallationId);
    if (authenticated === null) return null;
    const wanted = new Set(input.conversationRefFingerprints.filter((value) => typeof value === 'string' && value.length > 0));
    if (wanted.size === 0) return [];
    const candidates = await this.repository.listActiveBindingsForInstallation(input.extensionInstallationId);
    const recovered: CommandRoomBindingRecord[] = [];
    for (const binding of candidates) {
      if (binding.conversationRefFingerprint === undefined || !wanted.has(binding.conversationRefFingerprint)) continue;
      const active = await this.repository.getActiveBinding(binding.roomId, binding.agentId, binding.connectionEpoch);
      if (active?.id === binding.id) recovered.push(binding);
    }
    return recovered;
  }

  public async assessTerminalRecovery(input: {
    readonly bindingId: string;
    readonly extensionInstallationId: string;
    readonly sourceConversationFingerprint: string;
    readonly terminalTurnFingerprint: string;
    readonly generationActive: boolean;
    readonly now: string;
  }): Promise<CommandRoomTerminalRecoveryResponse> {
    const binding = await this.authenticateBinding(input.bindingId, input.extensionInstallationId);
    if (binding === null) return { outcome: 'failed', reason: 'UNAUTHORIZED' };
    const authority = await this.repository.getAgentAuthority(binding.roomId, binding.agentId);
    if (
      authority === null
      || authority.role !== 'LEAD'
      || authority.projectKey === undefined
      || authority.workspaceId === undefined
      || authority.slotKey !== binding.slotKey
      || binding.conversationRefFingerprint === undefined
      || binding.conversationRefFingerprint !== input.sourceConversationFingerprint
    ) return { outcome: 'failed', reason: 'IDENTITY_MISMATCH' };
    if (authority.connectionEpoch !== binding.connectionEpoch) return { outcome: 'failed', reason: 'STALE_EPOCH' };
    if (input.generationActive) return { outcome: 'wait', reason: 'GENERATION_ACTIVE' };
    if (this.checkpointResolver === undefined || this.terminalRecoverySafetyResolver === undefined) {
      return { outcome: 'failed', reason: 'SAFETY_EVIDENCE_UNAVAILABLE' };
    }

    let checkpoint: CommandRoomSupervisorCheckpointSnapshot | null;
    try {
      checkpoint = await this.checkpointResolver({ projectKey: authority.projectKey, workspaceId: authority.workspaceId });
    } catch {
      return { outcome: 'failed', reason: 'SAFETY_EVIDENCE_UNAVAILABLE' };
    }
    if (checkpoint === null) return { outcome: 'wait', reason: 'NO_SAFE_CHECKPOINT' };
    if (checkpoint.projectKey !== authority.projectKey || checkpoint.workspaceId !== authority.workspaceId) {
      return { outcome: 'failed', reason: 'IDENTITY_MISMATCH' };
    }
    if (checkpoint.status === 'WORKING') return { outcome: 'wait', reason: 'CHECKPOINT_WORKING', checkpointId: checkpoint.id };
    const nextAction = checkpoint.nextAction?.trim();
    if (checkpoint.status !== 'DONE' || !checkpoint.safeToContinue || checkpoint.needsUser || nextAction === undefined || nextAction.length === 0) {
      return { outcome: 'wait', reason: 'CHECKPOINT_NOT_SAFE', checkpointId: checkpoint.id };
    }

    const recoveryKey = terminalRecoveryKey(binding, input.terminalTurnFingerprint, checkpoint.id);
    const reserved = await this.repository.reserveTerminalRecovery({
      id: this.randomId(),
      recoveryKey,
      roomId: binding.roomId,
      agentId: binding.agentId,
      slotKey: binding.slotKey,
      projectKey: authority.projectKey,
      workspaceId: authority.workspaceId,
      connectionEpoch: binding.connectionEpoch,
      bindingId: binding.id,
      sourceConversationFingerprint: input.sourceConversationFingerprint,
      terminalTurnFingerprint: input.terminalTurnFingerprint,
      checkpointId: checkpoint.id,
      kind: 'MESSAGE_DELIVERY_TIMEOUT',
      createdAt: input.now,
    });
    if (reserved.outcome === 'stale_epoch') return { outcome: 'failed', reason: 'STALE_EPOCH' };
    if (reserved.outcome !== 'reserved' && reserved.outcome !== 'existing') return { outcome: 'failed', reason: 'RECOVERY_RESERVATION_FAILED' };
    if (reserved.recovery.state === 'AUTHORIZED') {
      return { outcome: 'duplicate', recoveryId: reserved.recovery.id, checkpointId: reserved.recovery.checkpointId };
    }

    let safety: CommandRoomTerminalRecoverySafetySnapshot;
    try {
      safety = await this.terminalRecoverySafetyResolver({
        projectKey: authority.projectKey,
        workspaceId: authority.workspaceId,
        durableTaskIds: checkpoint.durableTaskIds,
      });
    } catch {
      return { outcome: 'failed', reason: 'SAFETY_EVIDENCE_UNAVAILABLE' };
    }
    if (safety.ambiguous || safety.durableTasks.some((task) => task.state === 'missing')) {
      return { outcome: 'failed', reason: 'DURABLE_TASK_AMBIGUOUS' };
    }
    if (safety.workspaceLeaseActive) return { outcome: 'wait', reason: 'WORKSPACE_BUSY', checkpointId: checkpoint.id };
    if (safety.durableTasks.some((task) => task.state === 'running' || task.state === 'termination_unverified')) {
      return { outcome: 'wait', reason: 'DURABLE_TASK_RUNNING', checkpointId: checkpoint.id };
    }

    const claimed = await this.repository.claimTerminalRecovery({
      recoveryKey,
      bindingId: binding.id,
      connectionEpoch: binding.connectionEpoch,
      claimedAt: input.now,
    });
    if (claimed === null || claimed.state !== 'CLAIMED') {
      const current = await this.repository.getTerminalRecoveryByKey(recoveryKey);
      return current === null
        ? { outcome: 'failed', reason: 'RECOVERY_RESERVATION_FAILED' }
        : { outcome: 'duplicate', recoveryId: current.id, checkpointId: current.checkpointId };
    }

    const continuation = await this.createContinuationChallenge({
      bindingId: binding.id,
      extensionInstallationId: input.extensionInstallationId,
      now: input.now,
    });
    if (continuation === null || continuation.connectionEpoch !== binding.connectionEpoch) {
      return { outcome: 'failed', reason: 'RECOVERY_RESERVATION_FAILED' };
    }
    const authorized = await this.repository.authorizeTerminalRecovery({
      recoveryKey,
      bindingId: binding.id,
      connectionEpoch: binding.connectionEpoch,
      continuationBindingId: continuation.bindingId,
      authorizedAt: input.now,
    });
    if (authorized === null || authorized.state !== 'AUTHORIZED' || authorized.continuationBindingId !== continuation.bindingId) {
      return { outcome: 'failed', reason: 'RECOVERY_RESERVATION_FAILED' };
    }
    return { outcome: 'authorized', recoveryId: authorized.id, checkpointId: checkpoint.id, continuation };
  }

  public async syncSupervisorState(input: {
    readonly bindingId: string;
    readonly extensionInstallationId: string;
    readonly now: string;
  }): Promise<SyncCommandRoomSupervisorStateResponse> {
    const binding = await this.authenticateBinding(input.bindingId, input.extensionInstallationId);
    if (binding === null) return { outcome: 'unauthorized', supervisorSync: 'FAILED' };
    if (this.supervisorStateRepository === undefined || this.checkpointResolver === undefined) {
      return { outcome: 'unsupported', supervisorSync: 'FAILED' };
    }
    const authority = await this.repository.getAgentAuthority(binding.roomId, binding.agentId);
    if (
      authority === null
      || authority.role !== 'LEAD'
      || authority.projectKey === undefined
      || authority.workspaceId === undefined
      || authority.slotKey !== binding.slotKey
    ) {
      await this.markSupervisorSync(binding, 'FAILED', input.now);
      return { outcome: 'identity_mismatch', supervisorSync: 'FAILED' };
    }
    if (authority.connectionEpoch !== binding.connectionEpoch) {
      await this.markSupervisorSync(binding, 'FAILED', input.now);
      return { outcome: 'stale_epoch', supervisorSync: 'FAILED' };
    }
    if (binding.conversationRefFingerprint === undefined) {
      await this.markSupervisorSync(binding, 'FAILED', input.now);
      return { outcome: 'identity_mismatch', supervisorSync: 'FAILED' };
    }

    let checkpoint: CommandRoomSupervisorCheckpointSnapshot | null;
    try {
      checkpoint = await this.checkpointResolver({
        projectKey: authority.projectKey,
        workspaceId: authority.workspaceId,
      });
    } catch {
      await this.markSupervisorSync(binding, 'DEGRADED', input.now);
      return { outcome: 'degraded', supervisorSync: 'DEGRADED' };
    }
    if (checkpoint === null) {
      await this.markSupervisorSync(binding, 'DEGRADED', input.now);
      return { outcome: 'no_checkpoint', supervisorSync: 'DEGRADED' };
    }
    if (checkpoint.projectKey !== authority.projectKey || checkpoint.workspaceId !== authority.workspaceId) {
      await this.markSupervisorSync(binding, 'FAILED', input.now);
      return { outcome: 'identity_mismatch', supervisorSync: 'FAILED' };
    }
    const nextAction = checkpoint.nextAction?.trim();
    const safeToContinue = checkpoint.status === 'DONE'
      && checkpoint.safeToContinue
      && !checkpoint.needsUser
      && nextAction !== undefined
      && nextAction.length > 0;
    const published = await this.supervisorStateRepository.publish({
      roomId: binding.roomId,
      agentId: binding.agentId,
      slotKey: binding.slotKey,
      projectKey: authority.projectKey,
      workspaceId: authority.workspaceId,
      connectionEpoch: binding.connectionEpoch,
      bindingId: binding.id,
      bindingFingerprint: binding.conversationRefFingerprint,
      status: checkpoint.status,
      ...(nextAction === undefined || nextAction.length === 0 ? {} : { nextAction }),
      safeToContinue,
      needsUser: checkpoint.needsUser,
      checkpointId: checkpoint.id,
      durableTaskIds: checkpoint.durableTaskIds,
      publishedAt: input.now,
    });
    if (published.outcome === 'published') {
      return { outcome: 'published', supervisorSync: 'OK', state: published.state };
    }
    return {
      outcome: published.outcome === 'stale_epoch' ? 'stale_epoch' : 'identity_mismatch',
      supervisorSync: 'FAILED',
    };
  }

  private async markSupervisorSync(
    binding: CommandRoomBindingRecord,
    supervisorSync: Exclude<CommandRoomSupervisorSync, 'OK'>,
    updatedAt: string,
  ): Promise<void> {
    if (this.supervisorStateRepository === undefined) return;
    await this.supervisorStateRepository.markSyncStatus({
      roomId: binding.roomId,
      agentId: binding.agentId,
      bindingId: binding.id,
      connectionEpoch: binding.connectionEpoch,
      supervisorSync,
      updatedAt,
    });
  }

  public async queueWake(input: {
    readonly roomId: string;
    readonly agentId: string;
    readonly connectionEpoch: number;
    readonly eventKey: string;
    readonly reason: CommandRoomWakeReason;
    readonly taskId?: string;
    readonly now: string;
    readonly nextEligibleAt?: string;
  }): Promise<QueueWakeResponse> {
    if (!WAKE_ALLOWLIST.has(input.reason)) throw new Error(`Wake reason is not allowlisted: ${input.reason}`);
    if (input.eventKey.trim().length === 0 || input.eventKey.length > 256) throw new Error('Wake eventKey must be 1..256 characters.');
    const binding = await this.repository.getActiveBinding(input.roomId, input.agentId, input.connectionEpoch);
    if (binding === null) return { outcome: 'unpaired' };
    const policy = await this.repository.getWakePolicySnapshot({
      roomId: input.roomId,
      agentId: input.agentId,
      bindingId: binding.id,
      cooldownSince: subtractSeconds(input.now, this.wakeCooldownSeconds),
      hourlySince: subtractSeconds(input.now, 3_600),
    });
    if (policy.coalescedDelivery !== null) return { outcome: 'coalesced', delivery: policy.coalescedDelivery };
    if (input.reason !== 'USER_WAKE' && policy.unansweredSubmittedCount >= this.wakeCircuitBreakerThreshold) {
      return { outcome: 'circuit_open' };
    }
    if (policy.bindingWakeCount >= this.wakeMaxPerBindingHour) return { outcome: 'binding_budget_exhausted' };
    if (policy.roomWakeCount >= this.wakeMaxPerRoomHour) return { outcome: 'room_budget_exhausted' };
    const result = await this.repository.enqueueWake({
      id: this.randomId(),
      roomId: input.roomId,
      agentId: input.agentId,
      bindingId: binding.id,
      eventKey: input.eventKey,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      reason: input.reason,
      nextEligibleAt: input.nextEligibleAt ?? input.now,
      createdAt: input.now,
    });
    return result;
  }

  public async listRecoverableWakesForBinding(input: {
    readonly bindingId: string;
    readonly extensionInstallationId: string;
    readonly now: string;
    readonly limit?: number;
  }): Promise<readonly CommandRoomWakeDeliveryRecord[]> {
    const binding = await this.authenticateBinding(input.bindingId, input.extensionInstallationId);
    if (binding === null) return [];
    const limit = input.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Wake recovery limit must be an integer between 1 and 50.');
    return this.repository.listRecoverableWakesForBinding(binding.id, input.now, limit);
  }

  public async beginWakeAttempt(input: {
    readonly bindingId: string;
    readonly extensionInstallationId: string;
    readonly wakeId: string;
    readonly attemptedAt: string;
  }): Promise<CommandRoomWakeDeliveryRecord | null> {
    const binding = await this.requireActiveBinding(input.bindingId, input.extensionInstallationId);
    const wake = await this.requireOwnedWake(binding, input.wakeId);
    if (wake.nextEligibleAt !== undefined && wake.nextEligibleAt > input.attemptedAt) {
      throw new Error(`Wake ${wake.id} is still in cooldown.`);
    }
    return this.repository.beginWakeAttempt(wake.id, input.attemptedAt, addSeconds(input.attemptedAt, this.wakeCooldownSeconds));
  }

  public async markWakeDelivered(input: {
    readonly bindingId: string;
    readonly extensionInstallationId: string;
    readonly wakeId: string;
    readonly deliveredAt: string;
  }): Promise<CommandRoomWakeDeliveryRecord | null> {
    const binding = await this.requireActiveBinding(input.bindingId, input.extensionInstallationId);
    await this.requireOwnedWake(binding, input.wakeId);
    return this.repository.markWakeDelivered(input.wakeId, input.deliveredAt);
  }

  public async markWakeSubmitted(input: {
    readonly bindingId: string;
    readonly extensionInstallationId: string;
    readonly wakeId: string;
    readonly submittedAt: string;
  }): Promise<CommandRoomWakeDeliveryRecord | null> {
    const binding = await this.requireActiveBinding(input.bindingId, input.extensionInstallationId);
    await this.requireOwnedWake(binding, input.wakeId);
    return this.repository.markWakeSubmitted(input.wakeId, input.submittedAt);
  }

  public async markWakeAttemptFailed(input: {
    readonly bindingId: string;
    readonly extensionInstallationId: string;
    readonly wakeId: string;
    readonly occurredAt: string;
    readonly errorCode: string;
  }): Promise<CommandRoomWakeDeliveryRecord | null> {
    const binding = await this.requireActiveBinding(input.bindingId, input.extensionInstallationId);
    await this.requireOwnedWake(binding, input.wakeId);
    return this.repository.markWakeAttemptFailed(
      input.wakeId,
      input.occurredAt,
      addSeconds(input.occurredAt, this.wakeCooldownSeconds),
      input.errorCode,
    );
  }

  public async touchBinding(input: {
    readonly bindingId: string;
    readonly extensionInstallationId: string;
    readonly seenAt: string;
  }): Promise<CommandRoomBindingRecord | null> {
    const binding = await this.requireActiveBinding(input.bindingId, input.extensionInstallationId);
    return this.repository.touch(binding.id, input.seenAt);
  }

  private async requireActiveBinding(bindingId: string, extensionInstallationId: string): Promise<CommandRoomBindingRecord> {
    const binding = await this.authenticateBinding(bindingId, extensionInstallationId);
    if (binding === null) throw new Error('Command Room extension binding is not active.');
    return binding;
  }

  private async requireOwnedWake(binding: CommandRoomBindingRecord, wakeId: string): Promise<CommandRoomWakeDeliveryRecord> {
    const wake = await this.repository.getWake(wakeId);
    if (wake === null || wake.bindingId !== binding.id || wake.roomId !== binding.roomId || wake.agentId !== binding.agentId) {
      throw new Error('Command Room wake does not belong to the active binding.');
    }
    return wake;
  }

  public revoke(bindingId: string, revokedAt: string): Promise<CommandRoomBindingRecord | null> {
    return this.repository.revoke(bindingId, revokedAt);
  }

  public replace(bindingId: string, replacedAt: string): Promise<CommandRoomBindingRecord | null> {
    return this.repository.replace(bindingId, replacedAt);
  }
}

export function hashPairingChallengeForTest(challenge: string): string {
  return hashSecret(challenge);
}

function terminalRecoveryKey(binding: CommandRoomBindingRecord, terminalTurnFingerprint: string, checkpointId: string): string {
  return createHash('sha256')
    .update('nava-terminal-recovery-v2\0', 'utf8')
    .update(binding.id, 'utf8')
    .update('\0', 'utf8')
    .update(binding.conversationRefFingerprint ?? '', 'utf8')
    .update('\0', 'utf8')
    .update(terminalTurnFingerprint, 'utf8')
    .update('\0', 'utf8')
    .update(checkpointId, 'utf8')
    .update('\0', 'utf8')
    .update(String(binding.connectionEpoch), 'utf8')
    .digest('hex');
}

function hashSecret(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function addSeconds(value: string, seconds: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ISO timestamp: ${value}`);
  return new Date(timestamp + seconds * 1_000).toISOString();
}

function subtractSeconds(value: string, seconds: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ISO timestamp: ${value}`);
  return new Date(timestamp - seconds * 1_000).toISOString();
}

function requireIntegerOption(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function requireOpaqueId(value: string, field: string): void {
  if (value.trim().length < 8 || value.length > 512) throw new Error(`${field} must be an opaque identifier.`);
}
