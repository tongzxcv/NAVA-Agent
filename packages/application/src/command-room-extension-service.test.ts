import { describe, expect, it } from 'vitest';
import type {
  CommandRoomBindingRecord,
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
      randomId: () => 'binding-1',
      randomChallenge: () => RAW_CHALLENGE,
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
      randomId: () => 'unused',
      randomChallenge: () => RAW_CHALLENGE,
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

  it('queues only allowlisted wake reasons against the exact active epoch', async () => {
    const repository = new FakeExtensionRepository();
    const service = new CommandRoomExtensionService(repository, { randomId: () => 'wake-1' });

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
      randomId: () => 'binding-1',
      randomChallenge: () => RAW_CHALLENGE,
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
});

class FakeExtensionRepository implements CommandRoomExtensionRepositoryPort {
  public lastChallengeInput?: Parameters<CommandRoomExtensionRepositoryPort['createChallenge']>[0];
  public lastConfirmInput?: Parameters<CommandRoomExtensionRepositoryPort['confirmPairing']>[0];
  public lastWakeInput?: Parameters<CommandRoomExtensionRepositoryPort['enqueueWake']>[0];
  public activeBinding: CommandRoomBindingRecord | null = null;

  public async createChallenge(input: Parameters<CommandRoomExtensionRepositoryPort['createChallenge']>[0]): Promise<CommandRoomBindingRecord> {
    this.lastChallengeInput = input;
    return {
      id: input.id, roomId: input.roomId, agentId: input.agentId, slotKey: input.slotKey,
      provider: input.provider, connectionEpoch: input.connectionEpoch, state: 'CHALLENGED',
      challengeHash: input.challengeHash, challengeExpiresAt: input.challengeExpiresAt,
      createdAt: input.createdAt, updatedAt: input.createdAt,
    };
  }

  public async confirmPairing(input: Parameters<CommandRoomExtensionRepositoryPort['confirmPairing']>[0]) {
    this.lastConfirmInput = input;
    return { outcome: 'paired' as const, binding: this.activeBinding ?? pairedBinding() };
  }

  public async getActiveBinding(_roomId: string, _agentId: string, connectionEpoch: number): Promise<CommandRoomBindingRecord | null> {
    return this.activeBinding?.connectionEpoch === connectionEpoch ? this.activeBinding : null;
  }

  public async enqueueWake(input: Parameters<CommandRoomExtensionRepositoryPort['enqueueWake']>[0]) {
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

function pairedBinding(): CommandRoomBindingRecord {
  return {
    id: 'binding-1', roomId: 'room-1', agentId: 'lead-1', slotKey: 'LEAD-1', provider: 'CHATGPT',
    extensionInstallationId: 'extension-installation-random-1',
    encryptedConversationRef: 'ciphertext:v1:conversation-ref', conversationRefFingerprint: 'hmac:conversation-ref-1',
    connectionEpoch: 7, state: 'PAIRED', pairedAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW,
  };
}
