import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandRoomBroker } from '@lnwjud/application';
import type { Result } from '@lnwjud/domain';
import { ToolRegistry } from '@lnwjud/mcp-server';
import { SqliteCommandRoomRepository, SqliteDatabase } from '@lnwjud/storage';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('CommandRoomBroker', () => {
  it('joins manual slots, deduplicates messages, and advances an acknowledged inbox cursor', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-broker-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    let now = new Date('2026-08-28T01:00:00.000Z');
    const broker = new CommandRoomBroker(new SqliteCommandRoomRepository(database), () => now);

    const created = value(await broker.admin({
      action: 'create',
      name: 'EA Command',
      idempotencyKey: 'create-ea-command',
      leadSlots: 2,
    }));
    expect(created).toMatchObject({
      manifestVersion: '1.0.0',
      roomVersion: 1,
      room: { name: 'EA Command', status: 'ACTIVE' },
      joinCodes: { MAIN: expect.any(String), 'LEAD-1': expect.any(String), 'LEAD-2': expect.any(String) },
    });

    now = new Date('2026-08-28T01:00:01.000Z');
    const main = value(await broker.join({
      roomId: created.room.id,
      slotKey: 'MAIN',
      joinCode: created.joinCodes.MAIN,
      provider: 'CHATGPT',
      connectionEpoch: 1,
    }));
    const lead = value(await broker.join({
      roomId: created.room.id,
      slotKey: 'LEAD-1',
      joinCode: created.joinCodes['LEAD-1'],
      provider: 'CHATGPT',
      connectionEpoch: 1,
    }));

    const first = value(await broker.send({
      roomId: created.room.id,
      agentSessionId: main.agentSessionId,
      targetSlotKey: 'LEAD-1',
      kind: 'UPDATE',
      subject: 'R68 evidence',
      summary: 'READY67 rejected; continue from READY66 with the narrow guard.',
      evidenceRefs: ['checkpoint:237f6749-2ec3-415f-9720-821e9e61ceb6'],
      idempotencyKey: 'main/r68/update-1',
    }));
    const duplicate = value(await broker.send({
      roomId: created.room.id,
      agentSessionId: main.agentSessionId,
      targetSlotKey: 'LEAD-1',
      kind: 'UPDATE',
      subject: 'R68 evidence',
      summary: 'READY67 rejected; continue from READY66 with the narrow guard.',
      evidenceRefs: ['checkpoint:237f6749-2ec3-415f-9720-821e9e61ceb6'],
      idempotencyKey: 'main/r68/update-1',
    }));
    expect(duplicate).toMatchObject({ duplicate: true, message: { id: first.message.id } });

    const inbox = value(await broker.inbox({
      action: 'read',
      roomId: created.room.id,
      agentSessionId: lead.agentSessionId,
      limit: 25,
    }));
    expect(inbox.messages).toHaveLength(1);
    expect(inbox).toMatchObject({
      cursor: 0,
      nextCursor: first.message.seq,
      truncated: false,
      messages: [{ subject: 'R68 evidence', body: { evidenceRefs: ['checkpoint:237f6749-2ec3-415f-9720-821e9e61ceb6'] } }],
    });

    value(await broker.inbox({
      action: 'ack',
      roomId: created.room.id,
      agentSessionId: lead.agentSessionId,
      ackThrough: inbox.nextCursor,
    }));
    const empty = value(await broker.inbox({
      action: 'read',
      roomId: created.room.id,
      agentSessionId: lead.agentSessionId,
    }));
    expect(empty).toMatchObject({ cursor: inbox.nextCursor, messages: [], truncated: false });
    database.close();
  });
  it('expands an existing room sequentially to LEAD-5 without creating sessions early', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-expand-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    let now = new Date('2026-08-30T06:10:00.000Z');
    const broker = new CommandRoomBroker(new SqliteCommandRoomRepository(database), () => now);

    try {
      const created = value(await broker.admin({ action: 'create', name: 'Expandable Room', idempotencyKey: 'expand-room', leadSlots: 3 }));
      const main = value(await broker.join({ roomId: created.room.id, slotKey: 'MAIN', joinCode: created.joinCodes.MAIN, provider: 'CHATGPT', connectionEpoch: 1 }));
      const lead1 = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-1', joinCode: created.joinCodes['LEAD-1'], provider: 'CHATGPT', connectionEpoch: 1 }));

      const denied = await broker.admin({ action: 'add_lead', roomId: created.room.id, agentSessionId: lead1.agentSessionId, expectedVersion: lead1.roomVersion, idempotencyKey: 'lead-cannot-expand' });
      expect(denied).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });

      now = new Date('2026-08-30T06:10:01.000Z');
      const added4 = value(await broker.admin({ action: 'add_lead', roomId: created.room.id, agentSessionId: main.agentSessionId, expectedVersion: lead1.roomVersion, idempotencyKey: 'main-add-lead-4' }));
      expect(added4).toMatchObject({ action: 'add_lead', duplicate: false, targetSlotKey: 'LEAD-4', requiredConnectionEpoch: 1, joinCode: expect.any(String) });
      const replay4 = value(await broker.admin({ action: 'add_lead', roomId: created.room.id, agentSessionId: main.agentSessionId, expectedVersion: lead1.roomVersion, idempotencyKey: 'main-add-lead-4' }));
      expect(replay4).toMatchObject({ action: 'add_lead', duplicate: true, targetSlotKey: 'LEAD-4', requiredConnectionEpoch: 1 });
      expect(replay4.joinCode).toBeUndefined();

      const stale = await broker.admin({ action: 'add_lead', roomId: created.room.id, agentSessionId: main.agentSessionId, expectedVersion: lead1.roomVersion, idempotencyKey: 'main-add-stale' });
      expect(stale).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringContaining('Room version conflict') } });

      const recovered4 = value(await broker.reissueBootPromptFromTrustedDesktop({
        roomId: created.room.id, targetSlotKey: 'LEAD-4', expectedVersion: added4.roomVersion,
        idempotencyKey: 'desktop-recover-lead-4',
      }));
      expect(recovered4).toMatchObject({ action: 'rebind', duplicate: false, targetSlotKey: 'LEAD-4', requiredConnectionEpoch: 1, joinCode: expect.any(String) });
      const recoveredReplay = value(await broker.reissueBootPromptFromTrustedDesktop({
        roomId: created.room.id, targetSlotKey: 'LEAD-4', expectedVersion: added4.roomVersion,
        idempotencyKey: 'desktop-recover-lead-4',
      }));
      expect(recoveredReplay).toMatchObject({ action: 'rebind', duplicate: true, targetSlotKey: 'LEAD-4', requiredConnectionEpoch: 1 });
      expect(recoveredReplay.joinCode).toBeUndefined();

      const joined4 = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-4', joinCode: recovered4.joinCode as string, provider: 'CHATGPT', connectionEpoch: recovered4.requiredConnectionEpoch }));
      expect(joined4.agent).toMatchObject({ slotKey: 'LEAD-4', state: 'AVAILABLE', connectionEpoch: 1 });
      const joinedRecoveryDenied = await broker.reissueBootPromptFromTrustedDesktop({
        roomId: created.room.id, targetSlotKey: 'LEAD-4', expectedVersion: joined4.roomVersion,
        idempotencyKey: 'desktop-recover-joined-lead-4',
      });
      expect(joinedRecoveryDenied).toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED', message: expect.stringContaining('epoch 0') } });

      now = new Date('2026-08-30T06:10:02.000Z');
      const added5 = value(await broker.admin({ action: 'add_lead', roomId: created.room.id, agentSessionId: main.agentSessionId, expectedVersion: joined4.roomVersion, idempotencyKey: 'main-add-lead-5' }));
      expect(added5).toMatchObject({ duplicate: false, targetSlotKey: 'LEAD-5', requiredConnectionEpoch: 1, joinCode: expect.any(String) });
      const replay5 = value(await broker.admin({ action: 'add_lead', roomId: created.room.id, agentSessionId: main.agentSessionId, expectedVersion: joined4.roomVersion, idempotencyKey: 'main-add-lead-5' }));
      expect(replay5).toMatchObject({ duplicate: true, targetSlotKey: 'LEAD-5' });
      expect(replay5.joinCode).toBeUndefined();

      const overCapacity = await broker.admin({ action: 'add_lead', roomId: created.room.id, agentSessionId: main.agentSessionId, expectedVersion: added5.roomVersion, idempotencyKey: 'main-add-lead-6' });
      expect(overCapacity).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringContaining('maximum of 5') } });

      const archived = value(await broker.admin({ action: 'archive', roomId: created.room.id, agentSessionId: main.agentSessionId, expectedVersion: added5.roomVersion, idempotencyKey: 'main-archive-after-capacity' }));
      const archivedAdd = await broker.admin({ action: 'add_lead', roomId: created.room.id, agentSessionId: main.agentSessionId, expectedVersion: archived.roomVersion, idempotencyKey: 'main-add-archived' });
      expect(archivedAdd).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED', message: expect.stringContaining('Archived') } });
      const status = value(await broker.status({ roomId: created.room.id, agentSessionId: main.agentSessionId }));
      expect(status.agents.map((agent) => agent.slotKey)).toEqual(['MAIN', 'LEAD-1', 'LEAD-2', 'LEAD-3', 'LEAD-4', 'LEAD-5']);
      const pending5 = status.agents.find((agent) => agent.slotKey === 'LEAD-5');
      expect(pending5).toMatchObject({ state: 'AVAILABLE', connectionEpoch: 0 });
    } finally {
      database.close();
    }
  });

  it('fails closed when an existing room has a non-contiguous Lead slot set', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-gap-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    const repository = new SqliteCommandRoomRepository(database);
    const broker = new CommandRoomBroker(repository, () => new Date('2026-08-30T06:20:00.000Z'));
    try {
      const created = value(await broker.admin({ action: 'create', name: 'Gap Room', idempotencyKey: 'gap-room', leadSlots: 3 }));
      const main = value(await broker.join({ roomId: created.room.id, slotKey: 'MAIN', joinCode: created.joinCodes.MAIN, provider: 'CHATGPT', connectionEpoch: 1 }));
      database.connection.prepare("DELETE FROM command_room_agents WHERE room_id = ? AND slot_key = 'LEAD-2'").run(created.room.id);
      const result = await broker.admin({ action: 'add_lead', roomId: created.room.id, agentSessionId: main.agentSessionId, expectedVersion: main.roomVersion, idempotencyKey: 'gap-add' });
      expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR', message: expect.stringContaining('not contiguous') } });
    } finally {
      database.close();
    }
  });

  it('enforces task ownership, optimistic versions, idempotency, and review approval', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-task-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    const broker = new CommandRoomBroker(new SqliteCommandRoomRepository(database), () => new Date('2026-08-28T02:00:00.000Z'));

    const created = value(await broker.admin({ action: 'create', name: 'Task Room', idempotencyKey: 'create-task-room', leadSlots: 2 }));
    const main = value(await broker.join({ roomId: created.room.id, slotKey: 'MAIN', joinCode: created.joinCodes.MAIN, provider: 'CHATGPT', connectionEpoch: 1 }));
    const lead1 = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-1', joinCode: created.joinCodes['LEAD-1'], provider: 'CHATGPT', connectionEpoch: 1 }));
    const lead2 = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-2', joinCode: created.joinCodes['LEAD-2'], provider: 'CHATGPT', connectionEpoch: 1 }));

    const assigned = value(await broker.task({
      action: 'assign',
      roomId: created.room.id,
      agentSessionId: main.agentSessionId,
      assignedSlotKey: 'LEAD-1',
      projectKey: 'BEELZEBUB EA',
      workspaceId: 'workspace-beelzebub',
      title: 'Validate READY68',
      brief: {
        summary: 'Continue from READY66 and validate the narrow primaryIdx guard.',
        acceptanceCriteria: ['compile 0/0', 'targeted regression', 'full regression'],
        evidenceRefs: ['checkpoint:237f6749-2ec3-415f-9720-821e9e61ceb6'],
        nextAction: 'Create READY68 in the isolated lab.',
      },
      mutationMode: 'READ_ONLY',
      priority: 2,
      expectedVersion: lead2.roomVersion,
      idempotencyKey: 'main/ready68/assign',
    }));
    expect(assigned).toMatchObject({ duplicate: false, task: { state: 'QUEUED', version: 1, mutationMode: 'READ_ONLY' } });

    const duplicate = value(await broker.task({
      action: 'assign',
      roomId: created.room.id,
      agentSessionId: main.agentSessionId,
      assignedSlotKey: 'LEAD-1',
      projectKey: 'BEELZEBUB EA',
      workspaceId: 'workspace-beelzebub',
      title: 'Validate READY68',
      brief: {
        summary: 'Continue from READY66 and validate the narrow primaryIdx guard.',
        acceptanceCriteria: ['compile 0/0', 'targeted regression', 'full regression'],
        evidenceRefs: ['checkpoint:237f6749-2ec3-415f-9720-821e9e61ceb6'],
        nextAction: 'Create READY68 in the isolated lab.',
      },
      mutationMode: 'READ_ONLY',
      priority: 2,
      expectedVersion: lead2.roomVersion,
      idempotencyKey: 'main/ready68/assign',
    }));
    expect(duplicate).toMatchObject({ duplicate: true, task: { id: assigned.task.id } });

    await expect(broker.task({
      action: 'claim',
      roomId: created.room.id,
      agentSessionId: lead2.agentSessionId,
      taskId: assigned.task.id,
      expectedVersion: 1,
      idempotencyKey: 'lead2/ready68/claim',
    })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });

    const claimed = value(await broker.task({
      action: 'claim',
      roomId: created.room.id,
      agentSessionId: lead1.agentSessionId,
      taskId: assigned.task.id,
      expectedVersion: 1,
      idempotencyKey: 'lead1/ready68/claim',
    }));
    expect(claimed.task).toMatchObject({ state: 'CLAIMED', version: 2 });

    await expect(broker.task({
      action: 'start',
      roomId: created.room.id,
      agentSessionId: lead1.agentSessionId,
      taskId: assigned.task.id,
      expectedVersion: 1,
      idempotencyKey: 'lead1/ready68/start-stale',
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

    const started = value(await broker.task({
      action: 'start',
      roomId: created.room.id,
      agentSessionId: lead1.agentSessionId,
      taskId: assigned.task.id,
      expectedVersion: 2,
      idempotencyKey: 'lead1/ready68/start',
    }));
    const submitted = value(await broker.task({
      action: 'submit',
      roomId: created.room.id,
      agentSessionId: lead1.agentSessionId,
      taskId: assigned.task.id,
      expectedVersion: started.task.version,
      result: {
        summary: 'READY68 passed the frozen regression gates.',
        evidenceRefs: ['file:reports/READY68.md'],
        checkpointId: 'checkpoint-ready68',
        nextAction: 'MAIN reviews evidence and approves or rejects.',
      },
      idempotencyKey: 'lead1/ready68/submit',
    }));
    expect(submitted.task).toMatchObject({ state: 'REVIEW', version: 4, checkpointId: 'checkpoint-ready68' });

    const approved = value(await broker.task({
      action: 'approve',
      roomId: created.room.id,
      agentSessionId: main.agentSessionId,
      taskId: assigned.task.id,
      expectedVersion: submitted.task.version,
      idempotencyKey: 'main/ready68/approve',
    }));
    expect(approved.task).toMatchObject({ state: 'COMPLETED', version: 5 });
    database.close();
  });

  it('reports bounded room state and supports manual presence and resource status', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-status-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    let now = new Date('2026-08-28T03:00:00.000Z');
    const broker = new CommandRoomBroker(new SqliteCommandRoomRepository(database), () => now);

    const created = value(await broker.admin({ action: 'create', name: 'Presence Room', idempotencyKey: 'create-presence-room', leadSlots: 1 }));
    const main = value(await broker.join({ roomId: created.room.id, slotKey: 'MAIN', joinCode: created.joinCodes.MAIN, provider: 'CHATGPT', connectionEpoch: 1 }));
    const lead = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-1', joinCode: created.joinCodes['LEAD-1'], provider: 'CHATGPT', connectionEpoch: 1 }));

    now = new Date('2026-08-28T03:00:45.000Z');
    const heartbeat = value(await broker.presence({
      action: 'heartbeat',
      roomId: created.room.id,
      agentSessionId: lead.agentSessionId,
      projectKey: 'AUTOBOTS',
      workspaceId: 'workspace-autobots',
      lastCheckpointId: 'checkpoint-autobots',
    }));
    expect(heartbeat.agent).toMatchObject({
      slotKey: 'LEAD-1',
      state: 'ONLINE',
      projectKey: 'AUTOBOTS',
      workspaceId: 'workspace-autobots',
      lastCheckpointId: 'checkpoint-autobots',
      lastHeartbeatAt: now.toISOString(),
    });

    const status = value(await broker.status({
      roomId: created.room.id,
      agentSessionId: main.agentSessionId,
      taskLimit: 25,
    }));
    expect(status).toMatchObject({
      manifestVersion: '1.0.0',
      room: { id: created.room.id, status: 'ACTIVE' },
      agents: [
        { slotKey: 'MAIN', state: 'AVAILABLE' },
        { slotKey: 'LEAD-1', state: 'ONLINE', projectKey: 'AUTOBOTS' },
      ],
      tasks: [],
      workspaceLeases: { observable: false, sourceTool: 'workspace_lease_status' },
      resources: { mode: 'PHASE_1_MANUAL', entries: [] },
    });

    const resources = value(await broker.resource({
      action: 'status',
      roomId: created.room.id,
      agentSessionId: lead.agentSessionId,
    }));
    expect(resources).toMatchObject({ mode: 'PHASE_1_MANUAL', entries: [], automaticScheduling: false });

    const parked = value(await broker.presence({
      action: 'park',
      roomId: created.room.id,
      agentSessionId: lead.agentSessionId,
      lastCheckpointId: 'checkpoint-autobots',
    }));
    expect(parked.agent.state).toBe('SLEEPING');
    database.close();
  });

  it('rotates a full chat slot and supports pause/resume without losing MAIN control', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-rebind-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    const broker = new CommandRoomBroker(new SqliteCommandRoomRepository(database), () => new Date('2026-08-28T04:00:00.000Z'));

    try {
      const created = value(await broker.admin({ action: 'create', name: 'Rebind Room', idempotencyKey: 'create-rebind-room', leadSlots: 1 }));
      const main = value(await broker.join({ roomId: created.room.id, slotKey: 'MAIN', joinCode: created.joinCodes.MAIN, provider: 'CHATGPT', connectionEpoch: 1 }));
      const oldLead = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-1', joinCode: created.joinCodes['LEAD-1'], provider: 'CHATGPT', connectionEpoch: 1 }));

      const rebound = value(await broker.admin({
        action: 'rebind',
        roomId: created.room.id,
        agentSessionId: main.agentSessionId,
        targetSlotKey: 'LEAD-1',
        expectedVersion: oldLead.roomVersion,
        idempotencyKey: 'main/lead1/rebind-2',
      }));
      expect(rebound).toMatchObject({
        action: 'rebind',
        duplicate: false,
        targetSlotKey: 'LEAD-1',
        requiredConnectionEpoch: 2,
        joinCode: expect.any(String),
      });
      await expect(broker.resource({ action: 'status', roomId: created.room.id, agentSessionId: oldLead.agentSessionId }))
        .resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });

      const replacement = value(await broker.join({
        roomId: created.room.id,
        slotKey: 'LEAD-1',
        joinCode: rebound.joinCode,
        provider: 'CHATGPT',
        connectionEpoch: rebound.requiredConnectionEpoch,
      }));
      expect(replacement.agent).toMatchObject({ slotKey: 'LEAD-1', connectionEpoch: 2, state: 'AVAILABLE' });

      const paused = value(await broker.admin({
        action: 'pause',
        roomId: created.room.id,
        agentSessionId: main.agentSessionId,
        expectedVersion: replacement.roomVersion,
        idempotencyKey: 'main/room/pause-1',
      }));
      expect(paused.room.status).toBe('PAUSED');
      const pausedStatus = value(await broker.status({ roomId: created.room.id, agentSessionId: main.agentSessionId }));
      expect(pausedStatus.room.status).toBe('PAUSED');

      const resumed = value(await broker.admin({
        action: 'resume',
        roomId: created.room.id,
        agentSessionId: main.agentSessionId,
        expectedVersion: paused.roomVersion,
        idempotencyKey: 'main/room/resume-1',
      }));
      expect(resumed.room.status).toBe('ACTIVE');

      const mainRebound = value(await broker.admin({
        action: 'rebind',
        roomId: created.room.id,
        agentSessionId: main.agentSessionId,
        targetSlotKey: 'MAIN',
        expectedVersion: resumed.roomVersion,
        idempotencyKey: 'main/self/rebind-2',
      }));
      expect(mainRebound).toMatchObject({
        action: 'rebind',
        targetSlotKey: 'MAIN',
        requiredConnectionEpoch: 2,
        joinCode: expect.any(String),
      });
      await expect(broker.status({ roomId: created.room.id, agentSessionId: main.agentSessionId }))
        .resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });

      const replacementMain = value(await broker.join({
        roomId: created.room.id,
        slotKey: 'MAIN',
        joinCode: mainRebound.joinCode,
        provider: 'CHATGPT',
        connectionEpoch: mainRebound.requiredConnectionEpoch,
      }));
      expect(replacementMain.agent).toMatchObject({ slotKey: 'MAIN', connectionEpoch: 2, state: 'AVAILABLE' });
    } finally {
      database.close();
    }
  });

  it('requires a joined session heartbeat before resume authority becomes ready', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-resume-authority-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    const broker = new CommandRoomBroker(new SqliteCommandRoomRepository(database), () => new Date('2026-08-30T10:00:00.000Z'));

    try {
      const created = value(await broker.admin({ action: 'create', name: 'Resume Authority Room', idempotencyKey: 'create-resume-authority', leadSlots: 1 }));
      const missing = value(await broker.status({
        action: 'resume_check', roomId: created.room.id, slotKey: 'LEAD-2', connectionEpoch: 0,
      }));
      expect(missing).toMatchObject({ action: 'resume_check', authority: 'SLOT_NOT_FOUND' });

      const unjoined = value(await broker.status({
        action: 'resume_check', roomId: created.room.id, slotKey: 'LEAD-1', connectionEpoch: 0,
      }));
      expect(unjoined).toMatchObject({
        action: 'resume_check', authority: 'CREATE_SESSION_REQUIRED', requiredConnectionEpoch: 1,
        bootstrap: { roomId: created.room.id, slotKey: 'LEAD-1', connectionEpoch: 0 },
      });

      const main = value(await broker.join({ roomId: created.room.id, slotKey: 'MAIN', joinCode: created.joinCodes.MAIN, provider: 'CHATGPT', connectionEpoch: 1 }));
      const lead = value(await broker.join({ roomId: created.room.id, slotKey: 'LEAD-1', joinCode: created.joinCodes['LEAD-1'], provider: 'CHATGPT', connectionEpoch: 1 }));
      expect(lead.agent.state).toBe('AVAILABLE');

      const beforeHeartbeat = value(await broker.status({
        action: 'resume_check', roomId: created.room.id, slotKey: 'LEAD-1', connectionEpoch: 1, agentSessionId: lead.agentSessionId,
      }));
      expect(beforeHeartbeat).toMatchObject({ action: 'resume_check', authority: 'HEARTBEAT_REQUIRED' });

      const heartbeat = value(await broker.presence({
        action: 'heartbeat', roomId: created.room.id, agentSessionId: lead.agentSessionId, projectKey: 'resume-authority',
      }));
      const ready = value(await broker.status({
        action: 'resume_check', roomId: created.room.id, slotKey: 'LEAD-1', connectionEpoch: 1, agentSessionId: lead.agentSessionId,
      }));
      expect(ready).toMatchObject({
        action: 'resume_check', authority: 'READY',
        agent: { slotKey: 'LEAD-1', connectionEpoch: 1, state: 'ONLINE', lastHeartbeatAt: expect.any(String) },
        bootstrap: { roomId: created.room.id, slotKey: 'LEAD-1', connectionEpoch: 1 },
      });
      expect(JSON.stringify(ready.bootstrap)).not.toContain(lead.agentSessionId);
      expect(JSON.stringify(ready.bootstrap)).not.toContain(created.joinCodes['LEAD-1']);

      value(await broker.admin({
        action: 'rebind', roomId: created.room.id, agentSessionId: main.agentSessionId, targetSlotKey: 'LEAD-1',
        expectedVersion: heartbeat.roomVersion, idempotencyKey: 'rotate-resume-authority',
      }));
      const staleSessionCalls = await Promise.all([
        broker.status({
          action: 'resume_check', roomId: created.room.id, slotKey: 'LEAD-1', connectionEpoch: 1, agentSessionId: lead.agentSessionId,
        }),
        broker.status({ roomId: created.room.id, agentSessionId: lead.agentSessionId }),
        broker.send({
          roomId: created.room.id, agentSessionId: lead.agentSessionId, targetSlotKey: 'MAIN', kind: 'UPDATE',
          subject: 'stale session', summary: 'must fail before storage mutation', idempotencyKey: 'stale-session/send',
        }),
        broker.inbox({ action: 'read', roomId: created.room.id, agentSessionId: lead.agentSessionId }),
        broker.task({
          action: 'claim', roomId: created.room.id, agentSessionId: lead.agentSessionId,
          taskId: '00000000-0000-4000-8000-000000000001', expectedVersion: 1, idempotencyKey: 'stale-session/task',
        }),
        broker.presence({ action: 'heartbeat', roomId: created.room.id, agentSessionId: lead.agentSessionId }),
        broker.resource({ action: 'status', roomId: created.room.id, agentSessionId: lead.agentSessionId }),
        broker.admin({
          action: 'pause', roomId: created.room.id, agentSessionId: lead.agentSessionId,
          expectedVersion: heartbeat.roomVersion + 1, idempotencyKey: 'stale-session/admin',
        }),
      ]);
      expect(staleSessionCalls).toHaveLength(8);
      for (const result of staleSessionCalls) {
        expect(result).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
      }
    } finally {
      database.close();
    }
  });

  it('hides all eight MCP tools by default and runs the manual flow when explicitly enabled', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-command-room-tools-'));
    temporaryRoots.push(root);
    const database = new SqliteDatabase(path.join(root, 'state.db'));
    const broker = new CommandRoomBroker(new SqliteCommandRoomRepository(database), () => new Date('2026-08-28T05:00:00.000Z'));
    const actor = { clientId: 'command-room-test', clientName: 'Command Room test' };

    try {
      const hidden = new ToolRegistry({ commandRoom: broker }, actor);
      const enabled = new ToolRegistry({ commandRoom: broker }, actor, { commandRoomEnabled: true });
      expect(hidden.list().filter((tool) => tool.name.startsWith('command_room_'))).toHaveLength(0);
      expect(enabled.list().filter((tool) => tool.name.startsWith('command_room_')).map((tool) => tool.name)).toEqual([
        'command_room_join',
        'command_room_status',
        'command_room_inbox',
        'command_room_send',
        'command_room_task',
        'command_room_presence',
        'command_room_resource',
        'command_room_admin',
      ]);
      expect(enabled.list()).toHaveLength(hidden.list().length + 8);

      const invalid = await enabled.invoke('command_room_admin', {
        action: 'create',
        name: '',
        idempotencyKey: 'invalid-name',
      });
      expect(invalid).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'INVALID_INPUT', message: expect.stringContaining('name') } },
      });

      const created = responseRecord(await enabled.invoke('command_room_admin', {
        action: 'create',
        name: 'MCP Room',
        idempotencyKey: 'create-mcp-room',
        leadSlots: 1,
      }));
      const room = nestedRecord(created, 'room');
      const joinCodes = nestedRecord(created, 'joinCodes');
      const roomId = stringField(room, 'id');
      const main = responseRecord(await enabled.invoke('command_room_join', {
        roomId,
        slotKey: 'MAIN',
        joinCode: stringField(joinCodes, 'MAIN'),
        provider: 'CHATGPT',
        connectionEpoch: 1,
      }));
      const lead = responseRecord(await enabled.invoke('command_room_join', {
        roomId,
        slotKey: 'LEAD-1',
        joinCode: stringField(joinCodes, 'LEAD-1'),
        provider: 'CHATGPT',
        connectionEpoch: 1,
      }));
      const heartbeatRequired = responseRecord(await enabled.invoke('command_room_status', {
        action: 'resume_check', roomId, slotKey: 'LEAD-1', connectionEpoch: 1,
        agentSessionId: stringField(lead, 'agentSessionId'),
      }));
      expect(heartbeatRequired).toMatchObject({ action: 'resume_check', authority: 'HEARTBEAT_REQUIRED' });
      responseRecord(await enabled.invoke('command_room_presence', {
        action: 'heartbeat', roomId, agentSessionId: stringField(lead, 'agentSessionId'), projectKey: 'mcp-room',
      }));
      const resumeReady = responseRecord(await enabled.invoke('command_room_status', {
        action: 'resume_check', roomId, slotKey: 'LEAD-1', connectionEpoch: 1,
        agentSessionId: stringField(lead, 'agentSessionId'),
      }));
      expect(resumeReady).toMatchObject({ action: 'resume_check', authority: 'READY' });
      const addedLead = responseRecord(await enabled.invoke('command_room_admin', {
        action: 'add_lead',
        roomId,
        agentSessionId: stringField(main, 'agentSessionId'),
        expectedVersion: numberField(resumeReady, 'roomVersion'),
        idempotencyKey: 'main/manual/add-lead-2',
      }));
      expect(addedLead).toMatchObject({ action: 'add_lead', targetSlotKey: 'LEAD-2', requiredConnectionEpoch: 1, joinCode: expect.any(String) });

      const sent = responseRecord(await enabled.invoke('command_room_send', {
        roomId,
        agentSessionId: stringField(main, 'agentSessionId'),
        targetSlotKey: 'LEAD-1',
        kind: 'UPDATE',
        subject: 'Manual flow',
        summary: 'The fixed tool surface is reachable through ToolRegistry.',
        idempotencyKey: 'main/manual/update-1',
      }));
      const inbox = responseRecord(await enabled.invoke('command_room_inbox', {
        action: 'read',
        roomId,
        agentSessionId: stringField(lead, 'agentSessionId'),
        limit: 25,
      }));
      expect(sent).toMatchObject({ duplicate: false, manifestVersion: '1.0.0' });
      expect(inbox).toMatchObject({ action: 'read', messages: [expect.objectContaining({ subject: 'Manual flow' })] });
    } finally {
      database.close();
    }
  });

});

function responseRecord(response: { readonly isError?: boolean; readonly structuredContent?: unknown }): Record<string, unknown> {
  if (response.isError === true || !isRecord(response.structuredContent)) throw new Error('Expected successful MCP structured content');
  return response.structuredContent;
}

function nestedRecord(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const nested = value[field];
  if (!isRecord(nested)) throw new Error(`Expected object field: ${field}`);
  return nested;
}

function stringField(value: Record<string, unknown>, field: string): string {
  const entry = value[field];
  if (typeof entry !== 'string') throw new Error(`Expected string field: ${field}`);
  return entry;
}

function numberField(value: Record<string, unknown>, field: string): number {
  const entry = value[field];
  if (typeof entry !== 'number' || !Number.isFinite(entry)) throw new Error(`Expected number field: ${field}`);
  return entry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
