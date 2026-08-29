import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  CommandRoomBindingRecord,
  CommandRoomProvider,
  CommandRoomWakeDeliveryRecord,
  CommandRoomWakeReason,
} from '@lnwjud/domain';

const DEFAULT_PAIRING_TTL_SECONDS = 300;
const MIN_PAIRING_TTL_SECONDS = 30;
const MAX_PAIRING_TTL_SECONDS = 600;
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

export interface CommandRoomExtensionServiceOptions {
  readonly randomId?: () => string;
  readonly randomChallenge?: () => string;
}

export interface PairingChallengeResponse {
  readonly bindingId: string;
  readonly challenge: string;
  readonly expiresAt: string;
  readonly connectionEpoch: number;
}

export type QueueWakeResponse =
  | { readonly outcome: 'queued'; readonly duplicate: boolean; readonly delivery: CommandRoomWakeDeliveryRecord }
  | { readonly outcome: 'unpaired' | 'binding_not_active' | 'stale_epoch' | 'not_found' };

export class CommandRoomExtensionService {
  private readonly randomId: () => string;
  private readonly randomChallenge: () => string;

  public constructor(
    private readonly repository: CommandRoomExtensionRepositoryPort,
    options: CommandRoomExtensionServiceOptions = {},
  ) {
    this.randomId = options.randomId ?? randomUUID;
    this.randomChallenge = options.randomChallenge ?? (() => randomBytes(32).toString('base64url'));
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

function hashSecret(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function addSeconds(value: string, seconds: number): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ISO timestamp: ${value}`);
  return new Date(timestamp + seconds * 1_000).toISOString();
}

function requireOpaqueId(value: string, field: string): void {
  if (value.trim().length < 8 || value.length > 512) throw new Error(`${field} must be an opaque identifier.`);
}
