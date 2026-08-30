
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { CommandRoomExtensionAgentSummary, CommandRoomExtensionOverview, CommandRoomOverview, CreateCommandRoomPairingResult, CreateCommandRoomResult, UiLocale } from '@lnwjud/ipc-contracts';
import { copyTextToClipboard } from '../../clipboard.js';

interface CommandRoomPageProps {
  readonly locale: UiLocale;
}

export function CommandRoomPage({ locale }: CommandRoomPageProps): ReactElement {
  const [overview, setOverview] = useState<CommandRoomOverview>({ rooms: [] });
  const [extensionOverview, setExtensionOverview] = useState<CommandRoomExtensionOverview>({
    bridge: { enabled: false, running: false, url: null, allowedOrigins: [], message: null },
    agents: [],
  });
  const [extensionOrigin, setExtensionOrigin] = useState('');
  const [pairing, setPairing] = useState<CreateCommandRoomPairingResult | null>(null);
  const [roomName, setRoomName] = useState('NAVA Command Room');
  const [created, setCreated] = useState<CreateCommandRoomResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [rooms, extension] = await Promise.all([
        window.lnwjud.getCommandRoomOverview(),
        window.lnwjud.getCommandRoomExtensionOverview(),
      ]);
      setOverview(rooms);
      setExtensionOverview(extension);
      setExtensionOrigin((current) => current.trim().length > 0 ? current : extension.bridge.allowedOrigins[0] ?? '');
      setError(null);
    } catch (cause: unknown) {
      setError(message(cause, text(locale, 'โหลด Command Room ไม่สำเร็จ', 'Could not load Command Rooms')));
    }
  }, [locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function deleteRoom(roomId: string, roomName: string): Promise<void> {
    const confirmed = window.confirm(text(locale, `ลบห้อง “${roomName}” ถาวรหรือไม่? ข้อมูล tasks/messages ของห้องนี้จะถูกลบด้วย`, `Permanently delete “${roomName}”? Its tasks and messages will also be deleted.`));
    if (!confirmed) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await window.lnwjud.deleteCommandRoom({ roomId });
      if (!result.deleted) throw new Error(text(locale, 'ไม่พบห้องหรือห้องถูกลบไปแล้ว', 'Room was not found or was already deleted'));
      if (created?.room.id === roomId) setCreated(null);
      setNotice(text(locale, `ลบห้อง “${roomName}” แล้ว`, `Deleted “${roomName}”.`));
      await refresh();
    } catch (cause: unknown) {
      setError(message(cause, text(locale, 'ลบ Command Room ไม่สำเร็จ', 'Could not delete Command Room')));
    } finally {
      setBusy(false);
    }
  }

  async function deleteArchivedRooms(): Promise<void> {
    const deletable = overview.rooms.filter((room) => room.status === 'ARCHIVED' && room.writerLeases.length === 0 && room.resourceLeases.length === 0 && room.resourceQueueDepth === 0);
    if (deletable.length === 0) return;
    const confirmed = window.confirm(text(locale, `ลบห้อง Archived ที่ไม่ใช้งานทั้ง ${deletable.length} ห้องถาวรหรือไม่?`, `Permanently delete all ${deletable.length} unused archived rooms?`));
    if (!confirmed) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      let deleted = 0;
      for (const room of deletable) {
        const result = await window.lnwjud.deleteCommandRoom({ roomId: room.id });
        if (result.deleted) deleted += 1;
      }
      if (created !== null && deletable.some((room) => room.id === created.room.id)) setCreated(null);
      setNotice(text(locale, `ลบห้อง Archived แล้ว ${deleted} ห้อง`, `Deleted ${deleted} archived rooms.`));
      await refresh();
    } catch (cause: unknown) {
      setError(message(cause, text(locale, 'ลบห้อง Archived ไม่สำเร็จครบทุกห้อง', 'Could not delete all archived rooms')));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setExtensionConfig(enabled: boolean): Promise<void> {
    const origin = extensionOrigin.trim();
    if (enabled && origin.length === 0) {
      setError(text(locale, 'ใส่ chrome-extension://... ก่อนเปิด Extension Wake', 'Enter chrome-extension://... before enabling Extension Wake.'));
      return;
    }
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const bridge = await window.lnwjud.setCommandRoomExtensionConfig({
        enabled,
        allowedOrigins: origin.length === 0 ? extensionOverview.bridge.allowedOrigins : [origin],
      });
      setExtensionOverview((current) => ({ ...current, bridge }));
      setNotice(enabled
        ? text(locale, bridge.running ? 'เปิด Extension Wake แล้ว' : 'บันทึก Extension Wake แล้ว แต่ Bridge ยังไม่พร้อม', bridge.running ? 'Extension Wake is enabled.' : 'Extension Wake is enabled, but the Bridge is not ready yet.')
        : text(locale, 'ปิด Extension Wake แล้ว', 'Extension Wake is disabled.'));
      await refresh();
    } catch (cause: unknown) {
      setError(message(cause, text(locale, 'ตั้งค่า Extension Wake ไม่สำเร็จ', 'Could not configure Extension Wake')));
    } finally {
      setBusy(false);
    }
  }

  async function createPairing(roomId: string, slotKey: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await window.lnwjud.createCommandRoomPairing({ roomId, slotKey });
      setPairing(result);
      setNotice(text(locale, `สร้าง Pairing สำหรับ ${slotKey} แล้ว กดคัดลอกภายในเวลาที่กำหนด`, `Pairing for ${slotKey} is ready. Copy it before it expires.`));
      await refresh();
    } catch (cause: unknown) {
      setError(message(cause, text(locale, 'สร้าง Pairing ไม่สำเร็จ', 'Could not create pairing')));
    } finally {
      setBusy(false);
    }
  }

  async function wakeAgent(roomId: string, slotKey: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await window.lnwjud.wakeCommandRoomAgent({ roomId, slotKey });
      setNotice(text(locale, `Wake ${slotKey}: ${result.outcome}`, `Wake ${slotKey}: ${result.outcome}`));
      await refresh();
    } catch (cause: unknown) {
      setError(message(cause, text(locale, 'ส่ง Wake ไม่สำเร็จ', 'Could not queue wake')));
    } finally {
      setBusy(false);
    }
  }

  async function revokeBinding(roomId: string, slotKey: string): Promise<void> {
    const confirmed = window.confirm(text(locale, `ยกเลิก Browser Pairing ของ ${slotKey} หรือไม่?`, `Revoke browser pairing for ${slotKey}?`));
    if (!confirmed) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await window.lnwjud.revokeCommandRoomExtensionBinding({ roomId, slotKey });
      if (pairing?.roomId === roomId && pairing.slotKey === slotKey) setPairing(null);
      setNotice(result.revoked
        ? text(locale, `ยกเลิก Pairing ของ ${slotKey} แล้ว`, `Pairing for ${slotKey} was revoked.`)
        : text(locale, `ไม่พบ Pairing ของ ${slotKey}`, `No pairing was found for ${slotKey}.`));
      await refresh();
    } catch (cause: unknown) {
      setError(message(cause, text(locale, 'ยกเลิก Pairing ไม่สำเร็จ', 'Could not revoke pairing')));
    } finally {
      setBusy(false);
    }
  }

  async function createRoom(): Promise<void> {
    const name = roomName.trim();
    if (name.length === 0) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await window.lnwjud.createCommandRoom({ name });
      setCreated(result);
      setNotice(text(locale, 'สร้างห้อง Main 1 + Project Lead 5 แล้ว เก็บรหัสด้านล่างก่อนออกจากหน้านี้', 'Main 1 + Project Lead 5 room created. Save the one-time codes before leaving this page.'));
      await refresh();
    } catch (cause: unknown) {
      setError(message(cause, text(locale, 'สร้าง Command Room ไม่สำเร็จ', 'Could not create Command Room')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-content command-room-page">
      <div className="page-heading">
        <div>
          <h1>{text(locale, 'ห้องบัญชาการ', 'Command Room')}</h1>
          <p className="page-subtitle">
            {text(locale, 'Main 1 คนควบคุมงาน และ Project Lead สูงสุด 5 คนทำงานแยกโปรเจกต์', 'One Main coordinates up to five Project Leads across separate projects.')}
          </p>
        </div>
        <button type="button" onClick={() => { void refresh(); }} disabled={busy}>
          {text(locale, 'รีเฟรช', 'Refresh')}
        </button>
      </div>

      {error === null ? null : <div className="error-banner" role="alert">{error}</div>}
      {notice === null ? null : <div className="command-room-notice" role="status">{notice}</div>}

      <section className="panel command-room-create">
        <div className="section-heading">
          <div>
            <h2>{text(locale, 'สร้างห้องใหม่', 'Create a room')}</h2>
            <p className="hint">{text(locale, 'Preset คงที่: MAIN 1 + LEAD 1–5', 'Fixed preset: MAIN 1 + LEAD 1–5')}</p>
          </div>
        </div>
        <label className="field-label" htmlFor="command-room-name">{text(locale, 'ชื่อห้อง', 'Room name')}</label>
        <div className="form-row">
          <input
            id="command-room-name"
            maxLength={120}
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
          />
          <button type="button" onClick={() => { void createRoom(); }} disabled={busy || roomName.trim().length === 0}>
            {busy ? text(locale, 'กำลังสร้าง…', 'Creating…') : text(locale, 'สร้าง Main 1 + Lead 5', 'Create Main 1 + Lead 5')}
          </button>
        </div>
      </section>

      {created === null ? null : (
        <section className="panel command-room-codes" aria-labelledby="one-time-codes-title">
          <div className="section-heading">
            <div>
              <h2 id="one-time-codes-title">{text(locale, 'รหัสเข้าห้องแบบครั้งเดียว', 'One-time join codes')}</h2>
              <p className="hint">{text(locale, 'NAVA จะไม่แสดงรหัสชุดนี้อีกหลังรีเฟรช', 'NAVA will not show these codes again after refresh.')}</p>
            </div>
            <button type="button" onClick={() => setCreated(null)}>{text(locale, 'ซ่อนรหัส', 'Hide codes')}</button>
          </div>
          <div className="command-room-code-grid">
            {Object.entries(created.joinCodes).map(([slotKey, joinCode]) => {
              const prompt = bootPrompt(locale, created.room.id, slotKey, joinCode);
              return (
                <article className="command-room-code-card" key={slotKey}>
                  <div className="command-room-code-heading">
                    <strong>{slotKey}</strong>
                    <span>{slotKey === 'MAIN' ? 'Main Agent' : 'Project Lead'}</span>
                  </div>
                  <code>{joinCode}</code>
                  <button type="button" onClick={() => { void copyTextToClipboard(prompt); }}>
                    {text(locale, 'คัดลอก Boot Prompt', 'Copy boot prompt')}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="panel command-room-extension" aria-labelledby="command-room-extension-title">
        <div className="section-heading">
          <div>
            <h2 id="command-room-extension-title">{text(locale, 'Browser Extension Wake (Phase 3)', 'Browser Extension Wake (Phase 3)')}</h2>
            <p className="hint">
              {text(locale, 'Bridge เป็น loopback-only และไม่เปิด generic MCP/tool proxy', 'The Bridge is loopback-only and never exposes a generic MCP/tool proxy.')}
            </p>
          </div>
          <span className={`command-room-status ${extensionOverview.bridge.running ? 'status-active' : 'status-archived'}`}>
            {extensionOverview.bridge.running ? 'BRIDGE ONLINE' : extensionOverview.bridge.enabled ? 'BRIDGE ERROR' : 'OPT-IN OFF'}
          </span>
        </div>
        <div className="form-row">
          <input
            aria-label={text(locale, 'Extension origin', 'Extension origin')}
            placeholder="chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            value={extensionOrigin}
            onChange={(event) => setExtensionOrigin(event.target.value)}
            disabled={busy}
          />
          <button type="button" onClick={() => { void setExtensionConfig(true); }} disabled={busy || extensionOverview.bridge.running}>
            {text(locale, 'เปิด Extension Wake', 'Enable Extension Wake')}
          </button>
          <button type="button" onClick={() => { void setExtensionConfig(false); }} disabled={busy || !extensionOverview.bridge.enabled}>
            {text(locale, 'ปิด', 'Disable')}
          </button>
        </div>
        <div className="command-room-resource-metrics">
          <span>{text(locale, 'Bridge', 'Bridge')} <strong>{extensionOverview.bridge.url ?? 'OFFLINE'}</strong></span>
          <span>{text(locale, 'Origins', 'Origins')} <strong>{extensionOverview.bridge.allowedOrigins.length}</strong></span>
        </div>
        {extensionOverview.bridge.message === null ? null : <div className="error-banner" role="alert">{extensionOverview.bridge.message}</div>}
        {pairing === null ? null : (
          <div className="command-room-notice" role="status">
            <strong>{text(locale, `Pairing พร้อมสำหรับ ${pairing.slotKey}`, `Pairing ready for ${pairing.slotKey}`)}</strong>
            <span>{text(locale, `หมดอายุ ${formatDate(pairing.expiresAt, locale)} — secret จะไม่ถูกแสดงบนหน้าจอ`, `Expires ${formatDate(pairing.expiresAt, locale)} — the secret is never rendered on screen.`)}</span>
            <div className="command-room-room-actions">
              <button type="button" onClick={() => { void copyTextToClipboard(pairingPayload(pairing)); }}>
                {text(locale, 'คัดลอก Pairing Payload', 'Copy pairing payload')}
              </button>
              <button type="button" onClick={() => setPairing(null)}>{text(locale, 'ล้าง Pairing', 'Clear pairing')}</button>
            </div>
          </div>
        )}
        <p className="hint">{text(locale, 'DELIVERED / SUBMITTED เป็นสถานะ browser เท่านั้น; TASK_CLAIMED ต้องเกิดจาก agent กลับมา claim งานจริง', 'DELIVERED / SUBMITTED are browser states only; TASK_CLAIMED requires the agent to actually return and claim the task.')}</p>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{text(locale, 'ห้องทั้งหมด', 'Rooms')}</h2>
            <p className="hint">{text(locale, 'หน้า overview ไม่มี join code หรือ session secret', 'Overview never contains join codes or session secrets.')}</p>
          </div>
          <div className="command-room-room-actions">
            <span className="command-room-count">{overview.rooms.length}</span>
            <button
              type="button"
              className="danger-soft-button"
              disabled={busy || overview.rooms.every((room) => room.status !== 'ARCHIVED' || room.writerLeases.length > 0 || room.resourceLeases.length > 0 || room.resourceQueueDepth > 0)}
              onClick={() => { void deleteArchivedRooms(); }}
            >
              {text(locale, 'ลบ Archived ทั้งหมด', 'Delete all archived')}
            </button>
          </div>
        </div>
        {overview.rooms.length === 0 ? (
          <p className="empty-state">{text(locale, 'ยังไม่มี Command Room', 'No Command Rooms yet.')}</p>
        ) : (
          <div className="command-room-list">
            {overview.rooms.map((room) => (
              <article className="command-room-room" key={room.id}>
                <header>
                  <div>
                    <h3>{room.name}</h3>
                    <p>{text(locale, 'อัปเดต', 'Updated')} {formatDate(room.updatedAt, locale)}</p>
                  </div>
                  <div className="command-room-room-actions">
                    <span className={`command-room-status status-${room.status.toLowerCase()}`}>{room.status}</span>
                    <button
                      type="button"
                      className="danger-soft-button"
                      disabled={busy || room.status !== 'ARCHIVED' || room.writerLeases.length > 0 || room.resourceLeases.length > 0 || room.resourceQueueDepth > 0}
                      title={room.status === 'ARCHIVED' ? text(locale, 'ลบห้องถาวร', 'Delete room permanently') : text(locale, 'Archive ห้องก่อนจึงจะลบได้', 'Archive the room before deleting it')}
                      onClick={() => { void deleteRoom(room.id, room.name); }}
                    >
                      {text(locale, 'ลบห้อง', 'Delete room')}
                    </button>
                  </div>
                </header>
                <div className="command-room-agent-grid">
                  {room.agents.map((agent) => {
                    const extensionAgent = findExtensionAgent(extensionOverview, room.id, agent.slotKey);
                    const canRevoke = extensionAgent !== undefined && extensionAgent.bindingId !== undefined
                      && !['UNPAIRED', 'REVOKED', 'REPLACED'].includes(extensionAgent.bindingState);
                    return (
                      <div className="command-room-agent" key={agent.slotKey}>
                        <strong>{agent.slotKey}</strong>
                        <span>{agent.state}</span>
                        <small>{agent.projectKey ?? text(locale, 'ยังไม่ผูกโปรเจกต์', 'No project bound')}</small>
                        <small>Browser · {extensionAgent?.bindingState ?? 'UNPAIRED'} · epoch {extensionAgent?.connectionEpoch ?? 0}</small>
                        {extensionAgent?.lastWake === undefined ? null : (
                          <small>Wake · {extensionAgent.lastWake.state} · attempt {extensionAgent.lastWake.attemptCount}</small>
                        )}
                        <div className="command-room-room-actions">
                          <button
                            type="button"
                            disabled={busy || !extensionOverview.bridge.running || extensionAgent?.bindingState === 'PAIRED'}
                            onClick={() => { void createPairing(room.id, agent.slotKey); }}
                          >
                            {text(locale, 'Pair', 'Pair')}
                          </button>
                          <button
                            type="button"
                            disabled={busy || !extensionOverview.bridge.running || extensionAgent?.bindingState !== 'PAIRED'}
                            onClick={() => { void wakeAgent(room.id, agent.slotKey); }}
                          >
                            {text(locale, 'Wake', 'Wake')}
                          </button>
                          <button
                            type="button"
                            className="danger-soft-button"
                            disabled={busy || !canRevoke}
                            onClick={() => { void revokeBinding(room.id, agent.slotKey); }}
                          >
                            {text(locale, 'Revoke', 'Revoke')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="command-room-resource-board">
                  <div className="command-room-resource-metrics">
                    <span>{text(locale, 'Writer กำลังใช้', 'Active writers')} <strong>{room.writerLeases.length}</strong></span>
                    <span>{text(locale, 'ทรัพยากรกำลังใช้', 'Active resources')} <strong>{room.resourceLeases.length}</strong></span>
                    <span>{text(locale, 'คิวทรัพยากร', 'Resource queue')} <strong>{room.resourceQueueDepth}</strong></span>
                  </div>
                  {room.writerLeases.length === 0 && room.resourceLeases.length === 0 ? (
                    <small>{text(locale, 'ไม่มี lease ที่กำลังใช้งาน', 'No active leases')}</small>
                  ) : (
                    <ul>
                      {room.writerLeases.map((lease) => (
                        <li key={`writer-${lease.workspaceId}`}>
                          <span>WRITE · {lease.ownerSlotKey}</span>
                          <small>{lease.workspaceId} · {text(locale, 'หมดอายุ', 'expires')} {formatDate(lease.expiresAt, locale)}</small>
                        </li>
                      ))}
                      {room.resourceLeases.map((lease) => (
                        <li key={`resource-${lease.resourceKey}-${lease.taskId}`}>
                          <span>{lease.resourceKey} · {lease.ownerSlotKey}</span>
                          <small>{lease.units} unit · {text(locale, 'หมดอายุ', 'expires')} {formatDate(lease.expiresAt, locale)}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="command-room-task-list">
                  <strong>{text(locale, 'งานล่าสุด', 'Recent tasks')} ({room.tasks.length})</strong>
                  {room.tasks.length === 0 ? <span>{text(locale, 'ยังไม่มีงาน', 'No tasks')}</span> : (
                    <ul>
                      {room.tasks.slice(0, 5).map((task) => (
                        <li key={task.id}>
                          <span>{task.title}</span>
                          <small>{task.assignedSlotKey ?? 'MAIN'} · {task.state} · {task.mutationMode}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function findExtensionAgent(overview: CommandRoomExtensionOverview, roomId: string, slotKey: string): CommandRoomExtensionAgentSummary | undefined {
  return overview.agents.find((agent) => agent.roomId === roomId && agent.slotKey === slotKey);
}

function pairingPayload(pairing: CreateCommandRoomPairingResult): string {
  return JSON.stringify({
    protocolVersion: 1,
    bridgeUrl: pairing.bridgeUrl,
    roomId: pairing.roomId,
    slotKey: pairing.slotKey,
    bindingId: pairing.bindingId,
    challenge: pairing.challenge,
    expiresAt: pairing.expiresAt,
    connectionEpoch: pairing.connectionEpoch,
    allowedOrigins: pairing.allowedOrigins,
  }, null, 2);
}

function bootPrompt(locale: UiLocale, roomId: string, slotKey: string, joinCode: string): string {
  if (locale === 'th') {
    return `คุณคือ ${slotKey} ใน NAVA Command Room ให้เรียก command_room_join ด้วย roomId="${roomId}", slotKey="${slotKey}", joinCode="${joinCode}", provider="CHATGPT", connectionEpoch=1 จากนั้นเรียก command_room_presence heartbeat และตรวจ inbox เป็นระยะ ห้ามส่งต่อ joinCode หรือ agentSessionId`;
  }
  return `You are ${slotKey} in a NAVA Command Room. Call command_room_join with roomId="${roomId}", slotKey="${slotKey}", joinCode="${joinCode}", provider="CHATGPT", connectionEpoch=1. Then send command_room_presence heartbeats and check the inbox periodically. Never forward the joinCode or agentSessionId.`;
}

function formatDate(value: string, locale: UiLocale): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale === 'th' ? 'th-TH' : 'en-US');
}

function text(locale: UiLocale, th: string, en: string): string {
  return locale === 'th' ? th : en;
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}
