import { createCipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CommandRoomBindingRecord, CommandRoomWakeDeliveryRecord } from '@lnwjud/domain';
import type { CommandRoomExtensionService } from '@lnwjud/application';

const DEFAULT_EXTENSION_BRIDGE_PORT = 18_766;
const MAX_JSON_BODY_BYTES = 16 * 1024;
const MAX_RECOVERABLE_WAKES = 50;
const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type';

export type CommandRoomExtensionBridgeService = Pick<CommandRoomExtensionService,
  | 'confirmPairingByBinding'
  | 'createContinuationChallenge'
  | 'getBinding'
  | 'authenticateBinding'
  | 'listRecoverableWakesForBinding'
  | 'beginWakeAttempt'
  | 'markWakeDelivered'
  | 'markWakeSubmitted'
  | 'markWakeAttemptFailed'
  | 'touchBinding'
  | 'revoke'
>;

export interface CommandRoomExtensionBridgeOptions {
  readonly service: CommandRoomExtensionBridgeService;
  readonly authKey: Buffer;
  readonly enabled: () => boolean;
  readonly allowedOrigins: () => readonly string[];
  readonly port?: number;
  readonly now?: () => Date;
}

export interface CommandRoomExtensionBridgeHandle {
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

export async function startCommandRoomExtensionBridge(options: CommandRoomExtensionBridgeOptions): Promise<CommandRoomExtensionBridgeHandle> {
  if (options.authKey.byteLength < 32) throw new Error('Command Room Extension Bridge auth key must contain at least 32 bytes.');
  const port = options.port ?? DEFAULT_EXTENSION_BRIDGE_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('Invalid Command Room Extension Bridge port.');
  const now = options.now ?? ((): Date => new Date());
  const server = createServer((request, response) => {
    void handleRequest(request, response, options, now).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpInputError) {
        sendJson(response, error.statusCode, { ok: false, code: error.code, message: error.message });
        return;
      }
      sendJson(response, 500, { ok: false, code: 'INTERNAL_ERROR', message: safeErrorMessage(error) });
    });
  });
  await listenLoopback(server, port);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Command Room Extension Bridge did not expose a TCP listener.');
  }
  const boundPort = (address as AddressInfo).port;
  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}`,
    close: (): Promise<void> => closeServer(server),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: CommandRoomExtensionBridgeOptions,
  now: () => Date,
): Promise<void> {
  const origin = request.headers.origin;
  const originAllowed = typeof origin === 'string' && allowedOrigin(options.allowedOrigins(), origin);
  if (typeof origin === 'string' && !originAllowed) {
    sendJson(response, 403, { ok: false, code: 'ORIGIN_DENIED' });
    return;
  }
  if (originAllowed) applyCors(response, origin);
  if (request.method === 'OPTIONS') {
    if (!originAllowed) {
      sendJson(response, 403, { ok: false, code: 'ORIGIN_DENIED' });
      return;
    }
    response.statusCode = 204;
    response.end();
    return;
  }
  if (!options.enabled()) {
    sendJson(response, 503, { ok: false, code: 'BRIDGE_DISABLED' });
    return;
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const originlessAuthenticatedRead = origin === undefined
    && request.method === 'GET'
    && /^\/v1\/bindings\/[^/]+(?:\/(?:status|wakes))?$/.test(url.pathname);
  if (origin === undefined && !originlessAuthenticatedRead) {
    sendJson(response, 403, { ok: false, code: 'ORIGIN_DENIED' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/v1/health') {
    sendJson(response, 200, { ok: true, service: 'command-room-extension-bridge', protocolVersion: 1 });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/pair/confirm') {
    const body = await readJsonObject(request);
    const result = await options.service.confirmPairingByBinding({
      bindingId: requiredOpaqueString(body, 'bindingId', 8, 512),
      challenge: requiredOpaqueString(body, 'challenge', 32, 512),
      extensionInstallationId: requiredOpaqueString(body, 'extensionInstallationId', 8, 512),
      ...protectConversationRef(options.authKey, requiredOpaqueString(body, 'conversationRef', 8, 2_048)),
      confirmedAt: now().toISOString(),
    });
    if (result.outcome !== 'paired') {
      sendJson(response, result.outcome === 'not_found' ? 404 : 409, { ok: false, outcome: result.outcome });
      return;
    }
    const installationId = result.binding.extensionInstallationId;
    if (installationId === undefined) throw new Error('Paired binding is missing its extension installation identity.');
    sendJson(response, 200, {
      ok: true,
      outcome: 'paired',
      binding: safeBinding(result.binding),
      authToken: deriveAuthToken(options.authKey, result.binding.id, installationId, result.binding.connectionEpoch),
    });
    return;
  }

  const bindingMatch = /^\/v1\/bindings\/([^/]+)(?:\/(status|touch|wakes|revoke|continuation))?$/.exec(url.pathname);
  if (bindingMatch !== null) {
    const bindingId = decodePathSegment(bindingMatch[1]);
    const action = bindingMatch[2] ?? 'status';
    const authenticated = await authenticateRequest(request, options, bindingId);
    if (authenticated === null) {
      sendJson(response, 401, { ok: false, code: 'UNAUTHORIZED_BINDING' });
      return;
    }
    if (action === 'status' && request.method === 'GET') {
      sendJson(response, 200, { ok: true, binding: safeBinding(authenticated) });
      return;
    }
    if (action === 'continuation' && request.method === 'POST') {
      const continuation = await options.service.createContinuationChallenge({
        bindingId,
        extensionInstallationId: requireInstallationId(authenticated),
        now: now().toISOString(),
      });
      if (continuation === null) {
        sendJson(response, 409, { ok: false, code: 'BINDING_NOT_ACTIVE' });
        return;
      }
      sendJson(response, 200, { ok: true, continuation });
      return;
    }
    if (action === 'touch' && request.method === 'POST') {
      const touched = await options.service.touchBinding({
        bindingId,
        extensionInstallationId: requireInstallationId(authenticated),
        seenAt: now().toISOString(),
      });
      if (touched === null) {
        sendJson(response, 409, { ok: false, code: 'BINDING_NOT_ACTIVE' });
        return;
      }
      sendJson(response, 200, { ok: true, binding: safeBinding(touched) });
      return;
    }
    if (action === 'wakes' && request.method === 'GET') {
      const limit = parseBoundedLimit(url.searchParams.get('limit'));
      const wakes = await options.service.listRecoverableWakesForBinding({
        bindingId,
        extensionInstallationId: requireInstallationId(authenticated),
        now: now().toISOString(),
        limit,
      });
      sendJson(response, 200, { ok: true, wakes: wakes.map(safeWake) });
      return;
    }
    if (action === 'revoke' && request.method === 'POST') {
      const revoked = await options.service.revoke(bindingId, now().toISOString());
      if (revoked === null) {
        sendJson(response, 404, { ok: false, code: 'BINDING_NOT_FOUND' });
        return;
      }
      sendJson(response, 200, { ok: true, binding: safeBinding(revoked) });
      return;
    }
    sendJson(response, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const wakeMatch = /^\/v1\/wakes\/([^/]+)\/(attempt|delivered|submitted|failed)$/.exec(url.pathname);
  if (wakeMatch !== null && request.method === 'POST') {
    const wakeId = decodePathSegment(wakeMatch[1]);
    const transition = wakeMatch[2];
    const body = await readJsonObject(request);
    const bindingId = requiredOpaqueString(body, 'bindingId', 8, 512);
    const authenticated = await authenticateRequest(request, options, bindingId);
    if (authenticated === null) {
      sendJson(response, 401, { ok: false, code: 'UNAUTHORIZED_BINDING' });
      return;
    }
    const extensionInstallationId = requireInstallationId(authenticated);
    const occurredAt = now().toISOString();
    const wake = transition === 'attempt'
      ? await options.service.beginWakeAttempt({ bindingId, extensionInstallationId, wakeId, attemptedAt: occurredAt })
      : transition === 'delivered'
        ? await options.service.markWakeDelivered({ bindingId, extensionInstallationId, wakeId, deliveredAt: occurredAt })
        : transition === 'submitted'
          ? await options.service.markWakeSubmitted({ bindingId, extensionInstallationId, wakeId, submittedAt: occurredAt })
          : await options.service.markWakeAttemptFailed({
            bindingId,
            extensionInstallationId,
            wakeId,
            occurredAt,
            errorCode: requiredWakeFailureCode(body),
          });
    if (wake === null) {
      sendJson(response, 404, { ok: false, code: 'WAKE_NOT_FOUND' });
      return;
    }
    sendJson(response, 200, { ok: true, wake: safeWake(wake) });
    return;
  }

  sendJson(response, 404, { ok: false, code: 'NOT_FOUND' });
}

async function authenticateRequest(
  request: IncomingMessage,
  options: CommandRoomExtensionBridgeOptions,
  bindingId: string,
): Promise<CommandRoomBindingRecord | null> {
  const binding = await options.service.getBinding(bindingId);
  if (binding === null || binding.extensionInstallationId === undefined) return null;
  const token = bearerToken(request.headers.authorization);
  if (token === null) return null;
  const expected = deriveAuthToken(options.authKey, binding.id, binding.extensionInstallationId, binding.connectionEpoch);
  if (!constantTimeTextEqual(token, expected)) return null;
  return options.service.authenticateBinding(binding.id, binding.extensionInstallationId);
}

function safeBinding(binding: CommandRoomBindingRecord): Readonly<Record<string, unknown>> {
  return {
    id: binding.id,
    roomId: binding.roomId,
    slotKey: binding.slotKey,
    provider: binding.provider,
    connectionEpoch: binding.connectionEpoch,
    state: binding.state,
    ...(binding.pairedAt === undefined ? {} : { pairedAt: binding.pairedAt }),
    ...(binding.lastSeenAt === undefined ? {} : { lastSeenAt: binding.lastSeenAt }),
    ...(binding.revokedAt === undefined ? {} : { revokedAt: binding.revokedAt }),
    ...(binding.replacedAt === undefined ? {} : { replacedAt: binding.replacedAt }),
    updatedAt: binding.updatedAt,
  };
}

function safeWake(wake: CommandRoomWakeDeliveryRecord): Readonly<Record<string, unknown>> {
  return {
    id: wake.id,
    bindingId: wake.bindingId,
    eventKey: wake.eventKey,
    ...(wake.taskId === undefined ? {} : { taskId: wake.taskId }),
    reason: wake.reason,
    state: wake.state,
    attemptCount: wake.attemptCount,
    ...(wake.nextEligibleAt === undefined ? {} : { nextEligibleAt: wake.nextEligibleAt }),
    ...(wake.deliveredAt === undefined ? {} : { deliveredAt: wake.deliveredAt }),
    ...(wake.submittedAt === undefined ? {} : { submittedAt: wake.submittedAt }),
    ...(wake.lastErrorCode === undefined ? {} : { lastErrorCode: wake.lastErrorCode }),
    updatedAt: wake.updatedAt,
  };
}

function protectConversationRef(key: Buffer, conversationRef: string): { readonly encryptedConversationRef: string; readonly conversationRefFingerprint: string } {
  const encryptionKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'nava-command-room-conversation-ref-encryption-v1', 32));
  const fingerprintKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'nava-command-room-conversation-ref-fingerprint-v1', 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(Buffer.from('nava-command-room-conversation-ref-v1', 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(conversationRef, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const fingerprint = createHmac('sha256', fingerprintKey).update(conversationRef, 'utf8').digest('base64url');
  return {
    encryptedConversationRef: `aes256gcm:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`,
    conversationRefFingerprint: `hmac-sha256:v1:${fingerprint}`,
  };
}

export function protectCommandRoomConversationRefForTest(
  key: Buffer,
  conversationRef: string,
): { readonly encryptedConversationRef: string; readonly conversationRefFingerprint: string } {
  return protectConversationRef(key, conversationRef);
}

function deriveAuthToken(key: Buffer, bindingId: string, extensionInstallationId: string, connectionEpoch: number): string {
  const digest = createHmac('sha256', key)
    .update('nava-command-room-extension-bridge-v1\0', 'utf8')
    .update(bindingId, 'utf8')
    .update('\0', 'utf8')
    .update(extensionInstallationId, 'utf8')
    .update('\0', 'utf8')
    .update(String(connectionEpoch), 'utf8')
    .digest('base64url');
  return `nava-v1.${digest}`;
}

export function deriveCommandRoomExtensionAuthTokenForTest(
  key: Buffer,
  bindingId: string,
  extensionInstallationId: string,
  connectionEpoch: number,
): string {
  return deriveAuthToken(key, bindingId, extensionInstallationId, connectionEpoch);
}

function requireInstallationId(binding: CommandRoomBindingRecord): string {
  if (binding.extensionInstallationId === undefined) throw new Error('Active binding is missing extensionInstallationId.');
  return binding.extensionInstallationId;
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
}

function allowedOrigin(allowlist: readonly string[], origin: string): boolean {
  return allowlist.some((entry) => isCommandRoomExtensionOrigin(entry) && entry === origin);
}

export function isCommandRoomExtensionOrigin(value: string): boolean {
  return /^chrome-extension:\/\/[a-z]{32}$/.test(value) || /^moz-extension:\/\/[0-9a-f-]{16,64}$/i.test(value);
}

function applyCors(response: ServerResponse, origin: string): void {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  response.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
}

function parseBoundedLimit(value: string | null): number {
  if (value === null) return 25;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_RECOVERABLE_WAKES) throw new Error('Wake limit must be an integer between 1 and 50.');
  return parsed;
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpInputError(415, 'CONTENT_TYPE_REQUIRED', 'Content-Type application/json is required.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_JSON_BODY_BYTES) throw new HttpInputError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isRecord(value)) throw new Error('body is not an object');
    return value;
  } catch {
    throw new HttpInputError(400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }
}

const WAKE_FAILURE_CODES = new Set([
  'TAB_NOT_FOUND',
  'AMBIGUOUS_TAB',
  'CONVERSATION_MISMATCH',
  'DOM_MISMATCH',
  'COMPOSER_NOT_EMPTY',
  'SUBMIT_FAILED',
  'TAB_UNAVAILABLE',
  'NAVIGATION_CHANGED',
  'EXTENSION_INTERNAL',
]);

function requiredWakeFailureCode(value: Record<string, unknown>): string {
  const code = value.errorCode;
  if (typeof code !== 'string' || !WAKE_FAILURE_CODES.has(code)) {
    throw new HttpInputError(400, 'INVALID_WAKE_FAILURE_CODE', 'Wake failure code is invalid.');
  }
  return code;
}

function requiredOpaqueString(value: Record<string, unknown>, field: string, min: number, max: number): string {
  const candidate = value[field];
  if (typeof candidate !== 'string' || candidate.trim().length < min || candidate.length > max) {
    throw new HttpInputError(400, 'INVALID_INPUT', `${field} is invalid.`);
  }
  return candidate;
}

function decodePathSegment(value: string | undefined): string {
  if (value === undefined) throw new HttpInputError(400, 'INVALID_PATH', 'Missing path identifier.');
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.trim().length < 1 || decoded.length > 512 || decoded.includes('/')) throw new Error('invalid identifier');
    return decoded;
  } catch {
    throw new HttpInputError(400, 'INVALID_PATH', 'Invalid path identifier.');
  }
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof HttpInputError) return error.message;
  if (error instanceof Error && /cooldown|not active|does not belong|attempt budget/i.test(error.message)) return error.message;
  return 'Command Room Extension Bridge request failed.';
}

class HttpInputError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function listenLoopback(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: '127.0.0.1', port });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
