# NAVA Command Room — แบบออกแบบสำหรับ Main 1 + Project Lead 5

สถานะ: Proposed
วันที่: 2026-08-28
เป้าหมาย: รองรับการทำงาน 2–3 โปรเจกต์พร้อมกัน โดยใช้ ChatGPT เป็นหลักและ Codex เป็นตัวเลือกเสริม

เอกสารตัดสินใจ: [ADR-0001](../adr/0001-command-room-local-broker.md)

## 1. ข้อสรุปที่เลือก

สร้าง Command Room เป็นความสามารถ local-first ภายใน NAVA เดิม ไม่สร้างแอปแยกและไม่สร้างระบบ cloud กลางใหม่

โครงสร้างประจำห้อง:

- Main 1 ตัว: วางแผน แบ่งงาน ตรวจผล และตัดสินใจส่งงานต่อ
- Project Lead 5 ช่อง: เป็น slot ที่นำกลับมาใช้ใหม่และย้ายไปผูกกับโปรเจกต์อื่นได้
- ค่าใช้งานปกติ: เปิดทำงานจริง 3 Leads, หลับสำรอง 2 Leads
- writer พร้อมกันสูงสุด 2 Leads และต้องอยู่คนละ workspace
- งานหนัก MT5/VPS/optimization พร้อมกันสูงสุด 2 งาน
- Lead-to-Lead direct message ปิดเป็นค่าเริ่มต้น ทุกงานและผลสำคัญผ่าน Main
- Main เป็น read-only coordinator โดยค่าเริ่มต้น และไม่ถือ writer lease เอง

Command Room เป็นชั้นประสานงาน ไม่ใช่ชั้นสิทธิ์ใหม่ การเขียนไฟล์ยังต้องผ่าน permission เดิมและ workspace writer lease เดิมเสมอ

## 2. หลักฐานจาก NAVA ปัจจุบัน

การตรวจครั้งนี้ไม่อ่าน prompt, argument, output, credential หรือเนื้อหาแชท

- NAVA v4.11.0 มี SQLite WAL, audit, continuity checkpoint, durable task, activity log และ writer lease ต่อ workspace อยู่แล้ว
- พบ 13 registered workspaces รวมโปรเจกต์หลัก Autobots, BEELZEBUB, RATCHET, GREED และ THANATOS
- ระหว่างตรวจมี writer ของ BEELZEBUB ใช้งานอยู่ จึงไม่แตะหรือปล่อย lease นั้น
- ใน 48 ชั่วโมงล่าสุดพบ 10,725 calls และ 10,724 completions
- Success 10,326 calls หรือ 96.3%
- เครื่องมือที่ใช้มากสุดคือ shell 4,785, workspace_lease_call 1,474 และ tool_batch 1,107
- continuity ถูกใช้จริง: session_checkpoint 674 และ session_resume 124
- จุดผิดพลาดที่ควรแก้ด้วย contract ใหม่คือ workspace_lease_call / INVALID_INPUT 60 ครั้ง
- shell p95 ประมาณ 40.3 วินาที และ tool_batch p95 ประมาณ 17.0 วินาที
- ชั่วโมงที่หนักสุดมี 729 completed calls

ข้อสรุป: ภาระจริงมากพอที่จะต้องมี durable queue, acknowledgement, idempotency, resource scheduling และ recovery ที่ไม่ผูกกับอายุของแชท

## 3. ภาพรวมระบบ

~~~text
ChatGPT normal chat / ChatGPT Project chat / optional Codex
                         |
                  Secure MCP Tunnel
                         |
                         v
+----------------------------------------------------------+
| NAVA Command Room                                       |
|                                                          |
| Room Broker -> Task Orchestrator -> Presence/Delivery    |
|      |              |                  |                 |
|      v              v                  v                 |
| SQLite WAL     Workspace Lease     Resource Scheduler    |
| messages/tasks   existing 004       MT5/VPS/browser      |
|                                                          |
| Continuity -> session_checkpoint/session_resume           |
| Durable work -> existing MCP Tasks / shell / wsl / SSH   |
| Audit -> existing ActivityTracker + Live Logs             |
+----------------------------------------------------------+
             |                          |
             v                          v
       NAVA Desktop UI          Optional Chrome extension
       Main + Lead cards        identity + event wake-up
~~~

## 4. รูปแบบใช้งานที่เหมาะกับคุณ

### 4.1 Slot ไม่ผูกชื่อโปรเจกต์ถาวร

| Slot | หน้าที่เริ่มต้น | สถานะปกติ |
| --- | --- | --- |
| MAIN | แบ่งงาน ตรวจผล แก้ blocker | online, read-only |
| LEAD-1 | โปรเจกต์ที่เร่งที่สุด | active writer |
| LEAD-2 | โปรเจกต์ลำดับสอง | active writer |
| LEAD-3 | โปรเจกต์ลำดับสาม หรือวิจัย/review | active writer หรือ reader |
| LEAD-4 | สำรองเมื่อแชทเต็มหรืองานใหม่เข้า | sleeping |
| LEAD-5 | สำรองหรือ review อิสระ | sleeping |

ตัวอย่างในช่วงที่ทำ BEELZEBUB, RATCHET และ AUTOBOTS พร้อมกัน:

- LEAD-1 ผูก BEELZEBUB และถือ writer lease เฉพาะ workspace BEELZEBUB
- LEAD-2 ผูก RATCHET และถือ writer lease เฉพาะ workspace RATCHET
- LEAD-3 ผูก AUTOBOTS และถือ writer lease เฉพาะ workspace AUTOBOTS เมื่อเป็นงานเขียน; ถ้าเป็น review อย่างเดียวให้ทำแบบ reader
- LEAD-4/5 หลับจน Main ขอเพิ่มกำลังหรือใช้แทนแชทที่เต็ม

เมื่อโปรเจกต์จบ ให้ park Lead, ปล่อย lease/resource, เก็บ checkpoint แล้ว rebind slot เดิมกับโปรเจกต์ถัดไป

### 4.2 แชทปกติและแชทใน Project ใช้ได้เหมือนกัน

Command Room ผูกกับ roomId, agent slot, projectKey และ workspaceId ไม่ได้ผูกกับ ChatGPT Project

| Client | ใช้ได้ | หมายเหตุ |
| --- | --- | --- |
| ChatGPT normal chat | ได้ | join room และ resume projectKey ตามปกติ |
| ChatGPT Project chat | ได้ | เก็บ project hint เพื่อแสดงผลเท่านั้น |
| Codex Desktop/CLI | ได้แบบ opt-in | ใช้โควต้า Codex ไม่ใช่ ChatGPT |
| Claude หรือ MCP client อื่น | ได้เมื่อกำหนด | ใช้บัญชีและโควต้าของ provider นั้น |
| ChatGPT Scheduled Task | ไม่ใช่แกนหลัก | ความถี่และการปลุกแชทไม่แน่นอนพอสำหรับ orchestration |

NAVA ไม่เปลี่ยนโควต้าและไม่ bypass ข้อจำกัด provider ถ้าใช้ ChatGPT ก็ใช้โควต้า ChatGPT; ถ้าเปิด Codex participant จึงใช้โควต้า Codex

## 5. บทบาทและสิทธิ์

### Main

- สร้าง task brief แบบ bounded
- เลือก Lead, projectKey, workspaceId, mutation mode และ resource ที่ต้องใช้
- ดูสถานะรวมและจัดลำดับงาน
- รับ result/checkpoint/evidence แล้ว approve, reject หรือส่งงานต่อ
- แก้ collision และ reassign งานเมื่อ Lead หาย
- ไม่มีสิทธิ์ข้าม permission, writer lease หรือ human confirmation
- ไม่เขียนไฟล์เอง เว้นแต่ผู้ใช้สั่งให้ Main รับบท worker ชั่วคราว

### Project Lead

- join ด้วย slot ที่กำหนด
- เรียก session_resume ก่อนทำงานต่อจากแชทเก่า
- claim task ได้ทีละหนึ่ง task หลัก
- งานอ่านสามารถทำพร้อมกันได้
- งานเขียนต้องได้ writer lease ของ workspace นั้น
- อัปเดต checkpoint หลัง milestone, ก่อนงานยาว และก่อนจบแชท
- ส่ง result เป็น summary + evidence reference ไม่ส่ง raw log ขนาดใหญ่
- ไม่มีสิทธิ์ rebind slot, เพิ่ม workspace root หรืออนุมัติงานอันตรายเอง

### Observer/Reviewer

- อ่าน task/result/evidence ได้ตามขอบเขต
- ไม่มี writer lease และไม่ claim mutation task
- ใช้สำหรับ independent review หรือให้ Codex ตรวจเฉพาะจุด

## 6. State machine

### Room

~~~text
ACTIVE <-> PAUSED -> ARCHIVED
~~~

- ACTIVE: รับ/ส่งงานและ wake ได้
- PAUSED: เก็บ state แต่ไม่ dispatch งานใหม่
- ARCHIVED: อ่านย้อนหลังได้ ห้าม join/dispatch เพิ่ม

### Agent

~~~text
UNBOUND -> ONLINE -> WORKING -> WAITING
               |        |          |
               v        v          v
            SLEEPING <- PARKING <- STALE -> OFFLINE
                                      |
                                   REVOKED
~~~

- STALE ไม่เท่ากับล้มทันที ถ้ามี durable task ทำงานอยู่ให้ดู task state ก่อน
- เปลี่ยนเป็น OFFLINE เมื่อเกิน timeout และไม่มี owned work ที่ยังพิสูจน์ได้
- connectionEpoch เพิ่มทุกครั้งที่เปลี่ยนแชท ป้องกันแชทเก่าส่งผลซ้ำ

### Task

~~~text
QUEUED -> ASSIGNED -> CLAIMED -> RUNNING
                              -> WAITING -> RUNNING
                              -> REVIEW -> COMPLETED
                              -> FAILED
QUEUED/ASSIGNED/CLAIMED/RUNNING/WAITING/REVIEW -> CANCELLED
~~~

ทุก transition ใช้ expectedVersion เพื่อป้องกัน update ทับกัน

### Message delivery

Message เป็น immutable; สถานะต่อผู้รับเก็บใน receipt

~~~text
QUEUED -> DELIVERED -> ACKED
   |          |
   +------> EXPIRED -> DEAD_LETTER
~~~

ส่งแบบ at-least-once และใช้ idempotencyKey ป้องกันงานซ้ำ

## 7. MCP tool surface ที่เสนอ

เพิ่มคงที่เพียง 8 tools เพื่อลด manifest drift และไม่เพิ่มเครื่องมือจำนวนมากเกินจำเป็น

| Tool | ผู้ใช้ | หน้าที่ |
| --- | --- | --- |
| command_room_join | ทุก agent | join/rejoin slot ด้วย roomId, slotKey, joinCode และ connectionEpoch |
| command_room_status | ทุก agent | อ่าน room, agents, tasks, leases และ resources แบบ bounded |
| command_room_inbox | ทุก agent | อ่านจาก cursor, limit สูงสุด 50, wait สูงสุด 25 วินาที |
| command_room_send | ทุก agent | ส่ง update/question/result/handoff ด้วย idempotencyKey |
| command_room_task | Main/Lead | assign, claim, start, wait, submit, approve, reject, fail, cancel |
| command_room_presence | ทุก agent | heartbeat, park, leave; renew เฉพาะ ownership ที่ยังถูกต้อง |
| command_room_resource | Main/Lead | status, request, renew, release resource lease |
| command_room_admin | Main/UI | create, pause, resume, archive, bind, rebind, revoke, wake |

กติกา contract:

- ทุก action เป็น discriminated union และตอบ expectedShape เมื่อ INVALID_INPUT
- ทุก response มี manifestVersion, roomVersion และ serverTime
- mutation ของ room/task ใช้ idempotencyKey และ expectedVersion
- ไม่มี tool ใดรับ raw prompt หรือ credential
- summary ต่อข้อความไม่เกิน 16 KiB
- task brief/result ไม่เกิน 32 KiB
- evidenceRefs ไม่เกิน 20 รายการ
- inbox ไม่ส่งข้อมูลเกิน limit และคืน nextCursor/truncated
- command_room_task ไม่แก้ไฟล์แทน agent
- การแก้ไฟล์ยังผ่าน workspace_lease_call รูปแบบเดิม
- ถ้า workspace มี active writer lease การเรียก session_checkpoint ที่ระบุ workspaceId ต้องผ่าน workspace_lease_call ด้วย leaseId เดิม; bundled skill ต้องสร้าง envelope นี้ให้ agent เพื่อลด INVALID_INPUT/PERMISSION_REQUIRED

ตัวอย่างผล submit ที่ควรเก็บ:

~~~json
{
  "taskId": "uuid",
  "state": "REVIEW",
  "summary": "ผลที่ทำเสร็จแบบสั้น",
  "evidenceRefs": [
    {"kind": "checkpoint", "id": "uuid"},
    {"kind": "durable_task", "id": "uuid"},
    {"kind": "file", "path": "workspace-relative path"}
  ],
  "git": {"head": "commit-or-null", "dirtyVerified": true},
  "risks": ["สิ่งที่ยังไม่ยืนยัน"],
  "nextAction": "ขั้นต่อไปหนึ่งข้อ",
  "expectedVersion": 7,
  "idempotencyKey": "agent/task/milestone"
}
~~~

## 8. SQLite schema และ migration

ใช้ additive migrations หลัง 004_workspace_leases

### 005_command_room_core

- command_rooms
  - id, name, status, policy_json, version, created_at, updated_at, archived_at
- command_room_agents
  - id, room_id, slot_key, role, provider, state, project_key, workspace_id
  - connection_epoch, current_task_id, last_heartbeat_at, last_checkpoint_id
  - capabilities_json, created_at, updated_at
  - UNIQUE(room_id, slot_key)
- command_room_messages
  - seq INTEGER PRIMARY KEY AUTOINCREMENT
  - id, room_id, sender_agent_id, kind, subject, body_json, priority
  - reply_to_id, idempotency_key, created_at, expires_at
  - UNIQUE(room_id, sender_agent_id, idempotency_key)
- command_room_message_receipts
  - message_id, recipient_agent_id, status, attempts
  - delivered_at, acked_at, last_error
  - PRIMARY KEY(message_id, recipient_agent_id)
- command_room_cursors
  - room_id, agent_id, last_message_seq, updated_at
  - PRIMARY KEY(room_id, agent_id)
- command_room_tasks
  - id, room_id, project_key, workspace_id, title, brief_json
  - mutation_mode, state, priority, assigned_agent_id, created_by_agent_id
  - checkpoint_id, durable_task_id, version
  - claimed_at, started_at, deadline_at, completed_at, created_at, updated_at
- command_room_task_events
  - seq INTEGER PRIMARY KEY AUTOINCREMENT
  - task_id, actor_agent_id, event_type, payload_json, created_at

### 006_command_room_resources

- command_room_resources
  - resource_key, kind, capacity, enabled, policy_json
- command_room_resource_leases
  - lease_id, resource_key, room_id, task_id, agent_id, units
  - acquired_at, heartbeat_at, expires_at

### 007_command_room_bindings

- command_room_bindings
  - id, room_id, agent_id, provider, encrypted_conversation_ref
  - extension_installation_id, connection_epoch, paired_at, last_seen_at, revoked_at

conversation reference ต้องเข้ารหัสด้วย Electron safeStorage/DPAPI ห้ามเก็บ URL หรือ conversation ID แบบ plain text

หลัก migration:

- สำรองฐานข้อมูลก่อน migration แรกตามกลไกเดิม
- migration เป็น transaction
- downgrade ใช้ rollback backup ไม่ drop ตารางอัตโนมัติ
- runtime เก่าต้องละเลยตารางใหม่ได้
- room state ห้ามยัดรวมใน generic settings หรือ continuity JSON

## 9. Workspace lease และ resource scheduler

### Workspace mutation

ใช้ workspace_leases เดิมเป็น source of truth เดียว

Flow:

1. Main assign task พร้อม workspaceId และ mutationMode
2. Lead claim task
3. ถ้าเป็น read-only ไม่ขอ lease
4. ถ้าเป็น write ให้ broker ขอ writer lease ด้วย owner ที่ระบุ room/slot/task
5. Lead เรียก workspace_lease_call ด้วย leaseId เดิม
6. presence heartbeat renew lease เมื่อ task ยัง RUNNING เท่านั้น
7. submit/fail/cancel/park/offline ต้อง release lease
8. ถ้า lease หมดอายุ task เปลี่ยน WAITING และห้ามเขียนต่อจน re-acquire

writer lease เป็น collision control ไม่ใช่ authorization

### Shared resources

กำหนด resource เริ่มต้น:

| Resource | Capacity | Policy |
| --- | ---: | --- |
| mt5-terminal-1 ถึง mt5-terminal-7 | 1 ต่อเครื่อง | process owner เดียวต่อ terminal path |
| cpu-heavy-project | 2 | งาน optimization/backtest หนักข้ามโปรเจกต์ |
| vps-nava-writer | 1 | คำสั่งแก้ไข/รันงานที่เปลี่ยน state บน VPS |
| managed-browser-writer | 1 | UI navigation/input ที่เปลี่ยน state |
| gpu-heavy | 1 | ML/vision งานใหญ่ |
| git-writer:<workspaceId> | ไม่สร้างซ้ำ | ใช้ workspace lease เดิม |

งาน backtest ภายในหนึ่งโปรเจกต์ยังใช้ dynamic worker pool ได้ถึง 7 terminals ตาม policy เดิม แต่ scheduler ต้องจอง terminal แต่ละตัวจริงและห้ามอีกโปรเจกต์ใช้ path เดียวกัน

## 10. Continuity และกรณีแชทเต็ม

เมื่อ task ถูก claim:

1. Lead เรียก session_resume ด้วย projectKey
2. ตรวจ Git/workspace/durable task/Obsidian ก่อน mutation
3. บันทึก checkpoint หลัง milestone และก่อนงานยาว; ถ้าถือ writer lease ให้ route session_checkpoint ผ่าน workspace_lease_call ด้วย lease เดิม
4. command_room_task อ้าง checkpointId/durableTaskId เท่านั้น
5. ถ้าแชทใกล้เต็ม Lead ส่ง HANDOFF_READY ให้ Main และ park ตัวเอง

ถ้าแชทเต็มก่อนสรุป:

- Main หรือ Desktop เห็น heartbeat หายและ checkpoint ล่าสุด
- slot เดิมยังอยู่ แต่ binding เดิมถูก mark STALE
- ผู้ใช้เปิดแชทใหม่ หรือกด Replace chat ใน extension
- แชทใหม่ join ด้วย slot เดิมและ connectionEpoch ใหม่
- แชทเก่าถูก revoke สำหรับการส่ง task transition
- Lead ใหม่เรียก session_resume และตรวจหลักฐานปัจจุบันก่อนทำต่อ

คำสั่งสั้นสำหรับแชทใหม่:

~~~text
ใช้ skill nava-command-room แล้ว join room <ROOM_ID> เป็น <SLOT_KEY>
จากนั้นเรียก session_resume projectKey=<PROJECT_KEY>
ตรวจ workspace/Git/task/checkpoint ปัจจุบันก่อน mutation แล้วทำ nextAction ต่อ
~~~

ไม่ต้อง copy เนื้อหาแชทเก่าทั้งหมด และไม่ต้องพึ่ง shared-chat URL

## 11. Browser extension และการปลุก agent

ข้อเท็จจริง: ChatGPT chat จะไม่กลับมาเรียก MCP เองเป็นระยะอย่างเชื่อถือได้ NAVA จึงทำห้องได้แบบ manual โดยไม่ใช้ extension แต่การ wake อัตโนมัติต้องมี browser bridge

### Manual mode — ทำก่อน

- ผู้ใช้เปิดแต่ละแชทและส่ง boot prompt
- Agent join แล้วอ่าน inbox
- เมื่อมีงานใหม่ NAVA แสดง notification และปุ่ม Copy wake prompt
- ปลอดภัยและไม่ผูกกับ DOM ของ ChatGPT

### Extension mode — ทำภายหลังและ opt-in

- ขอ permission เฉพาะ chatgpt.com และ localhost NAVA
- pair กับ NAVA ด้วย one-time code
- จับ exact conversation ID และ agent slot โดยผู้ใช้ยืนยัน
- เมื่อมี task ใหม่ ส่ง wake token สั้น ๆ ให้ tab ที่จับคู่
- ไม่อ่าน cookie, API key, full chat transcript หรือ prompt history
- มี cooldown 60 วินาที และ retry สูงสุด 3 ครั้ง
- ทุก wake แสดงใน NAVA UI และ audit
- ถ้า DOM/identity ไม่ตรง ให้ fail closed และขอผู้ใช้กดเอง
- การเปิดแชทใหม่แทนแชทเต็มต้องเป็นปุ่มที่ผู้ใช้กด ไม่สร้างเงียบ ๆ

extension ใช้เพื่อ identity/wake เท่านั้น ไม่เป็น source of truth ของ task หรือ checkpoint

## 12. Identity และ security

MCP Tunnel ปัจจุบันไม่มี caller conversation identity ที่เชื่อถือได้ จึงห้ามใช้ชื่อ agent ที่ส่งมาเองเป็น authorization

- Desktop สร้าง one-time join code อายุสั้น
- join สำเร็จแล้วออก agentSessionId ผูก room/slot/connectionEpoch
- extension pairing เพิ่มหลักฐาน conversation binding แต่ไม่เพิ่ม filesystem permission
- Main role ไม่สามารถอนุมัติ delete, live deploy, Git push, shutdown หรือคำสั่งอันตรายแทนผู้ใช้
- existing workspace roots, permission profile, hard blocks และ confirmation ยังบังคับเหมือนเดิม
- body_json ผ่าน redaction และ size limits
- credentials, raw private keys, cookies, Tunnel API key และ raw prompts ห้ามเข้า room DB
- audit เก็บ actor, action, room/task/workspace/resource IDs, result code และ duration แบบ bounded
- direct Lead-to-Lead ปิดเพื่อลด loop; ใช้ REQUEST_HELP ผ่าน Main
- จำกัด delegation depth และ task child count ป้องกัน agent แตกงานไม่สิ้นสุด

## 13. Health, retry และ recovery

ใช้ health แยก layer ไม่ตัดสินจากคำว่า unhealthy เพียงคำเดียว

| Layer | พฤติกรรม |
| --- | --- |
| local MCP unhealthy | หยุด dispatch ใหม่, เก็บ queue, ตรวจ owned durable tasks |
| Tunnel process unhealthy | ห้าม wake remote chat; local task ที่พิสูจน์ว่ายังรันให้ทำต่อ |
| control plane unknown | แสดง degraded ไม่สรุปว่าเสีย; ห้าม retry mutation อัตโนมัติ |
| connector schema stale | แจ้ง Refresh connector และตรวจ manifestVersion |
| extension offline | กลับ manual notification/copy prompt |
| writer lease conflict | task เป็น WAITING พร้อม owner/expiry; ห้าม bypass |
| resource busy | เข้าคิวแบบ FIFO ต่อ priority และ aging |
| duplicate delivery | idempotencyKey คืนผลเดิม |
| process crash/restart | โหลด room/task/receipt/resource lease จาก SQLite แล้ว reconcile |
| chat stale/full | rotate binding ด้วย connectionEpoch และ resume checkpoint |

ค่าเริ่มต้น:

- agent heartbeat ทุก 45 วินาทีเมื่อมีโอกาสเรียก tool
- STALE หลัง 180 วินาที แต่ถ้ามี durable task ทำงานให้คง WORKING
- OFFLINE หลัง 600 วินาทีเมื่อไม่มีหลักฐานงาน
- writer/resource lease TTL 900 วินาที และ renew จาก activity/heartbeat
- safe read retry 3 ครั้งด้วย backoff
- mutation ไม่ retry อัตโนมัติ
- dead-letter หลัง delivery/wake 3 ครั้ง

## 14. NAVA Desktop UI

เพิ่มเมนู ห้องบัญชาการ / Command Room ใน AppShell เดิม

### Header

- room name/status
- Tunnel health แยก layer
- queue depth, active writers, heavy resources
- Pause, Resume, Export bounded incident, Settings

### Agent cards

Main 1 card และ Lead 1–5 cards แต่ละใบแสดง:

- provider และ chat type: normal/project/Codex
- bound projectKey และ workspace
- ONLINE/WORKING/WAITING/SLEEPING/STALE
- current task และ version
- writer lease owner/expiry
- resource lease
- last heartbeat และ checkpoint age
- manifest/schema version
- ปุ่ม Copy boot, Wake, Park, Rebind, Revoke

### Task/Resource panels

- Kanban: queued, running, waiting, review, completed
- แสดง blocker และ lease conflict แบบ actionable
- ไม่แสดง raw tool output
- resource board สำหรับ MT5 terminals, VPS, browser และ GPU
- timeline ใช้ task events/audit แบบ bounded

## 15. ค่าเริ่มต้นที่เสนอ

~~~json
{
  "enabled": false,
  "leadSlots": 5,
  "maxActiveLeads": 3,
  "maxWriterLeads": 2,
  "maxHeavyTasks": 2,
  "maxVpsWriters": 1,
  "heartbeatSeconds": 45,
  "staleSeconds": 180,
  "offlineSeconds": 600,
  "writerLeaseTtlSeconds": 900,
  "resourceLeaseTtlSeconds": 900,
  "inboxLimit": 25,
  "messageTtlHours": 72,
  "wakeCooldownSeconds": 60,
  "wakeMaxAttempts": 3,
  "directLeadMessaging": false,
  "codexParticipantEnabled": false,
  "extensionWakeEnabled": false
}
~~~

enabled, Codex และ extension ต้องปิดไว้จนผ่าน rollout gate

## 16. Package mapping

| ส่วน | ตำแหน่ง |
| --- | --- |
| domain types/state transitions | packages/domain |
| broker/orchestrator/presence/resource services | packages/application |
| migrations/repositories | packages/storage |
| 8 MCP tools + schema/version tests | packages/mcp-server |
| Desktop types/channels | packages/ipc-contracts |
| main handlers + preload validation | apps/desktop |
| Command Room page/cards | apps/desktop/src/renderer |
| optional extension | apps/chatgpt-extension |
| boot/continuity workflow | bundled skill nava-command-room |

ไม่เพิ่ม framework, message broker service, database engine หรือ cloud dependency ใหม่ SQLite และ runtime ที่มีอยู่เพียงพอ

## 17. Rollout

### Phase 0 — Contract

- approve เอกสารนี้และ ADR
- freeze tool names, state machine, limits และ security invariants
- ยังไม่เปลี่ยน installed NAVA

### Phase 1 — Local broker, manual mode

- migration 005
- repositories/services และ 8 MCP tools
- bundled nava-command-room skill
- no extension
- pilot Main + 2 Leads แบบ read-only

Gate: restart recovery, idempotency, inbox cursor และ no secret regression ผ่าน

### Phase 2 — Writer/resource coordination + Desktop UI

- migration 006
- existing writer-lease integration
- resource scheduler
- Main + Lead cards
- pilot 3 active Leads และยืนยัน 3 concurrent writers บน 3 workspace ที่ต่างกัน

Gate: same-workspace collision ถูก block, 3 different-workspace writers ผ่านและ recover หลัง restart, MT5/VPS resource ไม่ชน

### Phase 3 — Extension identity/wake

- migration 007
- pairing, encrypted binding, visible event wake
- manual fallback และ fail-closed DOM changes

Gate: ไม่มี wrong-tab wake, retry bounded, revoke/replace chat ทำงาน

### Phase 4 — Optional providers

- Codex adapter opt-in
- provider-specific status/usage labels
- ไม่มี automatic quota substitution

### Phase 5 — Reliability and release

- volume/restart/tunnel fault tests
- package, rollback backup, installed-runtime verification
- เปิด feature flag เฉพาะหลัง pilot ผ่าน

## 18. Test matrix

### Storage/unit

- migrations 005–007, pre-migration backup และ failed migration rollback
- message idempotency และ receipt/cursor
- task expectedVersion/state transition
- expired presence/workspace/resource lease cleanup
- redaction และ size limits

### Concurrency

- 5 agents อ่าน inbox พร้อมกัน
- 2 writers คนละ workspace ผ่าน
- 2 writers workspace เดียวกัน คนหลังได้ actionable conflict
- Main ไม่ถือ writer lease โดยไม่ตั้งใจ
- capacity ของ 7 MT5 terminals ไม่ถูกใช้ซ้ำ
- queue aging ไม่ทำให้งาน priority ต่ำ starvation

### Recovery

- restart ระหว่าง RUNNING/WAITING/REVIEW
- one started activity without completion
- durable shell task ยังรันขณะ chat stale
- chat full แล้ว connectionEpoch ใหม่ takeover
- extension หายแล้ว manual mode ใช้ต่อได้
- Tunnel unhealthy แค่บาง layer ไม่ทำให้ mutation retry ซ้ำ

### Contract/UI

- ทุก tool INVALID_INPUT คืน expectedShape + manifestVersion
- connector refresh ตรวจ tool surface 8 tools
- normal chat และ Project chat join room เดียวกัน
- 10,725-call/48h replay profile และ peak อย่างน้อย 730 calls/hour
- Desktop card แสดง lease/checkpoint/health ตรงกับ source of truth
- accessibility, locale TH/EN และ bounded rendering

### Security

- impersonated slot ไม่มี join code ถูกปฏิเสธ
- revoked epoch เปลี่ยน task ไม่ได้
- extension ไม่เก็บ cookie/transcript
- Main/Lead ข้าม permission, workspace root หรือ human confirmation ไม่ได้
- incident export ไม่มี secret/raw payload

## 19. เกณฑ์พร้อมใช้งานจริง

ยังไม่ถือว่าพร้อมเพียงเพราะ compile หรือหน้า UI เปิดได้ ต้องพิสูจน์ครบ:

- storage migration/rollback ผ่าน
- manual Main + 2 Leads ทำงาน end-to-end
- writer collision และ resource contention ผ่าน
- active writer สามารถบันทึก checkpoint ผ่าน lease wrapper และ direct call ที่ขาด lease context ถูกปฏิเสธแบบ actionable
- chat-full takeover จาก checkpoint ผ่าน
- Tunnel/MCP restart recovery ผ่าน
- manifest refresh ไม่มี missing tools
- Thai/English UI ผ่าน
- package hashes และ installed child paths ตรง
- backup/settings/workspaces/Tunnel profile เดิมยังอยู่
- pilot กับโปรเจกต์ทดลองก่อนแตะ Live EA

## 20. สิ่งที่ระบบนี้ไม่ทำ

- ไม่ทำให้ ChatGPT/Codex/Claude unlimited
- ไม่แปลงโควต้า ChatGPT เป็น Codex หรือกลับกัน
- ไม่รับประกันว่า model จะตื่นเองโดยไม่มี extension/user action
- ไม่ให้ agent ซื้อขายหรือ deploy Live อัตโนมัติ
- ไม่ bypass permission, login, rate limit, writer lease หรือ human confirmation
- ไม่ใช้ shared-chat URL เป็น continuity
- ไม่เก็บ transcript ทั้งแชท
- ไม่เปิด Lead-to-Lead loop แบบไร้ขอบเขต
- ไม่แทนที่ Obsidian, session checkpoint, MCP Tasks หรือ workspace lease ที่มีอยู่

## 21. คำแนะนำการเริ่มใช้งานหลังพัฒนา

เริ่มจากห้องเดียวชื่อ NAVA EA LAB:

1. MAIN อยู่ในแชทที่ผู้ใช้ใช้คุมภาพรวม
2. LEAD-1 = โปรเจกต์เขียนหลัก
3. LEAD-2 = โปรเจกต์เขียนรอง
4. LEAD-3 = โปรเจกต์เขียนลำดับสาม หรือสลับเป็นงานอ่าน/วิเคราะห์/review
5. LEAD-4/5 sleeping
6. ทดลอง manual mode หนึ่งสัปดาห์ก่อนเปิด extension
7. เปิด Codex participant เฉพาะงานที่ผู้ใช้ต้องการใช้โควต้า Codex จริง

รูปแบบนี้รองรับทั้งวันที่ทำเพียงโปรเจกต์เดียวและวันที่ทำ BEELZEBUB, RATCHET, AUTOBOTS พร้อมกัน โดยไม่ต้องสร้างห้องใหม่ทุกครั้ง
