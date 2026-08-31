import { afterEach, describe, expect, it } from 'vitest';
import type { CommandRoomBindingRecord, CommandRoomWakeDeliveryRecord } from '@lnwjud/domain';
import {
  startCommandRoomExtensionBridge,
  type CommandRoomExtensionBridgeHandle,
  type CommandRoomExtensionBridgeService,
} from '../src/main/command-room-extension-bridge.js';

const ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_ORIGIN = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const RAW_CHALLENGE = 'pairing-secret-that-is-long-enough-000000000001';
const INSTALLATION_ID = 'extension-installation-random-1';
const AUTH_KEY = Buffer.alloc(32, 7);
const NOW = '2026-08-30T01:00:00.000Z';
const CONVERSATION_REF = 'chatgpt:https://chatgpt.com/c/conversation-1';
const handles: CommandRoomExtensionBridgeHandle[] = [];

describe('Command Room Extension Bridge', () => {
  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
  });

  it('pairs through an explicit extension origin and returns only a derived binding token', async () => {
    const service = new FakeBridgeService();
    const handle = await startBridge(service);

    const denied = await fetch(`${handle.url}/v1/health`, { headers: { Origin: OTHER_ORIGIN } });
    expect(denied.status).toBe(403);

    const paired = await pair(handle);
    expect(paired.response.status).toBe(200);
    expect(paired.body).toMatchObject({
      ok: true,
      outcome: 'paired',
      binding: { id: 'binding-1', slotKey: 'LEAD-1', connectionEpoch: 7, state: 'PAIRED' },
    });
    expect(typeof paired.body.authToken).toBe('string');
    expect(String(paired.body.authToken)).toMatch(/^nava-v1\./);
    const serialized = JSON.stringify(paired.body);
    expect(serialized).not.toContain(RAW_CHALLENGE);
    expect(serialized).not.toContain(INSTALLATION_ID);
    expect(serialized).not.toContain(CONVERSATION_REF);
    expect(service.lastPairInput?.encryptedConversationRef).toMatch(/^aes256gcm:v1:/);
    expect(service.lastPairInput?.encryptedConversationRef).not.toContain(CONVERSATION_REF);
    expect(service.lastPairInput?.conversationRefFingerprint).toMatch(/^hmac-sha256:v1:/);

    const status = await fetch(`${handle.url}/v1/bindings/binding-1/status`, {
      headers: authHeaders(String(paired.body.authToken)),
    });
    expect(status.status).toBe(200);
    const statusBody = await jsonObject(status);
    expect(statusBody).toMatchObject({ ok: true, binding: { id: 'binding-1', state: 'PAIRED' } });
    expect(JSON.stringify(statusBody)).not.toContain(INSTALLATION_ID);

    const genericProxy = await fetch(`${handle.url}/mcp`, { headers: authHeaders(String(paired.body.authToken)) });
    expect(genericProxy.status).toBe(404);
  });

  it('allows Chrome MV3 originless authenticated reads while keeping other routes origin-bound', async () => {
    const service = new FakeBridgeService();
    const handle = await startBridge(service);
    const paired = await pair(handle);
    const token = String(paired.body.authToken);
    service.wake = {
      id: 'wake-originless',
      roomId: 'room-1',
      agentId: 'lead-1',
      bindingId: 'binding-1',
      eventKey: 'USER_WAKE:originless',
      reason: 'USER_WAKE',
      state: 'QUEUED',
      attemptCount: 0,
      nextEligibleAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    };

    const originlessStatus = await fetch(`${handle.url}/v1/bindings/binding-1/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(originlessStatus.status).toBe(200);

    const originlessWakes = await fetch(`${handle.url}/v1/bindings/binding-1/wakes?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(originlessWakes.status).toBe(200);
    expect(await jsonObject(originlessWakes)).toMatchObject({
      ok: true,
      wakes: [{ id: 'wake-originless', state: 'QUEUED' }],
    });

    const originlessHealth = await fetch(`${handle.url}/v1/health`);
    expect(originlessHealth.status).toBe(403);
    expect(await jsonObject(originlessHealth)).toEqual({ ok: false, code: 'ORIGIN_DENIED' });

    const wrongOriginRead = await fetch(`${handle.url}/v1/bindings/binding-1/status`, {
      headers: { Origin: OTHER_ORIGIN, Authorization: `Bearer ${token}` },
    });
    expect(wrongOriginRead.status).toBe(403);

    const originlessTouch = await fetch(`${handle.url}/v1/bindings/binding-1/touch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(originlessTouch.status).toBe(403);
  });

  it('keeps wake delivery bounded to the authenticated binding and invalidates auth after revoke', async () => {
    const service = new FakeBridgeService();
    const handle = await startBridge(service);
    const paired = await pair(handle);
    const token = String(paired.body.authToken);
    service.wake = {
      id: 'wake-1',
      roomId: 'room-1',
      agentId: 'lead-1',
      bindingId: 'binding-1',
      eventKey: 'TASK_ASSIGNED:task-1',
      taskId: 'task-1',
      reason: 'TASK_ASSIGNED',
      state: 'QUEUED',
      attemptCount: 0,
      nextEligibleAt: '2026-08-30T00:59:00.000Z',
      createdAt: '2026-08-30T00:59:00.000Z',
      updatedAt: '2026-08-30T00:59:00.000Z',
    };

    const wakes = await fetch(`${handle.url}/v1/bindings/binding-1/wakes?limit=5`, { headers: authHeaders(token) });
    expect(wakes.status).toBe(200);
    expect(await jsonObject(wakes)).toMatchObject({
      ok: true,
      wakes: [{ id: 'wake-1', state: 'QUEUED', attemptCount: 0, reason: 'TASK_ASSIGNED' }],
    });

    const attempted = await wakeTransition(handle, token, 'wake-1', 'attempt');
    expect(attempted).toMatchObject({ ok: true, wake: { id: 'wake-1', state: 'ATTEMPTING', attemptCount: 1 } });
    const delivered = await wakeTransition(handle, token, 'wake-1', 'delivered');
    expect(delivered).toMatchObject({ ok: true, wake: { id: 'wake-1', state: 'DELIVERED', attemptCount: 1 } });
    const submitted = await wakeTransition(handle, token, 'wake-1', 'submitted');
    expect(submitted).toMatchObject({ ok: true, wake: { id: 'wake-1', state: 'SUBMITTED', attemptCount: 1 } });

    const revoked = await fetch(`${handle.url}/v1/bindings/binding-1/revoke`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    expect(revoked.status).toBe(200);
    expect(await jsonObject(revoked)).toMatchObject({ ok: true, binding: { id: 'binding-1', state: 'REVOKED' } });

    const stale = await fetch(`${handle.url}/v1/bindings/binding-1/status`, { headers: authHeaders(token) });
    expect(stale.status).toBe(401);
  });

  it('reports bounded wake failures and dead-letters the third failed attempt', async () => {
    const service = new FakeBridgeService();
    const handle = await startBridge(service);
    const paired = await pair(handle);
    const token = String(paired.body.authToken);
    service.wake = {
      id: 'wake-retry', roomId: 'room-1', agentId: 'lead-1', bindingId: 'binding-1',
      eventKey: 'TASK_ASSIGNED:retry', reason: 'TASK_ASSIGNED', state: 'QUEUED', attemptCount: 0,
      nextEligibleAt: NOW, createdAt: NOW, updatedAt: NOW,
    };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await wakeTransition(handle, token, 'wake-retry', 'attempt');
      await wakeTransition(handle, token, 'wake-retry', 'delivered');
      const failed = await wakeFailed(handle, token, 'wake-retry', attempt === 1 ? 'DOM_MISMATCH' : 'SUBMIT_FAILED');
      expect(failed).toMatchObject({
        ok: true,
        wake: {
          id: 'wake-retry',
          state: attempt === 3 ? 'DEAD_LETTER' : 'QUEUED',
          attemptCount: attempt,
        },
      });
    }
  });

  it('fails closed while the feature flag is disabled', async () => {
    const service = new FakeBridgeService();
    const handle = await startCommandRoomExtensionBridge({
      service,
      authKey: AUTH_KEY,
      enabled: () => false,
      allowedOrigins: () => [ORIGIN],
      port: 0,
      now: () => new Date(NOW),
    });
    handles.push(handle);

    const response = await fetch(`${handle.url}/v1/health`, { headers: { Origin: ORIGIN } });
    expect(response.status).toBe(503);
    expect(await jsonObject(response)).toEqual({ ok: false, code: 'BRIDGE_DISABLED' });
  });
});

async function startBridge(service: CommandRoomExtensionBridgeService): Promise<CommandRoomExtensionBridgeHandle> {
  const handle = await startCommandRoomExtensionBridge({
    service,
    authKey: AUTH_KEY,
    enabled: () => true,
    allowedOrigins: () => [ORIGIN],
    port: 0,
    now: () => new Date(NOW),
  });
  handles.push(handle);
  return handle;
}

async function pair(handle: CommandRoomExtensionBridgeHandle): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${handle.url}/v1/pair/confirm`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bindingId: 'binding-1',
      challenge: RAW_CHALLENGE,
      extensionInstallationId: INSTALLATION_ID,
      conversationRef: CONVERSATION_REF,
    }),
  });
  return { response, body: await jsonObject(response) };
}

async function wakeTransition(
  handle: CommandRoomExtensionBridgeHandle,
  token: string,
  wakeId: string,
  transition: 'attempt' | 'delivered' | 'submitted',
): Promise<Record<string, unknown>> {
  const response = await fetch(`${handle.url}/v1/wakes/${wakeId}/${transition}`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ bindingId: 'binding-1' }),
  });
  expect(response.status).toBe(200);
  return jsonObject(response);
}

async function wakeFailed(
  handle: CommandRoomExtensionBridgeHandle,
  token: string,
  wakeId: string,
  errorCode: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${handle.url}/v1/wakes/${wakeId}/failed`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ bindingId: 'binding-1', errorCode }),
  });
  expect(response.status).toBe(200);
  return jsonObject(response);
}

function authHeaders(token: string, json = false): Record<string, string> {
  return {
    Origin: ORIGIN,
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected JSON object');
  return value as Record<string, unknown>;
}

class FakeBridgeService implements CommandRoomExtensionBridgeService {
  public binding: CommandRoomBindingRecord = {
    id: 'binding-1',
    roomId: 'room-1',
    agentId: 'lead-1',
    slotKey: 'LEAD-1',
    provider: 'CHATGPT',
    connectionEpoch: 7,
    state: 'CHALLENGED',
    challengeHash: 'sha256:stored-only',
    challengeExpiresAt: '2026-08-30T01:05:00.000Z',
    createdAt: '2026-08-30T00:59:00.000Z',
    updatedAt: '2026-08-30T00:59:00.000Z',
  };
  public wake: CommandRoomWakeDeliveryRecord | null = null;
  public lastPairInput?: Parameters<CommandRoomExtensionBridgeService['confirmPairingByBinding']>[0];

  public async confirmPairingByBinding(input: Parameters<CommandRoomExtensionBridgeService['confirmPairingByBinding']>[0]): ReturnType<CommandRoomExtensionBridgeService['confirmPairingByBinding']> {
    this.lastPairInput = input;
    if (input.bindingId !== this.binding.id) return { outcome: 'not_found' };
    if (input.challenge !== RAW_CHALLENGE) return { outcome: 'challenge_mismatch' };
    if (this.binding.state !== 'CHALLENGED') return { outcome: 'invalid_state' };
    this.binding = {
      id: this.binding.id,
      roomId: this.binding.roomId,
      agentId: this.binding.agentId,
      slotKey: this.binding.slotKey,
      provider: this.binding.provider,
      connectionEpoch: this.binding.connectionEpoch,
      createdAt: this.binding.createdAt,
      state: 'PAIRED',
      extensionInstallationId: input.extensionInstallationId,
      encryptedConversationRef: input.encryptedConversationRef,
      conversationRefFingerprint: input.conversationRefFingerprint,
      pairedAt: input.confirmedAt,
      lastSeenAt: input.confirmedAt,
      updatedAt: input.confirmedAt,
    };
    return { outcome: 'paired', binding: this.binding };
  }

  public async getBinding(bindingId: string): Promise<CommandRoomBindingRecord | null> {
    return bindingId === this.binding.id ? this.binding : null;
  }

  public async authenticateBinding(bindingId: string, extensionInstallationId: string): Promise<CommandRoomBindingRecord | null> {
    return bindingId === this.binding.id
      && this.binding.state === 'PAIRED'
      && this.binding.extensionInstallationId === extensionInstallationId
      ? this.binding
      : null;
  }

  public async listRecoverableWakesForBinding(input: Parameters<CommandRoomExtensionBridgeService['listRecoverableWakesForBinding']>[0]): ReturnType<CommandRoomExtensionBridgeService['listRecoverableWakesForBinding']> {
    return this.wake !== null && this.wake.bindingId === input.bindingId ? [this.wake] : [];
  }

  public async beginWakeAttempt(input: Parameters<CommandRoomExtensionBridgeService['beginWakeAttempt']>[0]): ReturnType<CommandRoomExtensionBridgeService['beginWakeAttempt']> {
    if (this.wake === null || this.wake.id !== input.wakeId || this.wake.bindingId !== input.bindingId) return null;
    this.wake = {
      ...this.wake,
      state: 'ATTEMPTING',
      attemptCount: this.wake.attemptCount + 1,
      lastAttemptAt: input.attemptedAt,
      updatedAt: input.attemptedAt,
    };
    return this.wake;
  }

  public async markWakeDelivered(input: Parameters<CommandRoomExtensionBridgeService['markWakeDelivered']>[0]): ReturnType<CommandRoomExtensionBridgeService['markWakeDelivered']> {
    if (this.wake === null || this.wake.id !== input.wakeId || this.wake.state !== 'ATTEMPTING') return null;
    this.wake = { ...this.wake, state: 'DELIVERED', deliveredAt: input.deliveredAt, updatedAt: input.deliveredAt };
    return this.wake;
  }

  public async markWakeSubmitted(input: Parameters<CommandRoomExtensionBridgeService['markWakeSubmitted']>[0]): ReturnType<CommandRoomExtensionBridgeService['markWakeSubmitted']> {
    if (this.wake === null || this.wake.id !== input.wakeId || this.wake.state !== 'DELIVERED') return null;
    this.wake = { ...this.wake, state: 'SUBMITTED', submittedAt: input.submittedAt, updatedAt: input.submittedAt };
    return this.wake;
  }

  public async markWakeAttemptFailed(input: Parameters<CommandRoomExtensionBridgeService['markWakeAttemptFailed']>[0]): ReturnType<CommandRoomExtensionBridgeService['markWakeAttemptFailed']> {
    if (this.wake === null || this.wake.id !== input.wakeId || !['ATTEMPTING', 'DELIVERED'].includes(this.wake.state)) return null;
    this.wake = this.wake.attemptCount >= 3
      ? { ...this.wake, state: 'DEAD_LETTER', lastErrorCode: input.errorCode, updatedAt: input.occurredAt }
      : { ...this.wake, state: 'QUEUED', lastErrorCode: input.errorCode, nextEligibleAt: input.occurredAt, updatedAt: input.occurredAt };
    return this.wake;
  }

  public async touchBinding(input: Parameters<CommandRoomExtensionBridgeService['touchBinding']>[0]): ReturnType<CommandRoomExtensionBridgeService['touchBinding']> {
    if (await this.authenticateBinding(input.bindingId, input.extensionInstallationId) === null) return null;
    this.binding = { ...this.binding, lastSeenAt: input.seenAt, updatedAt: input.seenAt };
    return this.binding;
  }

  public async revoke(bindingId: string, revokedAt: string): Promise<CommandRoomBindingRecord | null> {
    if (bindingId !== this.binding.id) return null;
    this.binding = { ...this.binding, state: 'REVOKED', revokedAt, updatedAt: revokedAt };
    return this.binding;
  }
}
