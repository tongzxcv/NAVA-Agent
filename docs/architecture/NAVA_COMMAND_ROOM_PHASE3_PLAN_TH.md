# NAVA Command Room Phase 3 — Extension Identity / Wake Plan

สถานะฐานก่อนเริ่ม: **Phase 2B ปิดที่ NAVA v4.11.4** และถือ runtime / SQLite / writer-resource coordination ที่ผ่าน installed gate แล้วเป็น baseline ห้ามย้อน contract โดยไม่แก้ ADR ก่อน

เป้าหมาย Phase 3 คือเพิ่ม browser extension แบบ **opt-in** เพื่อ bind แชท ChatGPT กับ Command Room slot ที่ผู้ใช้ยืนยัน และปลุกเฉพาะ tab/conversation ที่จับคู่ไว้เมื่อมี event ใหม่ โดย Command Room SQLite ยังคงเป็น source of truth ของ room/task/checkpoint/lease ทั้งหมด

## Version target

- Phase 2B release baseline: `v4.11.4`
- Phase 3 implementation target: `v4.12.0`
- ยังไม่ bump version จนกว่าจะเริ่ม source implementation ของ Phase 3 จริง

## Scope

1. **Migration 007** สำหรับ extension pairing/binding/wake delivery state แบบ additive และ rollback-safe
2. **One-time pairing** จาก NAVA Desktop ไป browser extension โดยผู้ใช้เป็นคนยืนยัน slot + conversation
3. **Exact conversation binding** ผูก room/slot/connectionEpoch กับ conversation identity ที่ตรวจได้จาก extension
4. **Encrypted local binding material** เก็บเฉพาะข้อมูลที่จำเป็นต่อการพิสูจน์ binding และ revoke/replace; ห้ามเก็บ cookie, access token, prompt history หรือ transcript
5. **Visible wake delivery** มี audit/UI event ทุกครั้ง, cooldown 60 วินาที, retry สูงสุด 3 ครั้ง และ dead-letter หลังครบ limit
6. **Fail-closed identity check** ถ้า tab, conversation, slot, epoch หรือ DOM contract ไม่ตรง ห้ามส่ง wake และให้ fallback เป็น manual notification / Copy wake prompt
7. **Revoke / Replace chat** binding เก่าต้องใช้ transition ต่อไม่ได้หลัง replace และ connectionEpoch ใหม่ต้องเป็น authority
8. **Desktop controls** สำหรับ Pair, Wake, Revoke, Replace chat และสถานะ extension แบบเห็นได้ชัด
9. **Extension package scaffold** แยกจาก runtime core และเปิดใช้ได้เฉพาะเมื่อผู้ใช้ opt-in

## Non-goals / hard boundaries

- Extension ไม่เป็น source of truth ของ task/checkpoint
- Extension ไม่เพิ่ม filesystem, Git, shell, MT5, VPS หรือ browser-writer permission
- ห้ามอ่าน cookie, API key, local/session storage ที่ไม่จำเป็น, full transcript หรือ prompt history
- ห้ามสร้างแชทใหม่เงียบ ๆ; Replace/New chat ต้องเกิดจากการกดของผู้ใช้
- ห้าม auto-retry mutation ที่ Command Room ปฏิเสธ
- ยังไม่ทำ Codex/provider automation, cloud service, quota switching หรือ Phase 4 work
- Direct Lead-to-Lead routing ยังคงปิด; MAIN เป็น dispatcher ตาม contract เดิม

## Proposed vertical slice

### A. Storage / migration 007

- pairing record: room, slot, connectionEpoch, provider/browser profile identity, conversation binding fingerprint, state, created/revoked timestamps
- wake delivery record: event/task reference, pairing reference, attempt count, last attempt, next eligible time, terminal status
- indexes สำหรับ active binding lookup และ bounded wake recovery หลัง restart
- migration ต้อง additive, backup-first และผ่าน reopen/rollback tests

### B. Broker / application service

- create pairing challenge แบบ one-time + short TTL
- confirm pairing โดยต้อง match room/slot/epoch และ user-confirmed extension handshake
- revoke/replace ทำ old binding unusable ทันที
- enqueue wake จาก visible Command Room event โดยไม่ execute agent task แทน agent
- recovery หลัง restart ต้องโหลด pending delivery และยังคง cooldown/attempt budget เดิม

### C. Desktop

- Agent card แสดง `UNPAIRED / PAIRED / STALE / OFFLINE / REVOKED`
- ปุ่ม Pair / Wake / Revoke / Replace chat
- ทุก wake แสดง target slot, reason, attempt, result, cooldown และ manual fallback
- ไม่ render secret, raw pairing token หรือ credential-like material หลัง pairing สำเร็จ

### D. Browser extension

- Manifest V3
- permission จำกัดเฉพาะ ChatGPT origin ที่รองรับและ NAVA local bridge ที่จำเป็น
- content logic ใช้ exact conversation binding ก่อน action ทุกครั้ง
- wake เป็น bounded visible action; DOM mismatch หรือ identity ambiguity = fail closed
- ไม่มี background scraping transcript และไม่มี credential extraction

## Acceptance gate

Phase 3 จะยังไม่ถือว่าผ่านจนกว่าจะมีหลักฐานต่อไปนี้ครบ:

1. **Wrong-tab wake = 0** ใน multi-tab test ที่มีอย่างน้อย 3 conversations
2. binding หมดอายุ/ถูก revoke/epoch เก่าไม่สามารถ wake หรือ transition ต่อได้
3. Replace chat เปลี่ยน authority ไป epoch ใหม่และ old tab ถูกปฏิเสธ
4. retry ไม่เกิน 3 ครั้งและ cooldown ไม่น้อยกว่า 60 วินาที
5. restart ระหว่าง pending wake แล้วยัง recover attempt budget/delivery state ถูกต้อง
6. extension offline แล้ว fallback เป็น Desktop notification / Copy wake prompt ได้
7. DOM contract เปลี่ยนแล้ว fail closed โดยไม่มีการ click/send ไป tab อื่น
8. UI/audit ไม่แสดง join code, agentSessionId, pairing secret, cookie, token, prompt history หรือ transcript
9. Phase 2B regressions ยังผ่าน: same-workspace writer block, cross-workspace concurrency, resource queue/recovery, ALL-RW routing
10. installed-runtime pilot ผ่านก่อนเปิด `extensionWakeEnabled`

## First implementation sequence

1. RED tests + migration 007 contract
2. storage repository + reopen/revoke tests
3. application pairing/wake state machine
4. IPC/Desktop status and controls
5. extension scaffold + exact conversation binding
6. bounded wake delivery + retry/cooldown/dead-letter
7. restart recovery + wrong-tab matrix
8. package/install pilot and rollback evidence

## Start command for the next run

`เริ่ม NAVA Command Room Phase 3 จาก docs/architecture/NAVA_COMMAND_ROOM_PHASE3_PLAN_TH.md ใช้ v4.11.4 เป็น frozen baseline ตรวจ Git/Phase tracker ก่อน แล้วเริ่ม RED tests + migration 007 contract โดยยังไม่ติดตั้ง runtime จนกว่าจะผ่าน source gate`
