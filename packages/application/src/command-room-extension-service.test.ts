import { describe, expect, it } from 'vitest';
import type {
  CommandRoomBindingRecord,
  CommandRoomSupervisorStateRecord,
  CommandRoomWakeDeliveryRecord,
  CommandRoomWakeReason,
} from '@lnwjud/domain';
import {
  CommandRoomExtensionService,
  hashPairingChallengeForTest,
  type CommandRoomExtensionRepositoryPort,
} from './command-room-extension-service.js';

const NOW = '2026-08-30T00:00:00.000Z';
const RAW_CHALLENGE = 'pairing-secret-that-is-long-enough-000000000001';

describe('CommandRoomExtensionService', () => {
  it('returns a one-time raw challenge while persisting only its hash', async () => {
    const repository = new FakeExtensionRepository();
    const service = new CommandRoomExtensionService(repository, {
      randomId: (): string => 'binding-1',
      randomChallenge: (): string => RAW_CHALLENGE,
    });

    const response = await service.createPairingChallenge({
      roomId: 'room-1',
      agentId: 'lead-1',
      slotKey: 'LEAD-1',
      provider: 'CHATGPT',
      connectionEpoch: 7,
      now: NOW,
    });

    expect(response).toEqual({
      bindingId: 'binding-1',
      challenge: RAW_CHALLENGE,
      expiresAt: '2026-08-30T00:05:00.000Z',
      connectionEpoch: 7,
    });
    expect(repository.lastChallengeInput).toMatchObject({
      id: 'binding-1',
      roomId: 'room-1',
      agentId: 'lead-1',
      connectionEpoch: 7,
      challengeHash: hashPairingChallengeForTest(RAW_CHALLENGE),
    });
    expect(JSON.stringify(repository.lastChallengeInput)).not.toContain(RAW_CHALLENGE);
  });

  it('hashes the confirmation challenge and never forwards the raw token to storage', async () => {
    const repository = new FakeExtensionRepository();
    repository.activeBinding = pairedBinding();
    const service = new CommandRoomExtensionService(repository, {
      randomId: (): string => 'unused',
      randomChallenge: (): string => RAW_CHALLENGE,
    });

    const result = await service.confirmPairing({
      bindingId: 'binding-1',
      roomId: 'room-1',
      agentId: 'lead-1',
      connectionEpoch: 7,
      challenge: RAW_CHALLENGE,
      extensionInstallationId: 'extension-installation-random-1',
      encryptedConversationRef: 'ciphertext:v1:conversation-ref',
      conversationRefFingerprint: 'hmac:conversation-ref-1',
      confirmedAt: '2026-08-30T00:00:10.000Z',
    });

    expect(result.outcome).toBe('paired');
    expect(repository.lastConfirmInput?.challengeHash).toBe(hashPairingChallengeForTest(RAW_CHALLENGE));
    expect(JSON.stringify(repository.lastConfirmInput)).not.toContain(RAW_CHALLENGE);
  });

  it('creates continuation pairing authority only from the authenticated active binding and keeps the same epoch', async () => {
    const repository = new FakeExtensionRepository();
    repository.activeBinding = pairedBinding();
    const service = new CommandRoomExtensionService(repository, {
      randomId: (): string => 'binding-continuation',
      randomChallenge: (): string => RAW_CHALLENGE,
    });

    const continuation = await service.createContinuationChallenge({
      bindingId: 'binding-1',
      extensionInstallationId: 'extension-installation-random-1',
      now: NOW,
    });
    expect(continuation).toEqual({
      bindingId: 'binding-continuation', challenge: RAW_CHALLENGE,
      expiresAt: '2026-08-30T00:05:00.000Z', connectionEpoch: 7,
    });
    expect(repository.lastChallengeInput).toMatchObject({
      id: 'binding-continuation', roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1',
      provider: 'CHATGPT', connectionEpoch: 7,
    });

    await expect(service.createContinuationChallenge({
      bindingId: 'binding-1', extensionInstallationId: 'wrong-extension-installation', now: NOW,
    })).resolves.toBeNull();
  });

  it('publishes structured supervisor state from a paired binding without agentSessionId or epoch change', async () => {
    const repository = new FakeExtensionRepository();
    repository.activeBinding = pairedBinding();
    const supervisor = new FakeSupervisorStateRepository();
    const service = new CommandRoomExtensionService(repository, {
      supervisorStateRepository: supervisor,
      checkpointResolver: async () => ({
        id: 'checkpoint-1',
        projectKey: 'beelzebub',
        workspaceId: 'workspace-beelzebub',
        status: 'DONE',
        nextAction: 'Continue verified phase',
        safeToContinue: true,
        needsUser: false,
        durableTaskIds: ['durable-1'],
      }),
    });

    const result = await service.syncSupervisorState({
      bindingId: 'binding-1',
      extensionInstallationId: 'extension-installation-random-1',
      now: NOW,
    });
    expect(result).toMatchObject({
      outcome: 'published',
      supervisorSync: 'OK',
      state: {
        slotKey: 'LEAD-1',
        projectKey: 'beelzebub',
        workspaceId: 'workspace-beelzebub',
        connectionEpoch: 7,
        checkpointId: 'checkpoint-1',
        status: 'DONE',
        safeToContinue: true,
      },
    });
    expect(supervisor.lastPublishInput).toMatchObject({
      bindingId: 'binding-1',
      bindingFingerprint: 'hmac:conversation-ref-1',
      connectionEpoch: 7,
      checkpointId: 'checkpoint-1',
    });
    expect(supervisor.lastPublishInput).not.toHaveProperty('agentSessionId');
    expect(CommandRoomExtensionService.prototype.syncSupervisorState.toString()).not.toMatch(/command_room_join|rebind|takeover/);
    expect(repository.agentAuthority.connectionEpoch).toBe(7);
  });

  it('fails closed for wrong slot, stale epoch, replaced binding, and checkpoint ownership mismatch', async () => {
    const repository = new FakeExtensionRepository();
    repository.activeBinding = pairedBinding();
    const supervisor = new FakeSupervisorStateRepository();
    const checkpointResolver = async () => ({
      id: 'checkpoint-1',
      projectKey: 'beelzebub',
      workspaceId: 'workspace-beelzebub',
      status: 'WORKING' as const,
      safeToContinue: false,
      needsUser: false,
      durableTaskIds: [] as string[],
    });
    const service = new CommandRoomExtensionService(repository, { supervisorStateRepository: supervisor, checkpointResolver });

    repository.agentAuthority = { ...repository.agentAuthority, slotKey: 'LEAD-2' };
    await expect(service.syncSupervisorState({
      bindingId: 'binding-1', extensionInstallationId: 'extension-installation-random-1', now: NOW,
    })).resolves.toEqual({ outcome: 'identity_mismatch', supervisorSync: 'FAILED' });

    repository.agentAuthority = { ...repository.agentAuthority, slotKey: 'LEAD-1', connectionEpoch: 8 };
    await expect(service.syncSupervisorState({
      bindingId: 'binding-1', extensionInstallationId: 'extension-installation-random-1', now: NOW,
    })).resolves.toEqual({ outcome: 'stale_epoch', supervisorSync: 'FAILED' });

    repository.agentAuthority = { ...repository.agentAuthority, connectionEpoch: 7 };
    repository.activeBinding = { ...pairedBinding(), state: 'REPLACED', replacedAt: NOW };
    await expect(service.syncSupervisorState({
      bindingId: 'binding-1', extensionInstallationId: 'extension-installation-random-1', now: NOW,
    })).resolves.toEqual({ outcome: 'unauthorized', supervisorSync: 'FAILED' });

    repository.activeBinding = { ...pairedBinding(), state: 'REVOKED', revokedAt: NOW };
    await expect(service.syncSupervisorState({
      bindingId: 'binding-1', extensionInstallationId: 'extension-installation-random-1', now: NOW,
    })).resolves.toEqual({ outcome: 'unauthorized', supervisorSync: 'FAILED' });

    repository.activeBinding = pairedBinding();
    const mismatch = new CommandRoomExtensionService(repository, {
      supervisorStateRepository: supervisor,
      checkpointResolver: async () => ({
        id: 'checkpoint-wrong',
        projectKey: 'beelzebub',
        workspaceId: 'workspace-other',
        status: 'DONE',
        nextAction: 'Wrong workspace',
        safeToContinue: true,
        needsUser: false,
        durableTaskIds: [],
      }),
    });
    await expect(mismatch.syncSupervisorState({
      bindingId: 'binding-1', extensionInstallationId: 'extension-installation-random-1', now: NOW,
    })).resolves.toEqual({ outcome: 'identity_mismatch', supervisorSync: 'FAILED' });
  });

  it('degrades supervisor sync without blocking core LEAD wake/work plumbing', async () => {
    const repository = new FakeExtensionRepository();
    repository.activeBinding = pairedBinding();
    const supervisor = new FakeSupervisorStateRepository();
    const service = new CommandRoomExtensionService(repository, {
      supervisorStateRepository: supervisor,
      checkpointResolver: async () => { throw new Error('continuity store unavailable'); },
      randomId: (): string => 'wake-after-sync-failure',
    });

    await expect(service.syncSupervisorState({
      bindingId: 'binding-1',
      extensionInstallationId: 'extension-installation-random-1',
      now: NOW,
    })).resolves.toEqual({ outcome: 'degraded', supervisorSync: 'DEGRADED' });
    expect(supervisor.lastSyncStatus).toMatchObject({ supervisorSync: 'DEGRADED' });

    await expect(service.queueWake({
      roomId: 'room-1',
      agentId: 'lead-1',
      connectionEpoch: 7,
      eventKey: 'USER_WAKE:core-still-available',
      reason: 'USER_WAKE',
      now: NOW,
    })).resolves.toMatchObject({ outcome: 'queued', delivery: { id: 'wake-after-sync-failure' } });
  });

  it('queues only allowlisted wake reasons against the exact active epoch', async () => {
    const repository = new FakeExtensionRepository();
    const service = new CommandRoomExtensionService(repository, { randomId: (): string => 'wake-1' });

    expect(await service.queueWake({
      roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 7,
      eventKey: 'TASK_ASSIGNED:task-1', taskId: 'task-1', reason: 'TASK_ASSIGNED', now: NOW,
    })).toEqual({ outcome: 'unpaired' });

    repository.activeBinding = pairedBinding();
    const queued = await service.queueWake({
      roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 7,
      eventKey: 'TASK_ASSIGNED:task-1', taskId: 'task-1', reason: 'TASK_ASSIGNED', now: NOW,
    });
    expect(queued).toMatchObject({ outcome: 'queued', duplicate: false, delivery: { id: 'wake-1' } });
    expect(repository.lastWakeInput).toMatchObject({
      bindingId: 'binding-1', eventKey: 'TASK_ASSIGNED:task-1', reason: 'TASK_ASSIGNED',
    });

    await expect(service.queueWake({
      roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 7,
      eventKey: 'HEARTBEAT:lead-1', reason: 'HEARTBEAT' as CommandRoomWakeReason, now: NOW,
    })).rejects.toThrow('Wake reason is not allowlisted');
  });

  it('bounds pairing TTL and rejects weak identity material before storage', async () => {
    const repository = new FakeExtensionRepository();
    const service = new CommandRoomExtensionService(repository, {
      randomId: (): string => 'binding-1',
      randomChallenge: (): string => RAW_CHALLENGE,
    });

    await expect(service.createPairingChallenge({
      roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1', provider: 'CHATGPT',
      connectionEpoch: 7, now: NOW, ttlSeconds: 10,
    })).rejects.toThrow('Pairing TTL must be an integer between 30 and 600 seconds');

    await expect(service.confirmPairing({
      bindingId: 'binding-1', roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 7,
      challenge: RAW_CHALLENGE, extensionInstallationId: 'short',
      encryptedConversationRef: 'ciphertext:v1:conversation-ref',
      conversationRefFingerprint: 'hmac:conversation-ref-1', confirmedAt: NOW,
    })).rejects.toThrow('extensionInstallationId must be an opaque identifier');
  });

  it('coalesces within cooldown and enforces persistent wake budgets plus the circuit breaker', async () => {
    const repository = new FakeExtensionRepository();
    repository.activeBinding = pairedBinding();
    const service = new CommandRoomExtensionService(repository, {
      randomId: (): string => 'wake-policy',
      wakeCooldownSeconds: 60,
      wakeMaxPerBindingHour: 2,
      wakeMaxPerRoomHour: 4,
      wakeCircuitBreakerThreshold: 2,
    });
    repository.wakePolicySnapshot.coalescedDelivery = wakeRecord('wake-existing');
    await expect(service.queueWake({
      roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 7,
      eventKey: 'HANDOFF_READY:2', reason: 'HANDOFF_READY', now: NOW,
    })).resolves.toMatchObject({ outcome: 'coalesced', delivery: { id: 'wake-existing' } });
    expect(repository.lastWakeInput).toBeUndefined();

    repository.wakePolicySnapshot.coalescedDelivery = null;
    repository.wakePolicySnapshot.bindingWakeCount = 2;
    await expect(service.queueWake({
      roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 7,
      eventKey: 'TASK_ASSIGNED:budget', reason: 'TASK_ASSIGNED', now: NOW,
    })).resolves.toEqual({ outcome: 'binding_budget_exhausted' });

    repository.wakePolicySnapshot.bindingWakeCount = 0;
    repository.wakePolicySnapshot.roomWakeCount = 4;
    await expect(service.queueWake({
      roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 7,
      eventKey: 'TASK_ASSIGNED:room-budget', reason: 'TASK_ASSIGNED', now: NOW,
    })).resolves.toEqual({ outcome: 'room_budget_exhausted' });

    repository.wakePolicySnapshot.roomWakeCount = 0;
    repository.wakePolicySnapshot.unansweredSubmittedCount = 2;
    await expect(service.queueWake({
      roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 7,
      eventKey: 'TASK_ASSIGNED:circuit', reason: 'TASK_ASSIGNED', now: NOW,
    })).resolves.toEqual({ outcome: 'circuit_open' });
    await expect(service.queueWake({
      roomId: 'room-1', agentId: 'lead-1', connectionEpoch: 7,
      eventKey: 'USER_WAKE:manual-override', reason: 'USER_WAKE', now: NOW,
    })).resolves.toMatchObject({ outcome: 'queued' });
  });
});

class FakeExtensionRepository implements CommandRoomExtensionRepositoryPort {
  public lastChallengeInput?: Parameters<CommandRoomExtensionRepositoryPort['createChallenge']>[0];
  public lastConfirmInput?: Parameters<CommandRoomExtensionRepositoryPort['confirmPairing']>[0];
  public lastWakeInput?: Parameters<CommandRoomExtensionRepositoryPort['enqueueWake']>[0];
  public activeBinding: CommandRoomBindingRecord | null = null;
  public agentAuthority = {
    roomId: 'room-1',
    agentId: 'lead-1',
    slotKey: 'LEAD-1',
    role: 'LEAD' as const,
    projectKey: 'beelzebub',
    workspaceId: 'workspace-beelzebub',
    connectionEpoch: 7,
  };
  public wakePolicySnapshot: {
    coalescedDelivery: CommandRoomWakeDeliveryRecord | null;
    bindingWakeCount: number;
    roomWakeCount: number;
    unansweredSubmittedCount: number;
  } = { coalescedDelivery: null, bindingWakeCount: 0, roomWakeCount: 0, unansweredSubmittedCount: 0 };

  public async createChallenge(input: Parameters<CommandRoomExtensionRepositoryPort['createChallenge']>[0]): Promise<CommandRoomBindingRecord> {
    this.lastChallengeInput = input;
    return {
      id: input.id, roomId: input.roomId, agentId: input.agentId, slotKey: input.slotKey,
      provider: input.provider, connectionEpoch: input.connectionEpoch, state: 'CHALLENGED',
      challengeHash: input.challengeHash, challengeExpiresAt: input.challengeExpiresAt,
      createdAt: input.createdAt, updatedAt: input.createdAt,
    };
  }

  public async confirmPairing(input: Parameters<CommandRoomExtensionRepositoryPort['confirmPairing']>[0]): ReturnType<CommandRoomExtensionRepositoryPort['confirmPairing']> {
    this.lastConfirmInput = input;
    return { outcome: 'paired' as const, binding: this.activeBinding ?? pairedBinding() };
  }

  public async getActiveBinding(_roomId: string, _agentId: string, connectionEpoch: number): Promise<CommandRoomBindingRecord | null> {
    return this.activeBinding?.connectionEpoch === connectionEpoch ? this.activeBinding : null;
  }

  public async getBinding(bindingId: string): Promise<CommandRoomBindingRecord | null> {
    return this.activeBinding?.id === bindingId ? this.activeBinding : null;
  }

  public async getAgentAuthority(roomId: string, agentId: string): Promise<typeof this.agentAuthority | null> {
    return this.agentAuthority.roomId === roomId && this.agentAuthority.agentId === agentId ? this.agentAuthority : null;
  }

  public async getWake(_id: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    void _id;
    return null;
  }

  public async listRecoverableWakes(_now: string, _limit?: number): Promise<readonly CommandRoomWakeDeliveryRecord[]> {
    void _now;
    void _limit;
    return [];
  }

  public async listRecoverableWakesForBinding(_bindingId: string, _now: string, _limit?: number): Promise<readonly CommandRoomWakeDeliveryRecord[]> {
    void _bindingId;
    void _now;
    void _limit;
    return [];
  }

  public async beginWakeAttempt(_id: string, _attemptedAt: string, _nextEligibleAt: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    void _id;
    void _attemptedAt;
    void _nextEligibleAt;
    return null;
  }

  public async markWakeDelivered(_id: string, _deliveredAt: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    void _id;
    void _deliveredAt;
    return null;
  }

  public async markWakeSubmitted(_id: string, _submittedAt: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    void _id;
    void _submittedAt;
    return null;
  }

  public async markWakeAttemptFailed(_id: string, _occurredAt: string, _nextEligibleAt: string, _errorCode: string): Promise<CommandRoomWakeDeliveryRecord | null> {
    void _id;
    void _occurredAt;
    void _nextEligibleAt;
    void _errorCode;
    return null;
  }

  public async touch(bindingId: string, seenAt: string): Promise<CommandRoomBindingRecord | null> {
    if (this.activeBinding?.id !== bindingId) return null;
    this.activeBinding = { ...this.activeBinding, lastSeenAt: seenAt, updatedAt: seenAt };
    return this.activeBinding;
  }

  public async getWakePolicySnapshot(): ReturnType<CommandRoomExtensionRepositoryPort['getWakePolicySnapshot']> {
    return this.wakePolicySnapshot;
  }

  public async enqueueWake(input: Parameters<CommandRoomExtensionRepositoryPort['enqueueWake']>[0]): ReturnType<CommandRoomExtensionRepositoryPort['enqueueWake']> {
    this.lastWakeInput = input;
    const delivery: CommandRoomWakeDeliveryRecord = {
      id: input.id, roomId: input.roomId, agentId: input.agentId, bindingId: input.bindingId,
      eventKey: input.eventKey, ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      reason: input.reason, state: 'QUEUED', attemptCount: 0, nextEligibleAt: input.nextEligibleAt,
      createdAt: input.createdAt, updatedAt: input.createdAt,
    };
    return { outcome: 'queued' as const, duplicate: false, delivery };
  }

  public async revoke(bindingId: string, revokedAt: string): Promise<CommandRoomBindingRecord | null> {
    if (this.activeBinding?.id !== bindingId) return null;
    this.activeBinding = { ...this.activeBinding, state: 'REVOKED', revokedAt, updatedAt: revokedAt };
    return this.activeBinding;
  }

  public async replace(bindingId: string, replacedAt: string): Promise<CommandRoomBindingRecord | null> {
    if (this.activeBinding?.id !== bindingId) return null;
    this.activeBinding = { ...this.activeBinding, state: 'REPLACED', replacedAt, updatedAt: replacedAt };
    return this.activeBinding;
  }
}

class FakeSupervisorStateRepository {
  public lastPublishInput?: Record<string, unknown>;
  public lastSyncStatus?: Record<string, unknown>;

  public async publish(input: Record<string, unknown>): Promise<{ readonly outcome: 'published'; readonly state: CommandRoomSupervisorStateRecord }> {
    this.lastPublishInput = input;
    const state: CommandRoomSupervisorStateRecord = {
      roomId: String(input.roomId),
      agentId: String(input.agentId),
      slotKey: String(input.slotKey),
      projectKey: String(input.projectKey),
      workspaceId: String(input.workspaceId),
      connectionEpoch: Number(input.connectionEpoch),
      bindingId: String(input.bindingId),
      bindingFingerprint: String(input.bindingFingerprint),
      status: input.status as CommandRoomSupervisorStateRecord['status'],
      ...(typeof input.nextAction === 'string' ? { nextAction: input.nextAction } : {}),
      safeToContinue: input.safeToContinue === true,
      needsUser: input.needsUser === true,
      checkpointId: String(input.checkpointId),
      durableTaskIds: Array.isArray(input.durableTaskIds) ? input.durableTaskIds as string[] : [],
      supervisorSync: 'OK',
      createdAt: String(input.publishedAt),
      updatedAt: String(input.publishedAt),
    };
    return { outcome: 'published', state };
  }

  public async markSyncStatus(input: Record<string, unknown>): Promise<CommandRoomSupervisorStateRecord | null> {
    this.lastSyncStatus = input;
    return null;
  }
}

function pairedBinding(): CommandRoomBindingRecord {
  return {
    id: 'binding-1', roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1', provider: 'CHATGPT',
    extensionInstallationId: 'extension-installation-random-1',
    encryptedConversationRef: 'ciphertext:v1:conversation-ref', conversationRefFingerprint: 'hmac:conversation-ref-1',
    connectionEpoch: 7, state: 'PAIRED', pairedAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW,
  };
}

function wakeRecord(id: string): CommandRoomWakeDeliveryRecord {
  return {
    id, roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-1', eventKey: 'TASK_ASSIGNED:existing',
    reason: 'TASK_ASSIGNED', state: 'SUBMITTED', attemptCount: 1,
    nextEligibleAt: NOW, deliveredAt: NOW, submittedAt: NOW, createdAt: NOW, updatedAt: NOW,
  };
}
