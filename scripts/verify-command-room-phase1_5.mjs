import { randomUUID } from 'node:crypto';
import process from 'node:process';

const endpoint = process.env.NAVA_MCP_URL ?? 'http://127.0.0.1:18765/mcp';
const protocolVersion = '2025-11-25';
const runKey = `p15-${Date.now()}-${randomUUID().slice(0, 8)}`;
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

  async listTools() {
    const message = await this.request('tools/list', {});
    return message.tools ?? [];
  }

  async callRaw(name, args) {
    return this.request('tools/call', { name, arguments: args });
  }

  async call(name, args) {
    const result = await this.callRaw(name, args);
    if (result?.isError === true) {
      const error = result.structuredContent?.error;
      throw new Error(`${name} failed: ${error?.code ?? 'UNKNOWN'} ${error?.message ?? ''}`.trim());
    }
    assert(isRecord(result?.structuredContent), `${name} did not return structuredContent`);
    return result.structuredContent;
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
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
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

async function expectToolError(client, name, args, code) {
  const result = await client.callRaw(name, args);
  assert(result?.isError === true, `${name} unexpectedly succeeded`);
  assert(result.structuredContent?.error?.code === code, `${name} returned ${result.structuredContent?.error?.code ?? 'no error code'}, expected ${code}`);
}

async function createRoom(client, name, leadSlots, suffix) {
  const created = await client.call('command_room_admin', {
    action: 'create',
    name,
    idempotencyKey: `${runKey}/room/${suffix}`,
    leadSlots,
  });
  assert(created.duplicate === false, `room ${suffix} was unexpectedly a duplicate`);
  return {
    id: field(field(created, 'room'), 'id'),
    joinCodes: field(created, 'joinCodes'),
    mainSessionId: undefined,
  };
}

async function join(client, room, slotKey) {
  const joined = await client.call('command_room_join', {
    roomId: room.id,
    slotKey,
    joinCode: field(room.joinCodes, slotKey),
    provider: client.name.includes('codex') ? 'CODEX' : 'CHATGPT',
    connectionEpoch: 1,
  });
  return field(joined, 'agentSessionId');
}

async function archiveRoom(client, room) {
  try {
    if (!room.mainSessionId && room.joinCodes?.MAIN) {
      room.mainSessionId = await join(client, room, 'MAIN');
    }
    if (!room.mainSessionId) return false;
    const status = await client.call('command_room_status', {
      roomId: room.id,
      agentSessionId: room.mainSessionId,
    });
    const archived = await client.call('command_room_admin', {
      action: 'archive',
      roomId: room.id,
      agentSessionId: room.mainSessionId,
      expectedVersion: field(status, 'roomVersion'),
      idempotencyKey: `${runKey}/archive/${room.id.slice(0, 8)}`,
    });
    return field(field(archived, 'room'), 'status') === 'ARCHIVED';
  } catch {
    return false;
  }
}

const mainClient = new McpClient('nava-phase15-main');
const leadClient = new McpClient('nava-phase15-codex-lead');
const rooms = [];
const verdict = {
  status: 'failed',
  serverVersion: undefined,
  toolCount: 0,
  commandRoomTools: [],
  independentSessions: false,
  crossRoomLeakage: undefined,
  leadToLeadBlocked: undefined,
  writeTaskBlocked: undefined,
  taskLifecycle: [],
  resourceMode: undefined,
  roomsArchived: false,
};

try {
  await Promise.all([mainClient.initialize(), leadClient.initialize()]);
  verdict.serverVersion = mainClient.serverVersion;
  verdict.independentSessions = mainClient.sessionId !== leadClient.sessionId;

  const [mainTools, leadTools] = await Promise.all([mainClient.listTools(), leadClient.listTools()]);
  const mainNames = mainTools.map((tool) => tool.name);
  const leadNames = leadTools.map((tool) => tool.name);
  verdict.toolCount = mainNames.length;
  verdict.commandRoomTools = expectedTools.filter((name) => mainNames.includes(name));
  assert(verdict.independentSessions, 'clients received the same MCP session');
  assert(expectedTools.every((name) => mainNames.includes(name) && leadNames.includes(name)), 'one or more command-room tools are missing');

  const roomA = await createRoom(mainClient, `NAVA Phase 1.5 acceptance ${runKey}`, 5, 'a');
  rooms.push(roomA);
  const roomB = await createRoom(mainClient, `NAVA Phase 1.5 isolation ${runKey}`, 1, 'b');
  rooms.push(roomB);

  roomA.mainSessionId = await join(mainClient, roomA, 'MAIN');
  const leadA = await join(leadClient, roomA, 'LEAD-1');
  await join(leadClient, roomA, 'LEAD-2');
  roomB.mainSessionId = await join(mainClient, roomB, 'MAIN');
  const leadB = await join(leadClient, roomB, 'LEAD-1');

  await Promise.all([
    mainClient.call('command_room_presence', {
      action: 'heartbeat',
      roomId: roomA.id,
      agentSessionId: roomA.mainSessionId,
      projectKey: 'nava-command-room-phase-1',
      workspaceId: '2ed35b8c-bacb-4b38-af53-0a24c7acb360',
    }),
    leadClient.call('command_room_presence', {
      action: 'heartbeat',
      roomId: roomA.id,
      agentSessionId: leadA,
      projectKey: 'nava-command-room-phase-1',
      workspaceId: '2ed35b8c-bacb-4b38-af53-0a24c7acb360',
    }),
  ]);

  const sent = await mainClient.call('command_room_send', {
    roomId: roomA.id,
    agentSessionId: roomA.mainSessionId,
    targetSlotKey: 'LEAD-1',
    kind: 'UPDATE',
    subject: 'Phase 1.5 transport proof',
    summary: 'Message sent through an independent MCP session.',
    evidenceRefs: ['installed-runtime:4.11.0'],
    nextAction: 'Acknowledge and return a result.',
    idempotencyKey: `${runKey}/message/main-to-lead`,
  });

  const inboxA = await leadClient.call('command_room_inbox', {
    action: 'read',
    roomId: roomA.id,
    agentSessionId: leadA,
    cursor: 0,
    limit: 50,
  });
  const inboxB = await leadClient.call('command_room_inbox', {
    action: 'read',
    roomId: roomB.id,
    agentSessionId: leadB,
    cursor: 0,
    limit: 50,
  });
  const subject = field(field(sent, 'message'), 'subject');
  assert(inboxA.messages.some((message) => message.subject === subject), 'room A did not receive the message');
  verdict.crossRoomLeakage = inboxB.messages.some((message) => message.subject === subject);
  assert(verdict.crossRoomLeakage === false, 'room B received room A message');

  const seq = field(field(sent, 'message'), 'seq');
  await leadClient.call('command_room_inbox', {
    action: 'ack',
    roomId: roomA.id,
    agentSessionId: leadA,
    ackThrough: seq,
  });

  await expectToolError(leadClient, 'command_room_send', {
    roomId: roomA.id,
    agentSessionId: leadA,
    targetSlotKey: 'LEAD-2',
    kind: 'UPDATE',
    subject: 'Must be blocked',
    summary: 'Direct Lead-to-Lead traffic is disabled.',
    evidenceRefs: [],
    idempotencyKey: `${runKey}/message/lead-to-lead`,
  }, 'PERMISSION_DENIED');
  verdict.leadToLeadBlocked = true;

  await leadClient.call('command_room_send', {
    roomId: roomA.id,
    agentSessionId: leadA,
    targetSlotKey: 'MAIN',
    kind: 'RESULT',
    subject: 'Phase 1.5 response',
    summary: 'Independent Lead session received and acknowledged the message.',
    evidenceRefs: ['acceptance:message-roundtrip'],
    idempotencyKey: `${runKey}/message/lead-to-main`,
  });

  let status = await mainClient.call('command_room_status', {
    roomId: roomA.id,
    agentSessionId: roomA.mainSessionId,
  });
  await expectToolError(mainClient, 'command_room_task', {
    action: 'assign',
    roomId: roomA.id,
    agentSessionId: roomA.mainSessionId,
    assignedSlotKey: 'LEAD-1',
    projectKey: 'nava-command-room-phase-1',
    workspaceId: '2ed35b8c-bacb-4b38-af53-0a24c7acb360',
    title: 'WRITE must remain blocked',
    brief: {
      summary: 'Verify Phase 1 does not grant workspace mutation authority.',
      acceptanceCriteria: ['Return PERMISSION_REQUIRED'],
      evidenceRefs: [],
    },
    mutationMode: 'WRITE',
    expectedVersion: field(status, 'roomVersion'),
    idempotencyKey: `${runKey}/task/write-block`,
  }, 'PERMISSION_REQUIRED');
  verdict.writeTaskBlocked = true;

  status = await mainClient.call('command_room_status', {
    roomId: roomA.id,
    agentSessionId: roomA.mainSessionId,
  });
  let taskResponse = await mainClient.call('command_room_task', {
    action: 'assign',
    roomId: roomA.id,
    agentSessionId: roomA.mainSessionId,
    assignedSlotKey: 'LEAD-1',
    projectKey: 'nava-command-room-phase-1',
    workspaceId: '2ed35b8c-bacb-4b38-af53-0a24c7acb360',
    title: 'Phase 1.5 read-only acceptance',
    brief: {
      summary: 'Run a bounded read-only verification.',
      acceptanceCriteria: ['Transport works', 'No workspace mutation'],
      evidenceRefs: ['acceptance:phase1.5'],
      nextAction: 'Submit the bounded result.',
    },
    mutationMode: 'READ_ONLY',
    expectedVersion: field(status, 'roomVersion'),
    idempotencyKey: `${runKey}/task/assign`,
  });
  let task = field(taskResponse, 'task');
  verdict.taskLifecycle.push(field(task, 'state'));

  for (const action of ['claim', 'start']) {
    taskResponse = await leadClient.call('command_room_task', {
      action,
      roomId: roomA.id,
      agentSessionId: leadA,
      taskId: field(task, 'id'),
      expectedVersion: field(task, 'version'),
      idempotencyKey: `${runKey}/task/${action}`,
    });
    task = field(taskResponse, 'task');
    verdict.taskLifecycle.push(field(task, 'state'));
  }

  taskResponse = await leadClient.call('command_room_task', {
    action: 'submit',
    roomId: roomA.id,
    agentSessionId: leadA,
    taskId: field(task, 'id'),
    expectedVersion: field(task, 'version'),
    idempotencyKey: `${runKey}/task/submit`,
    result: {
      summary: 'Installed two-session acceptance passed.',
      evidenceRefs: ['acceptance:phase1.5'],
      nextAction: 'MAIN review.',
    },
  });
  task = field(taskResponse, 'task');
  verdict.taskLifecycle.push(field(task, 'state'));

  taskResponse = await mainClient.call('command_room_task', {
    action: 'approve',
    roomId: roomA.id,
    agentSessionId: roomA.mainSessionId,
    taskId: field(task, 'id'),
    expectedVersion: field(task, 'version'),
    idempotencyKey: `${runKey}/task/approve`,
  });
  task = field(taskResponse, 'task');
  verdict.taskLifecycle.push(field(task, 'state'));

  const resource = await mainClient.call('command_room_resource', {
    action: 'status',
    roomId: roomA.id,
    agentSessionId: roomA.mainSessionId,
  });
  verdict.resourceMode = field(resource, 'mode');
  assert(verdict.resourceMode === 'PHASE_1_MANUAL', 'resource mode is not PHASE_1_MANUAL');
  assert(verdict.taskLifecycle.join('>') === 'QUEUED>CLAIMED>RUNNING>REVIEW>COMPLETED', 'task lifecycle is incorrect');

  verdict.status = 'passed';
} finally {
  const archived = [];
  for (const room of rooms) archived.push(await archiveRoom(mainClient, room));
  verdict.roomsArchived = archived.length > 0 && archived.every(Boolean);
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
}

if (verdict.status !== 'passed' || verdict.roomsArchived !== true) process.exitCode = 1;
