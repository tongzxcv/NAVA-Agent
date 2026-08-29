import { randomUUID } from 'node:crypto';
import process from 'node:process';

const endpoint = process.env.NAVA_MCP_URL ?? 'http://127.0.0.1:18765/mcp';
const workspaceA = process.env.NAVA_PHASE2B_WORKSPACE_A;
const workspaceB = process.env.NAVA_PHASE2B_WORKSPACE_B;
const protocolVersion = '2025-11-25';
const deadlineMs = Number.parseInt(process.env.NAVA_RESTART_TIMEOUT_MS ?? '180000', 10);
const runKey = `p2b-${Date.now()}-${randomUUID().slice(0, 8)}`;
const expectedTools = [
  'command_room_join',
  'command_room_status',
  'command_room_inbox',
  'command_room_send',
  'command_room_task',
  'command_room_presence',
  'command_room_resource',
  'command_room_admin',
];

assert(workspaceA && workspaceB && workspaceA !== workspaceB, 'Set distinct NAVA_PHASE2B_WORKSPACE_A and NAVA_PHASE2B_WORKSPACE_B workspace IDs');

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
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, true);
  }

  async listTools() {
    return (await this.request('tools/list', {})).tools ?? [];
  }

  async call(name, args) {
    const result = await this.request('tools/call', { name, arguments: args });
    if (result?.isError === true) {
      const error = result.structuredContent?.error;
      throw new Error(`${name} failed: ${error?.code ?? 'UNKNOWN'} ${error?.message ?? ''}`.trim());
    }
    assert(isRecord(result?.structuredContent), `${name} did not return structuredContent`);
    return result.structuredContent;
  }

  async request(method, params) {
    const response = await this.post({ jsonrpc: '2.0', id: this.nextId++, method, params }, true);
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
    const response = await globalThis.fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    return response;
  }
}

function parseRpc(text) {
  const data = text.split(/\r?\n/).filter((line) => line.startsWith('data: ')).map((line) => line.slice(6));
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

async function join(client, roomId, joinCodes, slotKey) {
  const joined = await client.call('command_room_join', {
    roomId,
    slotKey,
    joinCode: field(joinCodes, slotKey),
    provider: client.name.includes('codex') ? 'CODEX' : 'CHATGPT',
    connectionEpoch: 1,
  });
  return field(joined, 'agentSessionId');
}

async function status(client, roomId, agentSessionId) {
  return client.call('command_room_status', { roomId, agentSessionId, taskLimit: 100 });
}

async function assignWrite(client, roomId, mainSessionId, assignedSlotKey, workspaceId, suffix) {
  const current = await status(client, roomId, mainSessionId);
  return client.call('command_room_task', {
    action: 'assign',
    roomId,
    agentSessionId: mainSessionId,
    assignedSlotKey,
    projectKey: `phase2b-${suffix}`,
    workspaceId,
    title: `Phase 2B ${suffix}`,
    brief: {
      summary: `Installed runtime proof for ${suffix}`,
      acceptanceCriteria: ['No workspace mutation', 'Lease state is observable'],
      evidenceRefs: ['acceptance:phase2b'],
    },
    mutationMode: 'WRITE',
    expectedVersion: field(current, 'roomVersion'),
    idempotencyKey: `${runKey}/task/${suffix}/assign`,
  });
}

async function transition(client, action, roomId, agentSessionId, task, suffix, extra = {}) {
  return client.call('command_room_task', {
    action,
    roomId,
    agentSessionId,
    taskId: field(task, 'id'),
    expectedVersion: field(task, 'version'),
    idempotencyKey: `${runKey}/task/${suffix}/${action}`,
    ...extra,
  });
}

async function waitForRestart() {
  const expiresAt = Date.now() + deadlineMs;
  let offlineObserved = false;
  while (Date.now() < expiresAt) {
    await wait(400);
    const probe = new McpClient('nava-phase2b-after-restart');
    try {
      await probe.initialize();
      if (offlineObserved) return { client: probe, offlineObserved };
    } catch {
      offlineObserved = true;
    }
  }
  throw new Error(offlineObserved ? 'NAVA MCP endpoint did not recover before timeout' : 'NAVA MCP endpoint never went offline');
}

let client = new McpClient('nava-phase2b-main');
let roomId;
let mainSessionId;
let archived = false;
const verdict = {
  status: 'failed',
  serverVersionBefore: undefined,
  serverVersionAfter: undefined,
  toolCount: 0,
  commandRoomTools: [],
  sameWorkspaceBlocked: false,
  differentWorkspacePassed: false,
  resourceQueued: false,
  restartObserved: false,
  writerLeasesRecovered: false,
  resourceLeasesRecovered: false,
  queuePromoted: false,
  leasesReleased: false,
  roomArchived: false,
};

try {
  const lead1Client = new McpClient('nava-phase2b-lead1');
  const lead2Client = new McpClient('nava-phase2b-lead2');
  const lead3Client = new McpClient('nava-phase2b-codex-lead3');
  await Promise.all([client.initialize(), lead1Client.initialize(), lead2Client.initialize(), lead3Client.initialize()]);
  verdict.serverVersionBefore = client.serverVersion;

  const tools = await client.listTools();
  const names = tools.map((tool) => tool.name);
  verdict.toolCount = names.length;
  verdict.commandRoomTools = expectedTools.filter((name) => names.includes(name));
  assert(verdict.commandRoomTools.length === 8, 'one or more Command Room tools are missing');

  const created = await client.call('command_room_admin', {
    action: 'create',
    name: `NAVA Phase 2B acceptance ${runKey}`,
    idempotencyKey: `${runKey}/room/create`,
    leadSlots: 3,
  });
  roomId = field(field(created, 'room'), 'id');
  const joinCodes = field(created, 'joinCodes');
  mainSessionId = await join(client, roomId, joinCodes, 'MAIN');
  const lead1SessionId = await join(lead1Client, roomId, joinCodes, 'LEAD-1');
  const lead2SessionId = await join(lead2Client, roomId, joinCodes, 'LEAD-2');
  const lead3SessionId = await join(lead3Client, roomId, joinCodes, 'LEAD-3');

  let first = field(await assignWrite(client, roomId, mainSessionId, 'LEAD-1', workspaceA, 'writer-a'), 'task');
  first = field(await transition(lead1Client, 'claim', roomId, lead1SessionId, first, 'writer-a'), 'task');
  const firstStarted = await transition(lead1Client, 'start', roomId, lead1SessionId, first, 'writer-a');
  first = field(firstStarted, 'task');
  assert(field(first, 'state') === 'RUNNING', 'first writer did not start');

  let collision = field(await assignWrite(client, roomId, mainSessionId, 'LEAD-2', workspaceA, 'writer-collision'), 'task');
  collision = field(await transition(lead2Client, 'claim', roomId, lead2SessionId, collision, 'writer-collision'), 'task');
  const collisionStarted = await transition(lead2Client, 'start', roomId, lead2SessionId, collision, 'writer-collision');
  collision = field(collisionStarted, 'task');
  verdict.sameWorkspaceBlocked = field(collision, 'state') === 'WAITING' && field(field(collisionStarted, 'leaseConflict'), 'workspaceId') === workspaceA;
  assert(verdict.sameWorkspaceBlocked, 'same-workspace writer was not blocked');

  let second = field(await assignWrite(client, roomId, mainSessionId, 'LEAD-3', workspaceB, 'writer-b'), 'task');
  second = field(await transition(lead3Client, 'claim', roomId, lead3SessionId, second, 'writer-b'), 'task');
  const secondStarted = await transition(lead3Client, 'start', roomId, lead3SessionId, second, 'writer-b');
  second = field(secondStarted, 'task');
  verdict.differentWorkspacePassed = field(second, 'state') === 'RUNNING';
  assert(verdict.differentWorkspacePassed, 'different-workspace writer did not start');

  const firstResource = await lead1Client.call('command_room_resource', {
    action: 'request',
    roomId,
    agentSessionId: lead1SessionId,
    taskId: field(first, 'id'),
    resourceKey: 'mt5-terminal-1',
    idempotencyKey: `${runKey}/resource/first`,
  });
  assert(field(field(firstResource, 'request'), 'state') === 'GRANTED', 'first MT5 resource was not granted');

  const secondResource = await lead3Client.call('command_room_resource', {
    action: 'request',
    roomId,
    agentSessionId: lead3SessionId,
    taskId: field(second, 'id'),
    resourceKey: 'mt5-terminal-1',
    idempotencyKey: `${runKey}/resource/second`,
  });
  verdict.resourceQueued = field(field(secondResource, 'request'), 'state') === 'QUEUED';
  assert(verdict.resourceQueued, 'contended MT5 resource was not queued');

  const before = await status(client, roomId, mainSessionId);
  assert(field(field(before, 'workspaceLeases'), 'entries').length === 2, 'expected two active writers before restart');
  assert(field(field(before, 'resources'), 'leases').length === 1, 'expected one active resource before restart');
  assert(field(field(before, 'resources'), 'queueDepth') === 1, 'expected one queued resource before restart');
  process.stdout.write(`PERSISTENCE_READY version=${verdict.serverVersionBefore} room=${roomId}\n`);

  const restarted = await waitForRestart();
  verdict.restartObserved = restarted.offlineObserved;
  client = restarted.client;
  verdict.serverVersionAfter = client.serverVersion;

  const recovered = await status(client, roomId, mainSessionId);
  verdict.writerLeasesRecovered = field(field(recovered, 'workspaceLeases'), 'entries').length === 2;
  verdict.resourceLeasesRecovered = field(field(recovered, 'resources'), 'leases').length === 1
    && field(field(recovered, 'resources'), 'queueDepth') === 1;
  assert(verdict.writerLeasesRecovered, 'writer leases did not recover after restart');
  assert(verdict.resourceLeasesRecovered, 'resource lease or queue did not recover after restart');

  await client.call('command_room_task', {
    action: 'wait',
    roomId,
    agentSessionId: lead1SessionId,
    taskId: field(first, 'id'),
    expectedVersion: field(first, 'version'),
    reason: 'Release workspace and MT5 lease after restart proof.',
    idempotencyKey: `${runKey}/task/writer-a/wait`,
  });

  const promoted = await client.call('command_room_resource', {
    action: 'request',
    roomId,
    agentSessionId: lead3SessionId,
    taskId: field(second, 'id'),
    resourceKey: 'mt5-terminal-1',
    idempotencyKey: `${runKey}/resource/second`,
  });
  verdict.queuePromoted = field(field(promoted, 'request'), 'state') === 'GRANTED'
    && field(field(promoted, 'request'), 'duplicate') === true;
  assert(verdict.queuePromoted, 'queued MT5 resource was not promoted');

  await client.call('command_room_task', {
    action: 'submit',
    roomId,
    agentSessionId: lead3SessionId,
    taskId: field(second, 'id'),
    expectedVersion: field(second, 'version'),
    result: { summary: 'Installed Phase 2B restart and contention proof passed.', evidenceRefs: ['acceptance:phase2b-installed'] },
    idempotencyKey: `${runKey}/task/writer-b/submit`,
  });

  const finalState = await status(client, roomId, mainSessionId);
  verdict.leasesReleased = field(field(finalState, 'workspaceLeases'), 'entries').length === 0
    && field(field(finalState, 'resources'), 'leases').length === 0
    && field(field(finalState, 'resources'), 'queueDepth') === 0;
  assert(verdict.leasesReleased, 'task-owned leases were not fully released');

  const archivedResult = await client.call('command_room_admin', {
    action: 'archive',
    roomId,
    agentSessionId: mainSessionId,
    expectedVersion: field(finalState, 'roomVersion'),
    idempotencyKey: `${runKey}/room/archive`,
  });
  archived = field(field(archivedResult, 'room'), 'status') === 'ARCHIVED';
  verdict.roomArchived = archived;
  verdict.status = 'passed';
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
} finally {
  if (!archived && roomId && mainSessionId) {
    try {
      const current = await status(client, roomId, mainSessionId);
      const result = await client.call('command_room_admin', {
        action: 'archive',
        roomId,
        agentSessionId: mainSessionId,
        expectedVersion: field(current, 'roomVersion'),
        idempotencyKey: `${runKey}/room/cleanup`,
      });
      verdict.roomArchived = field(field(result, 'room'), 'status') === 'ARCHIVED';
    } catch {
      // The bounded acceptance room remains identifiable by its unique run key.
    }
  }
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
}

if (verdict.status !== 'passed' || verdict.roomArchived !== true) process.exitCode = 1;
