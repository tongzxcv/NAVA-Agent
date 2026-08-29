# NAVA Command Room Phase 3 — Extension Identity / Wake Plan

สถานะฐานก่อนเริ่ม: **Phase 2B ปิดที่ NAVA v4.11.4** และถือ runtime / SQLite / writer-resource coordination ที่ผ่าน installed gate แล้วเป็น baseline ห้ามย้อน contract โดยไม่แก้ ADR ก่อน

เป้าหมาย Phase 3 คือเพิ่ม browser extension แบบ **opt-in** เพื่อ bind แชท ChatGPT กับ Command Room slot ที่ผู้ใช้ยืนยัน และปลุกเฉพาะ tab/conversation ที่จับคู่ไว้เมื่อมี event ใหม่ โดย Command Room SQLite ยังคงเป็น source of truth ของ room/task/checkpoint/lease ทั้งหมด

> Phase 3 เป็นชั้น **conversation identity + wake delivery** เท่านั้น ไม่ผูกกับ transport ระหว่าง ChatGPT กับ NAVA โดยตรง ต้องทำงานได้ทั้งกับ OpenAI Secure MCP Tunnel ในปัจจุบันและ transport อื่นในอนาคตโดยไม่เขียน Command Room ใหม่

## Version target

- Phase 2B release baseline: `v4.11.4`
- Phase 3 implementation target: `v4.12.0`
- bump source version เมื่อเริ่ม source implementation จริง แต่ **ห้าม install/restart/replace runtime ที่กำลังใช้งาน** จนกว่าจะผ่าน source gate และผู้ใช้อนุญาต

## Scope

1. **Migration 007** สำหรับ extension pairing/binding/wake delivery state แบบ additive และ rollback-safe
2. **One-time pairing** จาก NAVA Desktop ไป browser extension โดยผู้ใช้เป็นคนยืนยัน slot + conversation
3. **Exact conversation binding** ผูก room/slot/connectionEpoch กับ conversation identity ที่ตรวจได้จาก extension
4. **Installation identity แบบสุ่ม** ใช้ random `extensionInstallationId`; ห้ามทำ browser/device fingerprinting
5. **Encrypted local binding material** เก็บเฉพาะข้อมูลที่จำเป็นต่อการพิสูจน์ binding และ revoke/replace; ห้ามเก็บ cookie, access token, prompt history หรือ transcript
6. **Visible bounded wake delivery** มี audit/UI event ทุกครั้ง, cooldown 60 วินาที, retry สูงสุด 3 ครั้ง, coalescing, hourly budget และ dead-letter/manual fallback
7. **Fail-closed identity + UI state check** ถ้า tab, conversation, slot, epoch, DOM contract หรือ composer state ไม่ตรง/ไม่ชัดเจน ห้ามส่ง wake
8. **Revoke / Replace chat** binding เก่าต้องใช้ transition ต่อไม่ได้หลัง replace และ connectionEpoch ใหม่ต้องเป็น authority
9. **Desktop controls** สำหรับ Pair, Wake, Revoke, Replace chat และสถานะ extension แบบเห็นได้ชัด
10. **Extension package scaffold** แยกจาก runtime core และเปิดใช้ได้เฉพาะเมื่อผู้ใช้ opt-in

## Non-goals / hard boundaries

- Extension ไม่เป็น source of truth ของ task/checkpoint
- Extension ไม่เพิ่ม filesystem, Git, shell, MT5, VPS หรือ browser-writer permission
- Extension **ห้ามต่อ MCP endpoint โดยตรง** และห้ามเรียก `command_room_*`/filesystem/shell/Git tools; ใช้ Extension Bridge surface ที่แคบเฉพาะ pairing/status/wake ack/revoke
- ห้ามอ่าน cookie, API key, local/session storage ที่ไม่จำเป็น, full transcript หรือ prompt history
- ห้ามสร้างแชทใหม่เงียบ ๆ; Replace/New chat ต้องเกิดจากการกดของผู้ใช้
- ห้าม auto-retry mutation ที่ Command Room ปฏิเสธ
- ยังไม่ทำ Codex/provider automation, cloud service, quota switching, OAuth relay/NAVA Connect หรือ Phase 4 work
- Direct Lead-to-Lead routing ยังคงปิด; MAIN เป็น dispatcher ตาม contract เดิม
- OAuth/remote MCP transport ในอนาคต **ไม่ถือเป็น conversation identity proof** และต้องไม่ทำให้ Phase 3 ขึ้นกับ transport นั้น

## Transport boundary

```text
ChatGPT conversation
        |
        | provider transport (current: Secure MCP Tunnel; future: other)
        v
NAVA MCP / Command Room
        ^
        | task source of truth
        |
SQLite

Browser extension
        |
        | narrow local Extension Bridge only
        v
Pair / status / wake delivery / ack / revoke
```

ข้อบังคับ:

- Extension Bridge ต้องเป็น loopback-only, authenticated และใช้ explicit origin/installation allowlist
- Extension Bridge ห้าม expose generic MCP proxy หรือ arbitrary tool call
- transport เปลี่ยนได้โดยไม่เปลี่ยน pairing/wake state machine
- health/status response ห้ามคืน sensitive local paths, secrets หรือ credential-like material

## Pairing and wake state machines

### Pairing

```text
UNPAIRED -> CHALLENGED -> PAIRED -> STALE
                |           |        |
                v           v        v
             EXPIRED     REVOKED <- REPLACED
```

- challenge เป็น one-time, short TTL
- raw challenge/token ห้ามลง SQLite; เก็บได้เฉพาะ hash/HMAC ที่จำเป็น
- successful confirm ต้อง invalidate challenge ทันที
- revoke/replace ต้อง invalidate authority เก่าทั้งหมด
- `connectionEpoch` ใหม่เป็น authority; old epoch fail closed

### Wake

```text
QUEUED -> ATTEMPTING -> DELIVERED -> SUBMITTED
   |          |             |           |
   |          +--- retry ---+           |
   |                                    v
   +----> MANUAL_FALLBACK / DEAD_LETTER TASK_CLAIMED (Command Room task state)
```

ความหมายสถานะต้องแยกชัด:

- `DELIVERED`: extension installation ที่ถูกต้องรับ wake event แล้ว
- `SUBMITTED`: extension ยืนยันว่า wake prompt ถูก submit ไปยัง conversation ที่ตรง binding
- `TASK_CLAIMED`: ChatGPT/agent กลับมาเรียก Command Room และ claim/start task จริง
- `SUBMITTED` **ไม่เท่ากับ** `TASK_CLAIMED`; ห้ามเลื่อน task state เพียงเพราะ browser action สำเร็จ

## Wake trigger policy

Auto wake ใช้ allowlist เท่านั้น เช่น:

- `TASK_ASSIGNED`
- `HANDOFF_READY`
- `USER_WAKE`
- event สำคัญอื่นที่เพิ่มภายหลังต้องผ่าน contract review

ห้าม wake จาก heartbeat, presence refresh, UI refresh, ordinary status mutation หรือทุก message โดยอัตโนมัติ

กติกา:

- events สำหรับ slot เดียวกันระหว่าง cooldown ให้ coalesce เป็น wake เดียว
- default `wakeCooldownSeconds = 60`
- default `wakeMaxAttempts = 3`
- เพิ่ม per-binding/per-room hourly wake budget
- ถ้า wake ถูก `SUBMITTED` ซ้ำแต่ไม่มี heartbeat/claim กลับมาหลายรอบ ให้เปิด circuit breaker และเปลี่ยนเป็น manual notification
- circuit breaker reset ต้องมาจาก successful claim/heartbeat หรือ user action ที่ชัดเจน

## Proposed vertical slice

### A. Storage / migration 007

สร้างอย่างน้อยสองตาราง:

`command_room_bindings`

- id
- room_id
- agent_id / slot_key
- provider
- extension_installation_id (random ID, ไม่ใช่ fingerprint)
- encrypted_conversation_ref
- conversation_ref_fingerprint สำหรับ equality check แบบไม่เปิด plaintext
- connection_epoch
- state: `CHALLENGED / PAIRED / STALE / REVOKED / REPLACED`
- challenge_hash / challenge_expires_at เฉพาะช่วง pairing; raw challenge ห้าม persist
- paired_at, last_seen_at, revoked_at, replaced_at, created_at, updated_at

`command_room_wake_deliveries`

- id
- room_id
- agent_id / binding_id
- event_key / task_id / reason
- state: `QUEUED / ATTEMPTING / DELIVERED / SUBMITTED / MANUAL_FALLBACK / DEAD_LETTER / CANCELLED`
- attempt_count
- last_attempt_at
- next_eligible_at
- delivered_at
- submitted_at
- last_error_code
- created_at / updated_at

Indexes/constraints:

- active binding lookup ตาม room/slot/epoch
- bounded pending wake recovery หลัง restart
- idempotent/coalesced event lookup
- หนึ่ง slot/epoch ต้องไม่มี active authority มากกว่าหนึ่ง binding
- old/revoked/replaced epoch ต้องใช้ wake/transition ต่อไม่ได้
- migration ต้อง additive, backup-first และผ่าน reopen/rollback tests

### B. Broker / application service

- create pairing challenge แบบ one-time + short TTL
- persist เฉพาะ hash/HMAC; raw challenge อยู่ใน memory/UI flow เท่าที่จำเป็น
- confirm pairing ต้อง match room/slot/epoch/installation และ user-confirmed extension handshake
- revoke/replace ทำ old binding unusable ทันที
- enqueue wake เฉพาะ event allowlist โดยไม่ execute agent task แทน agent
- coalesce event ภายใน cooldown และ enforce hourly budget/circuit breaker
- recovery หลัง restart ต้องโหลด pending delivery และยังคง cooldown/attempt/budget เดิม
- browser `SUBMITTED` ห้ามเปลี่ยน Command Room task เป็น CLAIMED/RUNNING

### C. Desktop

- Agent card แสดง `UNPAIRED / PAIRED / STALE / OFFLINE / REVOKED`
- ปุ่ม Pair / Wake / Revoke / Replace chat
- ทุก wake แสดง target slot, reason, attempt, delivery state, cooldown/budget และ manual fallback
- แสดงชัดว่า `SUBMITTED` กับ `TASK_CLAIMED` เป็นคนละสถานะ
- ไม่ render secret, raw pairing token หรือ credential-like material หลัง pairing สำเร็จ

### D. Browser extension

- Manifest V3
- permission จำกัดเฉพาะ ChatGPT origin ที่รองรับและ NAVA Extension Bridge loopback ที่จำเป็น
- random `extensionInstallationId` สร้างครั้งแรกและ rotate ได้; ห้าม fingerprint browser/device
- content logic ใช้ exact conversation binding ก่อน action ทุกครั้ง
- ก่อน submit wake ต้องตรวจ:
  - exact conversation identity ตรง
  - slot + `connectionEpoch` ตรง
  - tab ambiguity ไม่มี
  - composer ว่าง; **ห้ามทับข้อความที่ผู้ใช้กำลังพิมพ์**
  - ChatGPT ไม่อยู่ใน generation/edit/voice state ที่ contract ระบุว่าไม่ปลอดภัย
  - SPA navigation/conversation URL/identity ไม่เปลี่ยนระหว่าง action
  - DOM contract ตรงกับ version ที่รองรับ
- check ใดไม่ผ่าน = abort/fail closed + manual fallback
- ไม่มี background scraping transcript และไม่มี credential extraction

## Acceptance gate

Phase 3 จะยังไม่ถือว่าผ่านจนกว่าจะมีหลักฐานต่อไปนี้ครบ:

1. **Wrong-tab wake = 0** ใน multi-tab test ที่มีอย่างน้อย 3 conversations
2. duplicate tab / ambiguous same-conversation tab ไม่เกิด submit จนกว่าจะเลือก authority ได้แน่นอน
3. binding หมดอายุ/ถูก revoke/epoch เก่าไม่สามารถ wake หรือ transition ต่อได้
4. Replace chat เปลี่ยน authority ไป epoch ใหม่และ old tab ถูกปฏิเสธ
5. retry ไม่เกิน 3 ครั้งและ cooldown ไม่น้อยกว่า 60 วินาที
6. coalescing + hourly budget + circuit breaker ทำงานและไม่เกิด wake storm
7. restart ระหว่าง pending wake แล้วยัง recover attempt/cooldown/budget/delivery state ถูกต้อง
8. extension offline แล้ว fallback เป็น Desktop notification / Copy wake prompt ได้
9. DOM contract/SPA identity เปลี่ยนแล้ว fail closed โดยไม่มีการ click/send ไป tab อื่น
10. composer มีข้อความของผู้ใช้อยู่แล้วต้องไม่ถูกแก้/ทับ/submit
11. `DELIVERED`, `SUBMITTED`, `TASK_CLAIMED` ถูกแยกจากกันและ browser submit ไม่เปลี่ยน task state เอง
12. UI/audit ไม่แสดง join code, agentSessionId, pairing secret, cookie, token, prompt history, transcript หรือ sensitive local paths
13. Extension Bridge ไม่สามารถ proxy generic MCP/tool call ได้
14. Phase 2B regressions ยังผ่าน: same-workspace writer block, cross-workspace concurrency, resource queue/recovery, ALL-RW routing
15. installed-runtime pilot ผ่านก่อนเปิด `extensionWakeEnabled`

## First implementation sequence

1. Harden/freeze Phase 3 contract
2. bump source to `v4.12.0` โดยไม่แตะ installed runtime
3. RED tests + migration 007 contract
4. storage repository + reopen/revoke/replace tests
5. application pairing/wake state machine
6. Extension Bridge minimal authenticated loopback surface
7. IPC/Desktop status and controls
8. extension scaffold + exact conversation binding
9. bounded wake delivery + coalescing/retry/cooldown/budget/circuit breaker
10. restart recovery + wrong-tab/composer/SPA matrix
11. package/install pilot and rollback evidence **เมื่อผู้ใช้อนุญาตเท่านั้น**

## Runtime safety while developing

ระหว่างที่ NAVA v4.11.4 กำลังถูกใช้เป็น MCP tool runtime:

- ทำ source work บน `feature/command-room-phase3`
- ห้าม install `v4.12.0`
- ห้าม restart/replace NAVA Desktop, tunnel-client หรือ stdio runtime ที่ใช้งานอยู่
- ห้ามแก้ `%LOCALAPPDATA%` installed app หรือ production SQLite schema จาก source build
- tests ต้องใช้ temp DB/isolated fixtures
- packaging/install gate ทำภายหลังเมื่อผู้ใช้บอกว่าสามารถหยุดใช้งาน runtime ได้

## Start command for the next run

`เริ่ม NAVA Command Room Phase 3 จาก docs/architecture/NAVA_COMMAND_ROOM_PHASE3_PLAN_TH.md ใช้ v4.11.4 installed runtime เป็น frozen baseline ทำงานบน feature/command-room-phase3 ตรวจ Git/Phase tracker ก่อน แล้วทำ source-only RED tests + migration 007 โดยห้าม install/restart runtime จนกว่าผู้ใช้อนุญาต`
