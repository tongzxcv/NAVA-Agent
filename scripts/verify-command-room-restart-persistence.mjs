import { randomUUID } from 'node:crypto';
import process from 'node:process';

const endpoint = process.env.NAVA_MCP_URL ?? 'http://127.0.0.1:18765/mcp';
const protocolVersion = '2025-11-25';
const deadlineMs = Number.parseInt(process.env.NAVA_RESTART_TIMEOUT_MS ?? '120000', 10);
const runKey = `restart-${Date.now()}-${randomUUID().slice(0, 8)}`;

class McpClient {
  constructor(name) {
    this.name = name;
    this.sessionId = undefined;
    this.nextId = 1;
    this.serverVersion = undefined;
  }

  async initialize() {
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: this.name, version: '1.0.0' },
      },
    }, false);
    this.sessionId = response.headers.get('mcp-session-id') ?? undefined;
    assert(this.sessionId, 'initialize did not return mcp-session-id');
    const message = parseRpc(await response.text());
    assert(message.result?.serverInfo?.version, 'initialize did not return server version');
    this.serverVersion = message.result.serverInfo.version;
    await this.post({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }, true);
  }

  async call(name, args) {
    const response = await this.request('tools/call', { name, arguments: args });
    if (response?.isError === true) {
      const error = response.structuredContent?.error;
      throw new Error(`${name} failed: ${error?.code ?? 'UNKNOWN'} ${error?.message ?? ''}`.trim());
    }
    assert(isRecord(response?.structuredContent), `${name} did not return structuredContent`);
    return response.structuredContent;
  }

  async request(method, params) {
    const response = await this.post({
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
    }, true);
    const message = parseRpc(await response.text());
    if (message.error) throw new Error(`${method} JSON-RPC error: ${message.error.message ?? message.error.code}`);
    return message.result;
  }

  async post(body, includeSession) {
    const headers = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };
    if (includeSession) {
      assert(this.sessionId, 'MCP session is not initialized');
      headers['mcp-session-id'] = this.sessionId;
      headers['mcp-protocol-version'] = protocolVersion;
    }
    const response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    return response;
  }
}

function parseRpc(text) {
  const data = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6));
  const payload = data.at(-1) ?? text.trim();
  assert(payload, 'MCP response body was empty');
  return JSON.parse(payload);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(record, name) {
  const value = record?.[name];
  assert(value !== undefined && value !== null, `missing field: ${name}`);
  return value;
}

function wait(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

let roomId;
let agentSessionId;
let client;
let archived = false;
const verdict = {
  status: 'failed',
  serverVersionBefore: undefined,
  serverVersionAfter: undefined,
  offlineObserved: false,
  roomReadableAfterRestart: false,
  roomVersionPreserved: false,
  roomArchived: false,
};

try {
  client = new McpClient('nava-phase15-restart-before');
  await client.initialize();
  verdict.serverVersionBefore = client.serverVersion;

  const created = await client.call('command_room_admin', {
    action: 'create',
    name: `NAVA Phase 1.5 restart ${runKey}`,
    idempotencyKey: `${runKey}/create`,
    leadSlots: 5,
  });
  assert(created.duplicate === false, 'test room was unexpectedly a duplicate');
  roomId = field(field(created, 'room'), 'id');
  const joinCodes = field(created, 'joinCodes');

  const joined = await client.call('command_room_join', {
    roomId,
    slotKey: 'MAIN',
    joinCode: field(joinCodes, 'MAIN'),
    provider: 'CODEX',
    connectionEpoch: 1,
  });
  agentSessionId = field(joined, 'agentSessionId');

  const before = await client.call('command_room_status', { roomId, agentSessionId });
  const versionBefore = field(before, 'roomVersion');
  process.stdout.write(`PERSISTENCE_READY version=${verdict.serverVersionBefore}\n`);

  const expiresAt = Date.now() + deadlineMs;
  let afterClient;
  while (Date.now() < expiresAt) {
    await wait(400);
    const probe = new McpClient('nava-phase15-restart-after');
    try {
      await probe.initialize();
      if (verdict.offlineObserved) {
        afterClient = probe;
        break;
      }
    } catch {
      verdict.offlineObserved = true;
    }
  }

  assert(verdict.offlineObserved, 'NAVA MCP endpoint never went offline');
  assert(afterClient, 'NAVA MCP endpoint did not recover before timeout');
  client = afterClient;
  verdict.serverVersionAfter = client.serverVersion;

  const after = await client.call('command_room_status', { roomId, agentSessionId });
  verdict.roomReadableAfterRestart = field(field(after, 'room'), 'status') === 'ACTIVE';
  verdict.roomVersionPreserved = field(after, 'roomVersion') === versionBefore;
  assert(verdict.roomReadableAfterRestart, 'room was not readable after restart');
  assert(verdict.roomVersionPreserved, 'room version changed across restart');

  const archivedResult = await client.call('command_room_admin', {
    action: 'archive',
    roomId,
    agentSessionId,
    expectedVersion: field(after, 'roomVersion'),
    idempotencyKey: `${runKey}/archive`,
  });
  archived = field(field(archivedResult, 'room'), 'status') === 'ARCHIVED';
  verdict.roomArchived = archived;
  assert(archived, 'test room was not archived');
  verdict.status = 'passed';
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
} finally {
  if (!archived && client && roomId && agentSessionId) {
    try {
      const status = await client.call('command_room_status', { roomId, agentSessionId });
      const result = await client.call('command_room_admin', {
        action: 'archive',
        roomId,
        agentSessionId,
        expectedVersion: field(status, 'roomVersion'),
        idempotencyKey: `${runKey}/cleanup`,
      });
      verdict.roomArchived = field(field(result, 'room'), 'status') === 'ARCHIVED';
    } catch {
      // Task-owned room remains identifiable by its bounded Phase 1.5 name.
    }
  }
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
}

if (verdict.status !== 'passed' || verdict.roomArchived !== true) process.exitCode = 1;
