# NAVA Command Room Phase 3C — Windows E2E Release Gate Recovery

วันที่วางแผน: 2026-08-30

ฐานโค้ด: `c9587dc` (`main` และ `feature/command-room-phase3`)

GitHub Actions หลักฐาน: run `33289914127`

## สถานะและคำตัดสิน

Phase 3C เป็น release-blocker phase ที่ต้องปิดก่อนทำ Browser Extension ต่อหรือเริ่มอัปเกรด MCP Core

- lint, typecheck, unit, integration และ acceptance ผ่านบน GitHub Actions
- Windows E2E ล้มทั้ง 3 เคสหลังรันรวมประมาณ 10 นาที
- local sequential E2E เคยผ่าน แต่ยังไม่ใช่หลักฐานเพียงพอสำหรับ release
- การแก้เฉพาะ temp-root cleanup / detached `taskkill` ยังไม่แก้ต้นเหตุ
- ห้ามแก้ด้วยการเพิ่ม timeout, blind retry หรือ global process kill อย่างเดียว

## Failure contract ที่ต้อง reproduce

1. `desktop-dashboard.e2e.ts` timeout ที่ 90 วินาที
2. `desktop-mcp-client.e2e.ts` timeout ที่ 180 วินาที และ Playwright trace teardown timeout เพิ่มอีก 30 วินาที
3. `electron-security.e2e.ts` เปิด renderer ได้ แต่ poll หา preload API/Node-global contract ไม่ทัน 5 วินาที

ผลที่สังเกตได้บ่งชี้ว่ามี startup/process ownership/teardown interaction ระหว่าง Electron E2E บน GitHub runner แต่ยังไม่ถือว่า root cause ถูกยืนยันจนกว่าจะมี process tree และ startup logs จาก failure จริง

## สมมติฐานตามลำดับความน่าจะเป็น

### H1 — Electron process tree เดิมยังไม่ settle ก่อนเคสถัดไป

`taskkill` ถูก start แบบ detached และ test รอเฉพาะ root child exit สูงสุด 8 วินาที จึงอาจมี Chromium/Electron descendants, lock หรือ port side effect เหลืออยู่

หลักฐานที่จะยืนยัน/หักล้าง:

- process tree ก่อน launch และหลัง cleanup พร้อม PID/PPID/command line
- owned descendant ยังอยู่หลัง root child exit
- การรันแต่ละ E2E ใน process/job แยกผ่านอย่างสม่ำเสมอ ขณะที่ sequential run ล้ม

### H2 — Desktop startup ทำ side effect ภายนอก fixture ก่อน renderer พร้อม

ทุก E2E เรียก `runtime.autoStartMcp()` ก่อน `createDesktopWindow()` และยังเริ่ม log/tray/updater lifecycle แม้ตั้ง `LNWJUD_E2E_FIXTURE=1` จึงอาจค้างที่ MCP/process/database/native capability startup บน runner

หลักฐานที่จะยืนยัน/หักล้าง:

- timestamped main-process log ตั้งแต่ `app.whenReady()` ถึง preload ready
- phase marker ระบุว่าค้างก่อน/หลัง `autoStartMcp`, window creation หรือ preload exposure
- fixture mode ที่ปิดเฉพาะ external auto-start side effects ทำให้ single-file GitHub run ผ่าน โดย flow test ยัง start MCP แบบ explicit ได้

### H3 — Playwright trace/teardown เป็นอาการซ้อน ไม่ใช่ต้นเหตุ

trace teardown timeout เกิดหลัง test body timeout จึงน่าจะขยายเวลาค้าง แต่ยังไม่อธิบาย dashboard และ security failure ทั้งหมด

หลักฐานที่จะยืนยัน/หักล้าง:

- single-file run ที่ปิด trace ยังค้างที่ startup จุดเดิม
- trace ถูกสร้างได้ปกติเมื่อ owned Electron tree settle ก่อน teardown

### H4 — GitHub runner ช้าอย่างเดียว

เป็นสมมติฐานลำดับต่ำ เพราะ timeout หลายระดับและความล้มเหลวต่อเนื่องกันชี้ไปที่ lifecycle/ownership มากกว่าความช้าธรรมดา

## Implementation slices

### 3C.1 — ทำ failure ให้มองเห็นได้

- เพิ่ม E2E run ID และ phase markers: spawn, devtools-ready, page-ready, preload-ready, MCP-ready, browser-closed, process-tree-settled
- capture stdout/stderr ของ Electron แบบ bounded และ redact-safe
- capture owned process tree + listening ports ตอน timeout และหลัง cleanup
- ให้ CI upload `test-results`, Playwright report, phase log และ process snapshot เสมอเมื่อ E2E ล้ม
- เพิ่มคำสั่งรัน E2E ทีละไฟล์โดยไม่ rebuild ซ้ำ เพื่อทำ diagnosis loop เร็วขึ้น

Gate: failure รอบถัดไปต้องบอกได้ว่าค้าง phase ใดและ PID ใด โดยไม่ต้องเดา

### 3C.2 — แยก test ownership

- ใช้ helper กลางหนึ่งตัวสำหรับ Electron launch/ready/cleanup แทน implementation ซ้ำ 3 ชุด
- สร้าง temp `LNWJUD_DATA_PATH`, user-data-dir, DevTools port และ test run ID แยกต่อ test
- kill เฉพาะ root PID และ descendants ที่ helper เป็นเจ้าของ
- รอ process tree settle ด้วย bounded deadline และรายงาน survivor; ห้าม `taskkill /IM electron.exe`, ห้าม kill NAVA ที่ผู้ใช้กำลังใช้
- รัน E2E แต่ละไฟล์เป็น isolated process ใน CI diagnosis matrix ก่อนกลับมารัน authoritative sequential suite

Gate: single-file E2E แต่ละตัวผ่าน 3 รอบติดบน GitHub runner และไม่มี owned survivor

### 3C.3 — ทำ fixture startup ให้ deterministic

- หลังได้หลักฐานจาก 3C.1 เท่านั้น จึงเพิ่ม fixture contract ที่ปิด external startup side effects ที่ไม่ใช่สิ่งกำลังทดสอบ
- dashboard/MCP flow ต้องยังทดสอบ MCP จริง; security test ต้องไม่เปิด updater/tunnel/native discovery ที่ไม่เกี่ยวข้อง
- preload/security assertions ต้องรอ explicit readiness signal แทน poll ที่ใช้ default 5 วินาที
- ห้ามเปลี่ยน production startup path หรือทำให้ E2E ผ่านด้วย mock renderer ทั้งหน้า

Gate: test ยังพิสูจน์ real Electron + real preload และ MCP-client test ยังพิสูจน์ real local MCP workflow

### 3C.4 — ปิด authoritative release gate

- รัน E2E 3 ไฟล์แบบ sequential 3 รอบบน GitHub runner
- รัน `scripts/verify-release.ps1` เต็มอย่างน้อย 2 GitHub runs ติด
- ยืนยัน package/release artifacts ถูกสร้างหลัง E2E ผ่าน ไม่ใช่จาก partial run
- บันทึก commit/run IDs และ failure artifacts ใน `docs/PHASE_PROGRESS.md`

Gate ปิด Phase 3C:

- latest `main` CI เป็นเขียว 2 รอบติด
- E2E 3/3 ผ่าน โดยไม่มี retry ซ่อนและไม่มี timeout เพิ่มเพื่อกลบอาการ
- cleanup ไม่แตะ process ที่ไม่ได้เป็นเจ้าของ
- installed NAVA/Tunnel ของผู้ใช้ไม่ถูกหยุดระหว่าง source/CI diagnosis

## ลำดับ Phase หลังจากนี้

1. **Phase 3C:** ปิด Windows E2E release blocker ตามเอกสารนี้
2. **Phase 3D:** Browser Extension package จริง + Pair/Wake UI + wrong-tab, composer, SPA, revoke/replace และ restart-recovery matrix
3. **Phase 3 release gate:** installed pilot แบบ opt-in, backup/rollback, แล้วจึงพิจารณา public v4.12.0
4. **Phase 4:** provider/Codex adapter แบบ opt-in ตาม roadmap เดิม; ห้ามผูก quota switching อัตโนมัติ
5. **Phase 5A:** MCP Core Reliability — project-scoped execution lanes, bounded admission/backpressure, truthful cancellation settlement และ structured recoverability

การอัปเกรด MCP Core จะไม่เริ่มก่อน Phase 3C เขียว เพราะ CI ที่เชื่อถือไม่ได้จะทำให้วัด regression ของ execution supervisor ไม่ได้

## First action สำหรับรอบ implementation

เริ่มที่ 3C.1 เท่านั้น: เพิ่ม diagnostic artifact + phase/process evidence แล้ว push เพื่อเก็บ failure รอบจริงหนึ่งรอบ ก่อนเลือกแก้ H1 หรือ H2
