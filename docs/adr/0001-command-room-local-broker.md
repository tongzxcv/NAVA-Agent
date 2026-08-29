# ADR-0001: Local-first Command Room broker สำหรับ Main 1 + reusable Lead 5

- Status: Proposed
- Date: 2026-08-28
- Owners: NAVA Agent
- Decision scope: Multi-chat and multi-project orchestration

## Context

ผู้ใช้ทำงาน 2–3 โปรเจกต์พร้อมกันผ่าน ChatGPT/NAVA และมีงาน EA, MT5, Git, VPS และ browser ที่ใช้ทรัพยากรร่วมกัน แชทอาจอยู่ในหรืออยู่นอก ChatGPT Project และอาจเต็มก่อนสรุป checkpoint

NAVA v4.11.0 มี SQLite WAL, audit/activity, continuity checkpoint, durable tasks และ writer lease ต่อ workspace แล้ว แต่ยังไม่มี room broker, participant identity, task assignment, delivery acknowledgement, shared resource scheduler หรือ worker wake-up

agent_swarm_run ปัจจุบันเป็น planned capability ไม่ใช่ agent executor จริง และ parallel_delegate เป็นแผนเท่านั้น

## Decision

สร้าง Command Room ภายใน NAVA เดิมด้วย SQLite local-first และ application services ใหม่

- topology เป็น Main 1 + Lead slots 5
- Lead slots reusable และไม่ผูกชื่อโปรเจกต์ถาวร
- ค่าเริ่มต้น active Leads 3, writers 2 คนละ workspace, heavy tasks 2
- Main เป็น read-only coordinator โดยค่าเริ่มต้น
- room identity แยกจาก ChatGPT Project จึงใช้ได้กับ normal chat
- ใช้ existing workspace lease เป็น writer source of truth เดียว
- เพิ่ม resource leases แยกสำหรับ MT5 terminal, VPS, browser, GPU
- migration 006 เก็บ resource request queue แบบ durable ใน `command_room_resource_requests` เพราะสถานะ QUEUED, idempotency และลำดับ priority + aging ทุก 5 นาที + FIFO ไม่สามารถ reconstruct จาก active leases อย่างเดียวหลัง restart ได้; queue จะ promote เฉพาะเมื่อเจ้าของ request เรียกซ้ำหลัง capacity ว่าง และห้าม auto-retry mutation
- ใช้ immutable messages + receipts/cursors, task state machine, idempotency และ optimistic versioning
- อ้าง session checkpoints และ durable task IDs แทนการเก็บ raw logs/transcripts
- เพิ่ม MCP tools คงที่ 8 tools และ typed Desktop IPC/UI
- ทำ manual mode ก่อน; Chrome extension เป็น opt-in สำหรับ conversation binding และ event wake-up
- Codex เป็น optional provider และไม่มี automatic quota substitution
- ใช้ additive migrations 005–007 พร้อม pre-migration backup
- ทุก filesystem/process/live/destructive action ยังอยู่ใต้ permission, workspace root, writer lease และ human confirmation เดิม

รายละเอียดเต็มอยู่ที่ [NAVA Command Room design](../architecture/NAVA_COMMAND_ROOM_DESIGN_TH.md)

## Why this decision

- ใช้ฐาน SQLite/WAL/lease/continuity ที่พิสูจน์แล้ว ลด implementation และ migration risk
- แก้ปัญหาแชทเต็มด้วย durable state ไม่ใช่ copy transcript
- ป้องกันการเขียนทับกันโดยไม่สร้าง writer lock ซ้อน
- รองรับแชทปกติและ Project chat แบบเดียวกัน
- แยก resource collision ของ MT5/VPS ออกจาก file collision อย่างถูกต้อง
- manual mode ใช้ได้แม้ browser extension เสีย
- ไม่สร้าง cloud dependency หรือ service ที่ต้องดูแลเพิ่ม

## Consequences

### Positive

- Main เห็นสถานะทุกโปรเจกต์จากจุดเดียว
- Lead เปลี่ยนโปรเจกต์หรือเปลี่ยนแชทโดยยังใช้ slot/checkpoint เดิมได้
- งานอ่านขนานได้และงานเขียนถูก serialize เฉพาะ workspace ที่ชนกัน
- มี audit/recovery/idempotency ที่ตรวจสอบได้
- สามารถเพิ่ม provider ภายหลังโดยไม่เปลี่ยน broker schema หลัก

### Negative

- ChatGPT ไม่ตื่นเองอย่างเชื่อถือได้หากไม่มี user action หรือ extension
- extension ผูกกับ UI ภายนอก จึงต้อง experimental, fail closed และมี manual fallback
- เพิ่ม SQLite schema, IPC และ state-machine complexity
- room identity เป็น coordination identity ไม่ใช่ security authority ของ filesystem
- ต้องมี cleanup/reconciliation ของ stale agents, receipts และ leases

### Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| wrong chat/slot impersonation | one-time join code, connectionEpoch, optional extension pairing, no permission escalation |
| duplicate task/result | idempotencyKey + expectedVersion |
| checkpoint ขณะถือ writer lease ถูกปฏิเสธ | route session_checkpoint ผ่าน existing workspace_lease_call และทดสอบ envelope ใน bundled skill |
| writer collision | existing workspace lease only |
| MT5/VPS collision | explicit resource capacity and expiring resource lease |
| agent disappears/chat full | checkpoint, stale detection, slot takeover with new epoch |
| Tunnel partial health failure | layer-aware dispatch pause; no automatic mutation retry |
| schema/tool missing in chat | fixed 8-tool surface, manifestVersion, expectedShape, connector refresh |
| transcript/secret leakage | bounded summaries, redaction, encrypted conversation reference, no raw prompt storage |

## Alternatives considered

### A. SQLite chat room script outside NAVA

Rejected. It duplicates lifecycle, audit, permissions, packaging, backup and health handling while still needing NAVA for actual work.

### B. One Main chat manually copies messages among workers

Rejected as the target architecture. It works for a small trial but loses durable delivery, acknowledgement, collision control and recovery when a chat fills.

### C. Fork chat-on-steroids or make the Chrome extension the main controller

Rejected. Useful identity/wake concepts are retained, but browser DOM automation is brittle and must not be the task source of truth.

### D. Use Codex subagents only

Rejected. The user wants ChatGPT quota as the primary path and sometimes works outside Codex. Codex remains optional.

### E. Allow every Lead to talk directly and create new Leads

Rejected by default. It increases loops, duplicate work, quota use and unclear ownership. Main-mediated routing and fixed reusable slots are safer.

### F. Add another file writer lock inside Command Room

Rejected. The existing workspace lease already owns that invariant; a second lock can deadlock or disagree.

## Compliance with existing architecture

- primitive NAVA tools remain callable
- ranking/routing never grants authorization
- deterministic broker/state work stays local
- every transition is auditable
- destructive operations are never automatically retried
- migrations are additive and backed up
- installed runtime is not updated by this ADR

## Rollout decision

Implementation must be feature-flagged and follow:

1. local broker/manual mode
2. Desktop dashboard + writer/resource coordination
3. optional extension pairing/wake
4. optional Codex/provider adapters
5. volume/fault/restart acceptance and installed-runtime verification

The feature remains disabled by default until each gate passes.

## Review triggers

Revisit this ADR if:

- ChatGPT exposes a stable authenticated conversation/session identity to MCP
- MCP Tasks gains reliable provider push notifications
- the user needs more than five simultaneous active Leads
- room traffic exceeds SQLite/WAL limits measured in the acceptance benchmark
- NAVA becomes multi-user or remotely hosted
