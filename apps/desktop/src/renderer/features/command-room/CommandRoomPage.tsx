import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { CommandRoomOverview, CreateCommandRoomResult, UiLocale } from '@lnwjud/ipc-contracts';
import { copyTextToClipboard } from '../../clipboard.js';

interface CommandRoomPageProps {
  readonly locale: UiLocale;
}

export function CommandRoomPage({ locale }: CommandRoomPageProps): ReactElement {
  const [overview, setOverview] = useState<CommandRoomOverview>({ rooms: [] });
  const [roomName, setRoomName] = useState('NAVA Command Room');
  const [created, setCreated] = useState<CreateCommandRoomResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setOverview(await window.lnwjud.getCommandRoomOverview());
      setError(null);
    } catch (cause: unknown) {
      setError(message(cause, text(locale, 'โหลด Command Room ไม่สำเร็จ', 'Could not load Command Rooms')));
    }
  }, [locale]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>{text(locale, 'ห้องทั้งหมด', 'Rooms')}</h2>
            <p className="hint">{text(locale, 'หน้า overview ไม่มี join code หรือ session secret', 'Overview never contains join codes or session secrets.')}</p>
          </div>
          <span className="command-room-count">{overview.rooms.length}</span>
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
                  <span className={`command-room-status status-${room.status.toLowerCase()}`}>{room.status}</span>
                </header>
                <div className="command-room-agent-grid">
                  {room.agents.map((agent) => (
                    <div className="command-room-agent" key={agent.slotKey}>
                      <strong>{agent.slotKey}</strong>
                      <span>{agent.state}</span>
                      <small>{agent.projectKey ?? text(locale, 'ยังไม่ผูกโปรเจกต์', 'No project bound')}</small>
                    </div>
                  ))}
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
