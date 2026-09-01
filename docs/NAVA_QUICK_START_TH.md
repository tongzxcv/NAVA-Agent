---
title: คู่มือเริ่มใช้ NAVA Agent
version: 4.11.0
updated: 2026-08-28
---

# คู่มือเริ่มใช้ NAVA Agent v4.11.0

NAVA Agent เชื่อม ChatGPT หรือ Codex เข้ากับไฟล์ Git คำสั่ง และโปรแกรมบนเครื่อง Windows ของคุณผ่าน MCP โดยงานยังรันอยู่บนเครื่องนี้

รุ่น v4.10.0 เพิ่ม **WSE (Workspace State Engine)** สำหรับเก็บผลลัพธ์การทำงานแบบไม่เก็บเนื้อหา ประเมินความสำเร็จ/ความเร็ว และจัดอันดับกลยุทธ์แบบออฟไลน์ โดยต้องให้ผู้ใช้ยืนยันก่อนเปลี่ยนกลยุทธ์เสมอ

รุ่น v4.10.1 เพิ่ม **Secure SSH สำหรับ VPS** ใช้ key หรือ SSH agent เท่านั้น ตรวจ host key เสมอ และไม่รับรหัสผ่านหรือเนื้อหา private key ผ่าน Chat/MCP

รุ่น v4.10.2 เพิ่ม **Rolling Checkpoint แยกตามโปรเจกต์** ช่วยให้เปิดแชทใหม่แล้วทำงานต่อได้ แม้แชทเก่าจะเต็มก่อนสั่งสรุป

รุ่น v4.11.0 ปรับปรุงความต่อเนื่องและความเสถียร 5 ด้าน:

1. **Continuity Control** — บันทึก checkpoint อัตโนมัติหลังงานเขียน/งานสำคัญ เพื่อเปิดแชทใหม่แล้วต่อจากจุดล่าสุดได้
2. **Essential Tool Discovery** — ระบุเครื่องมือหลักและ `manifestVersion` ให้แชทตรวจ schema เก่า/ใหม่ได้ชัดเจน
3. **End-to-End Tunnel Health** — แยกสถานะ process, Local MCP, control plane และ connector schema ไม่รายงานว่าเชื่อมต่อสมบูรณ์จากการตรวจเพียงชั้นเดียว
4. **Bounded Evidence Stream** — จำกัดผลลัพธ์และหมุนเก็บ log ตามขนาด เพื่อป้องกัน log ใหญ่ทำให้แชทหรือตัว tunnel หลุด
5. **Workspace Authority** — แสดง Workspace และ writer lease ที่กำลังถืออยู่ ช่วยประสานหลายแชท/หลายโปรเจกต์โดยไม่เขียนชนกัน

> สำคัญ: NAVA ไม่ได้ทำให้โควต้า AI ไม่จำกัด การใช้จาก Chat ปกติจะนับตามแผนและข้อจำกัดของ ChatGPT ส่วน Codex/Work ใช้สิทธิ์ของผลิตภัณฑ์นั้น

## เริ่มใช้งานทุกวันแบบสั้นที่สุด

1. เปิด **NAVA Agent** จาก Shortcut บน Desktop
2. ที่หน้าหลัก ตรวจว่าแสดง **Agent พร้อมทำงาน**
3. เลือกโปรเจกต์ที่ต้องการ เช่น `THANATOS`
4. ถ้าใช้ Codex Desktop/CLI ในเครื่อง ให้เรียก MCP ชื่อ `nava` ได้ทันที
5. ถ้าใช้ ChatGPT Web ให้กด **เริ่ม Tunnel** แล้วรอข้อความ **Tunnel เชื่อมต่อแล้ว**
6. เปิด ChatGPT เลือก **NAVA Agent** จากเมนู Apps/Tools แล้วสั่งงาน

ตัวอย่างคำสั่งแรกที่ปลอดภัย:

```text
ใช้ NAVA แสดงรายชื่อ Workspace แบบอ่านอย่างเดียว ห้ามแก้ไขไฟล์
```

## วิธีดูว่าสถานะพร้อมหรือยัง

| จุดตรวจ | ค่าที่ควรเห็น |
|---|---|
| Agent | `Agent พร้อมทำงาน` |
| Local MCP | `http://127.0.0.1:18765/mcp` |
| ChatGPT Tunnel | `Tunnel เชื่อมต่อแล้ว` |
| โปรเจกต์ | ชื่อและ path ของโปรเจกต์ที่ต้องการ |
| Doctor | รายการหลักขึ้น Available/Ready |

หน้า Home รุ่นใหม่อาจแสดงสุขภาพแยกเป็นหลายชั้น หาก `Control plane` หรือ `Connector schema` เป็น `unknown` หมายถึง NAVA ตรวจชั้นนั้นจากเครื่องนี้ไม่ได้ ไม่ใช่หลักฐานว่า ChatGPT เชื่อมสำเร็จแล้ว ให้ทดสอบ `workspace_list` จากแชทจริงอีกครั้ง

ถ้าใช้เฉพาะ Codex บนเครื่อง ไม่จำเป็นต้องเปิด Secure Tunnel ตลอดเวลา แต่ Local MCP ต้องทำงาน

## ใช้หลายแชทพร้อมกันอย่างปลอดภัย

- หลายแชทอ่านไฟล์พร้อมกันได้ตามปกติ โดยเฉพาะเมื่อทำคนละโปรเจกต์
- ก่อนเริ่มงานหลายแชท ให้สั่ง `workspace_authority` แบบอ่านอย่างเดียวเพื่อดู Workspace และ writer ที่กำลังใช้งาน
- ถ้าจะแก้ไฟล์ ให้แต่ละแชทขอ **Workspace Lease** ของโปรเจกต์นั้นก่อนเริ่มเขียน
- ถ้ามีแชทอื่นถือ Lease อยู่ ให้หยุดรอหรือไปทำโปรเจกต์อื่น ห้ามฝืนแก้ไฟล์เดียวกัน
- NAVA v4.11.3 รองรับ **ALL-RW participant mode**: MAIN และ LEAD ทุกตัวรับ READ_ONLY/WRITE task ของ registered Workspace ใดก็ได้; acceptance 3 writer/restart ผ่านแล้ว และ same-workspace writer collision ยังถูก block
- Shared resource เช่น MT5 terminal, VPS writer, managed browser หรือ GPU ยังมี capacity/queue ของตัวเอง แยกจากจำนวน Workspace writers; writer 3 คนทำพร้อมกันได้แต่ resource เดียวกันอาจต้องรอคิว
- สำหรับ BEELZEBUB, RATCHET และ AUTOBOTS ให้ถือชื่อโปรเจกต์เป็น **initial focus เท่านั้น** ไม่ใช่ access boundary; ตัวไหนว่างสามารถสลับไปอ่านหรือเขียนอีกสองโปรเจกต์ได้เมื่อ MAIN assign และ writer lease ว่าง
- เมื่อทำงานเสร็จ ให้ปล่อย Lease ระบบมีวันหมดอายุเพื่อกู้คืนกรณีแชทหยุดกลางทาง

ตัวอย่างคำสั่งสำหรับงานเขียน:

```text
ใช้ NAVA ขอ Workspace Lease สำหรับโปรเจกต์ THANATOS ก่อนแก้ไฟล์
ถ้ามีแชทอื่นใช้อยู่ให้รายงานและหยุด ทำงานเสร็จแล้วปล่อย Lease
```

ตัวอย่างคำสั่งสำหรับตรวจสถานะโดยไม่แก้ไฟล์:

```text
ใช้ NAVA ตรวจ Workspace Lease และสถานะโปรเจกต์แบบอ่านอย่างเดียว
ห้ามสร้าง แก้ไข หรือลบไฟล์
```

เครื่องมือที่เกี่ยวข้องคือ `workspace_authority`, `workspace_lease_acquire`, `workspace_lease_status`, `workspace_lease_renew`, `workspace_lease_release` และ `workspace_lease_call` โดยปกติให้สั่งเป็นภาษาไทยได้ ไม่จำเป็นต้องพิมพ์พารามิเตอร์ MCP เอง

## ทำงานต่อเมื่อแชทเก่าเต็ม

NAVA เก็บ Rolling Checkpoint นอกโฟลเดอร์โปรเจกต์ จึงไม่ทำให้ Git มีไฟล์เกินมา ระบบแยก checkpoint ด้วยชื่อโปรเจกต์และ Workspace ID

งานเขียนหรือคำสั่งสำคัญจะสร้าง **automatic milestone checkpoint** ให้เองเมื่อระบุ Workspace ได้ จึงไม่ต้องรอให้แชทเก่าสั่งสรุปก่อนเต็ม แต่ checkpoint เป็นเพียงจุดเริ่มตรวจสอบ ไม่ใช่หลักฐานว่าไฟล์/งานล่าสุดสำเร็จแล้ว

เปิดแชทใหม่แล้วสั่งสั้น ๆ:

```text
ใช้ NAVA ทำงานต่อโปรเจกต์ BEELZEBUB จาก checkpoint ล่าสุด
ตรวจ Git และ Obsidian ก่อน แล้วทำขั้นถัดไป
```

ระหว่างงาน NAVA ควรเรียก `session_checkpoint` ก่อนงานยาว และหลังแก้ไฟล์ ตรวจผล commit ติด blocker หรือเปลี่ยนขั้นตอน จากนั้นแชทใหม่ใช้ `session_resume` เพื่ออ่าน checkpoint ล่าสุดของโปรเจกต์นั้น

ถ้าแชทเต็มก่อนมีข้อความสรุป ให้เปิดแชทใหม่แล้วใช้คำสั่งนี้ได้ทันที:

```text
ใช้ NAVA เรียก session_resume สำหรับโปรเจกต์ BEELZEBUB EA
ตรวจ checkpoint ล่าสุดกับ Git, durable task และ Obsidian ก่อน
รายงานจุดที่ทำเสร็จ จุดที่ค้าง และ nextAction แล้วทำต่อจากจุดนั้น
```

ถ้าโปรเจกต์ใช้ **NAVA Command Room** ให้ตรวจ session เพิ่มอีกชั้น ห้ามถือว่า checkpoint หรือข้อความ bootstrap คือ session ที่ใช้งานได้:

```text
เข้าห้องเดิมด้วย roomId และ slotKey ที่กำหนด
ถ้ายังไม่มี session ให้ MAIN rebind แล้ว join ด้วย connectionEpoch ใหม่
ส่ง heartbeat จาก session ใหม่ แล้วตรวจ command_room_status resume_check
ทำงานต่อเมื่อ authority เป็น READY เท่านั้น
```

ผล `SLOT_NOT_FOUND` แปลว่ายังไม่มี slot จริง, `CREATE_SESSION_REQUIRED` แปลว่าต้อง join/rebind, และ `HEARTBEAT_REQUIRED` แปลว่าต้อง heartbeat แล้วอ่านสถานะกลับอีกครั้ง ข้อมูลส่งต่อข้ามแชทเก็บได้เฉพาะ `roomId`, `slotKey`, `connectionEpoch`; ห้ามบันทึก join code หรือ `agentSessionId` ลง Git/Obsidian/log

Checkpoint ไม่ใช่หลักฐานสุดท้าย จึงต้องตรวจ Git, durable task และ Obsidian/tracker ก่อนแก้ไฟล์ต่อ และจะไม่เก็บ prompt, ข้อความแชท, API key, private key หรือ log ขนาดใหญ่

## เก็บหลักฐานเมื่อ NAVA มีปัญหา

สั่งให้ NAVA เรียก `diagnostic_bundle_create` เพื่อรวบรวมเวอร์ชัน สุขภาพระบบ งานที่กำลังทำ recovery และ log ล่าสุดแบบจำกัดขนาดและปกปิดข้อมูลลับ

```text
ใช้ NAVA สร้าง Diagnostic Bundle แบบอ่านอย่างเดียว แล้วสรุปสาเหตุที่เป็นไปได้
ห้ามแก้ไขไฟล์หรือเปิดเผย Runtime API key
```

เริ่มจากคำสั่งนี้ก่อน restart เพราะช่วยแยกได้ว่าปัญหาอยู่ที่ Local MCP, Secure Tunnel, Workspace Lease หรืองานเดิมที่ยังค้าง

## ใช้ WSE ให้ NAVA เรียนรู้จากผลการทำงาน

WSE เก็บเฉพาะชื่อเครื่องมือ ผลสำเร็จ/ผิดพลาด ระยะเวลา Workspace และ hash ของเป้าหมาย ไม่เก็บ prompt เนื้อหาไฟล์ API key หรือผลลัพธ์ดิบ

```text
ใช้ NAVA เรียก wse_experience_capture เพื่อเก็บสรุปงานล่าสุด
จากนั้นเรียก wse_evaluate และ wse_strategy_score แล้วรายงานผลแบบอ่านอย่างเดียว
ห้าม promote กลยุทธ์จนกว่าผมจะยืนยัน
```

ถ้าต้องการเปลี่ยนกลยุทธ์ ให้ตรวจว่ามีหลักฐานอย่างน้อย 10 รายการ แล้วสั่งยืนยันชื่อ `baseline`, `reliability-first` หรือ `latency-first` การเปลี่ยนนี้มีผลเฉพาะลำดับแนะนำเครื่องมือ ไม่เปลี่ยนสิทธิ์หรือข้ามการยืนยันคำสั่งอันตราย

```text
ใช้ NAVA แสดง wse_strategy_status และคะแนนทั้งหมดก่อน
ถ้าหลักฐานพอ ให้ promote reliability-first โดยถือว่าผมยืนยันแล้ว
```

ย้อนกลับได้ด้วย `wse_strategy_promote` โดยใช้ action `rollback` และต้องยืนยันอีกครั้ง ระบบไม่มีการ promote อัตโนมัติ

## ใช้กับ Codex Desktop หรือ Codex CLI

ตรวจการตั้งค่าด้วยคำสั่ง:

```powershell
codex mcp list
```

ถ้า Codex แจ้งว่าเครื่องมือไม่ครบหรือ schema เก่า ให้สั่ง refresh/reconnect NAVA ก่อน แล้วตรวจ `capabilities` หรือ `tool_categories` ที่มี `manifestVersion` ใหม่ ไม่ควรเดาชื่อเครื่องมือหรือพิมพ์ input ของ lease เอง

ควรเห็น MCP ชื่อ `nava` ชี้ไปที่:

```text
http://127.0.0.1:18765/mcp
```

จากนั้นสั่งใน Codex ได้ตรง ๆ เช่น:

```text
ใช้ NAVA ตรวจ git status ของโปรเจกต์ THANATOS แบบอ่านอย่างเดียว แล้วสรุปจำนวนไฟล์
```

## ให้ NAVA เข้า VPS ผ่าน Secure SSH

NAVA ใช้ OpenSSH ที่มากับ Windows ไม่ควบคุมหน้าต่าง Remote Desktop จึงเหมาะกับคำสั่ง ติดตั้งระบบ ตรวจ log และรับส่งไฟล์ ส่วนงานที่ต้องเห็น GUI เช่น MT5 ยังใช้ RDP ตามปกติ

### ตั้งค่าครั้งแรก

1. เตรียม SSH key สำหรับ VPS และติดตั้ง public key ที่ฝั่ง VPS
2. สร้างไฟล์ `%USERPROFILE%\.ssh\config`
3. เพิ่ม Host alias โดยแทนค่าตัวอย่างด้วยข้อมูลจริง:

```sshconfig
Host nava-vps
  HostName <VPS-IP-OR-DNS>
  User <VPS-USER>
  IdentityFile C:\Users\<WINDOWS-USER>\.ssh\id_ed25519
  IdentitiesOnly yes
  StrictHostKeyChecking yes
```

4. เปิด PowerShell แล้วเชื่อมครั้งแรกด้วย `ssh nava-vps` เพื่อตรวจ fingerprint กับผู้ให้บริการ VPS และบันทึกลง `known_hosts`
5. ห้ามใส่ password, private key หรือ Runtime API key ลงใน Chat

### ทดสอบจาก NAVA

```text
ใช้ NAVA เรียก remote_ssh operation=status แล้วตรวจว่า OpenSSH พร้อม
จากนั้นเรียก operation=test ด้วย profile nava-vps และ Workspace ปัจจุบัน แบบไม่แก้ไข VPS
```

### สั่งงาน Linux VPS

```text
ใช้ NAVA ผ่าน remote_ssh profile nava-vps, remote_shell=posix
รัน executable uname พร้อม arguments -a ใน Workspace ปัจจุบัน
```

### สั่งงาน Windows VPS

```text
ใช้ NAVA ผ่าน remote_ssh profile nava-vps, remote_shell=powershell
รัน executable Get-ComputerInfo ใน Workspace ปัจจุบัน
```

งานนานให้ใช้ `execution=background` แล้วเก็บ `task_id` เพื่อตรวจด้วย `status`, `logs`, `wait`, `result` หรือยกเลิกด้วย `cancel`

การ upload/download ใช้ `local_path` แบบ absolute ที่อยู่ใน Workspace/Capability Roots เท่านั้น และใช้ `remote_path` ฝั่ง VPS การโอนไฟล์อาจเขียนทับข้อมูล จึงต้องยืนยันใน Chat ก่อน

ถ้า `test` ไม่ผ่าน:

- `Host key verification failed` — ตรวจ fingerprint และ `known_hosts`; NAVA จะไม่ปิดการตรวจ host key ให้
- `Permission denied (publickey)` — ตรวจ User, IdentityFile, public key บน VPS หรือ SSH agent
- `Could not resolve hostname` — ตรวจ HostName/DNS ใน SSH config
- `Connection timed out/refused` — ตรวจพอร์ต 22, firewall และบริการ SSH ฝั่ง VPS

## ใช้กับ ChatGPT Web

1. เปิด NAVA และกด **เริ่ม Tunnel**
2. รอให้สถานะเป็น **Tunnel เชื่อมต่อแล้ว**
3. เปิด ChatGPT ด้วยบัญชีที่ผูกกับ Tunnel
4. เปิดแชตใหม่ แล้วเลือก **NAVA Agent** จากเมนู Apps/Tools
5. เริ่มด้วยงานอ่านอย่างเดียวเพื่อตรวจการเชื่อมต่อ

ตัวอย่าง:

```text
ใช้ NAVA เรียก workspace_list แบบอ่านอย่างเดียว แล้วสรุปผล ห้ามสร้างหรือแก้ไขไฟล์
```

เมื่อได้รายชื่อไดรฟ์และโปรเจกต์ แสดงว่าทาง `ChatGPT -> OpenAI Tunnel -> NAVA ในเครื่อง` ทำงานครบ

## เปลี่ยนบัญชี OpenAI ในอนาคต

### กรณี A: เปลี่ยนบัญชี แต่ยังใช้องค์กร/Workspace เดิม

1. ที่หน้าหลัก NAVA กด **หยุด Tunnel**
2. เข้าระบบ Platform และ ChatGPT ด้วยบัญชีใหม่
3. ให้ผู้ดูแลองค์กรเพิ่มบัญชีใหม่และสิทธิ์ **Tunnels Read + Use**
4. เพิ่มบัญชีหรือ ChatGPT Workspace ใหม่เข้า Tunnel เดิม
5. ใน NAVA ไปที่ **ตั้งค่า > Secure Tunnel**
6. ถ้าสร้าง Runtime API key ใหม่ ให้ใส่ช่อง **Runtime API key** แล้วกด **เปลี่ยนคีย์**
7. ถ้า Tunnel ID เดิมไม่เปลี่ยน ไม่ต้อง Configure ใหม่
8. กลับหน้าหลัก กด **เริ่ม Tunnel** แล้วเปิด **Doctor** เพื่อตรวจ
9. เชื่อม NAVA Agent ใน ChatGPT บัญชีใหม่

### กรณี B: เปลี่ยนไปองค์กรหรือ Workspace ใหม่

1. หยุด Tunnel ใน NAVA
2. เปิด [OpenAI Platform Tunnels](https://platform.openai.com/settings/organization/tunnels) ด้วยบัญชีใหม่
3. เพิ่ม organization/workspace ใหม่ให้ Tunnel เดิม หรือสร้าง Tunnel ใหม่
4. สร้าง Runtime API key สำหรับ `tunnel-client`
5. ใน NAVA ไปที่ **ตั้งค่า > Secure Tunnel** แล้วบันทึก Runtime API key ใหม่
6. ถ้าได้ Tunnel ID ใหม่ ให้วางในช่อง **OpenAI Tunnel ID** แล้วกด **Configure Tunnel**
7. เริ่ม Tunnel และตรวจด้วย Doctor
8. เปิด ChatGPT บัญชีใหม่ แล้วสร้าง/เชื่อม App ชื่อ NAVA Agent กับ Tunnel นั้น
9. ทดสอบด้วย `workspace_list` แบบอ่านอย่างเดียว
10. เมื่อทดสอบผ่าน ให้เพิกถอน Runtime key เก่าที่ไม่ใช้แล้ว

> NAVA จะไม่แสดงคีย์เดิมกลับมา คีย์ถูกเก็บด้วย Windows DPAPI สำหรับบัญชี Windows เครื่องนี้

## ตั้งสิทธิ์ให้ปลอดภัย

- งานทั่วไป: ใช้ Permission Profile แบบ `Safe` หรือ `Balanced`
- ให้สิทธิ์เต็มเฉพาะเมื่อเข้าใจขอบเขต Workspace และคำสั่งที่จะรัน
- ใช้ **Strict Roots** เมื่ออยากจำกัด Secure Tunnel ให้เห็นเฉพาะโฟลเดอร์ที่กำหนด
- เริ่มงานสำคัญด้วยคำว่า “อ่านอย่างเดียว” แล้วค่อยอนุญาตการแก้ไข
- อย่าส่ง Runtime API key ใน Chat, Git, ภาพหน้าจอ หรือไฟล์เอกสาร
- ตรวจ Git diff ก่อน commit เสมอ โดยเฉพาะ repository ที่มีไฟล์เปลี่ยนจำนวนมาก

## แก้ปัญหาเร็ว

### กดเริ่ม Tunnel แล้วไม่เชื่อม

1. เปิด **ตั้งค่า > Secure Tunnel** ตรวจว่ามี Runtime key และ Tunnel profile
2. ตรวจ path ของ `tunnel-client.exe`
3. กลับหน้าหลัก กด **หยุด Tunnel** แล้ว **เริ่ม Tunnel** ใหม่
4. เปิดหน้า **Doctor** และกดตรวจ
5. ตรวจว่าเครื่องออกอินเทอร์เน็ต HTTPS ไป `api.openai.com:443` ได้

### Tunnel เชื่อม แต่ ChatGPT ไม่เห็น NAVA

- ตรวจว่า Tunnel ผูกกับ ChatGPT Workspace ของบัญชีที่กำลังล็อกอิน
- ตรวจว่าบัญชีนั้นมี **Tunnels Read + Use**
- เปิด Developer mode/Apps ตามสิทธิ์ของแผน ChatGPT
- ลบการเชื่อมต่อ NAVA เดิมใน ChatGPT แล้วเชื่อมใหม่ถ้าเปลี่ยนบัญชี

### Codex ไม่เห็น NAVA

รัน:

```powershell
codex mcp list
```

ถ้าไม่มี `nava` ให้เพิ่ม MCP URL `http://127.0.0.1:18765/mcp` ในการตั้งค่า Codex แล้วเปิด Codex ใหม่

### `shell`, `read_file` หรือ `accessibility` ขึ้น `ExceptionGroup` / `INTERNAL_ERROR`

1. สั่ง `diagnostic_bundle_create` แบบอ่านอย่างเดียวก่อน
2. สั่ง `workspace_authority` แบบอ่านอย่างเดียว ตรวจว่าเลือกโปรเจกต์ถูก และไม่มีแชทอื่นถือ Workspace Lease สำหรับงานเขียน
3. ถ้าทุกเครื่องมือผ่าน Secure Tunnel ล้มพร้อมกัน ให้กด **หยุด Tunnel** แล้ว **เริ่ม Tunnel** ใหม่หนึ่งครั้ง
4. เปิด **Doctor** แล้วส่งเฉพาะข้อความ error และเวลาที่เกิด ห้ามส่ง Runtime API key
5. อย่าสั่งงานเขียนซ้ำจนกว่าจะยืนยันว่า Lease และ Tunnel กลับมาปกติ

### ขึ้น `RESPONSE_TOO_LARGE` หรืออ่าน CSV/log ใหญ่ไม่ได้ทั้งไฟล์

NAVA ป้องกันไม่ให้ผลลัพธ์เกินขีดจำกัด Secure Tunnel จนทำให้ทุกแชทหลุด ให้เปลี่ยนเป็น:

- ใช้ `read_file_page` และกำหนด `pageSize` หรือ `responseTargetBytes` ให้เล็กลง
- ใช้ `search_text` หาเฉพาะส่วนที่ต้องการ แล้วอ่านเฉพาะช่วงบรรทัด
- สำหรับ `shell` ให้ลด `max_output_bytes` หรือรัน background แล้วอ่าน log แบบจำกัดจำนวนบรรทัด
- สำหรับหน้าจอ ให้ใช้ `observe_summary` หรือดูเฉพาะ element ที่ต้องการโดยไม่แนบ screenshot ขนาดใหญ่

Live Logs ของ v4.11.0 เก็บแบบ bounded และหมุนไฟล์อัตโนมัติ หากผลลัพธ์มี `truncated=true` ให้ลดช่วงเวลา/จำนวนรายการแล้ว query ใหม่ แทนการขอ log ทั้งหมด

เมื่อเจอ error นี้ Tunnel และแชทอื่นควรทำงานต่อได้ ไม่ต้อง restart NAVA

### มีหน้าต่าง JavaScript error ขึ้น `write EPIPE`

ให้อัปเดตเป็น NAVA v4.8.7 หรือใหม่กว่า รุ่นนี้ป้องกันตัวตรวจอัปเดตเขียน log ไปยัง console pipe ที่ปิดแล้ว จึงไม่ควรมีหน้าต่างเด้งซ้ำ

### โปรแกรมยังทำงานหลังปิดหน้าต่าง

NAVA อาจซ่อนไปที่ System Tray ตามค่าปัจจุบัน ให้คลิกไอคอน NAVA ข้างนาฬิกาเพื่อเปิด หรือเลือก Quit เพื่อปิดทั้งหมด

## ตำแหน่งสำคัญบนเครื่องนี้

- โปรแกรม: `D:\Program Files\NAVA Agent`
- Shortcut: `C:\Users\Public\Desktop\NAVA Agent.lnk`
- Local MCP: `http://127.0.0.1:18765/mcp`
- คู่มือ PDF: `%USERPROFILE%\Desktop\คู่มือ NAVA Agent.pdf`

ถ้าสถานะไม่ตรงคู่มือนี้ ให้บอกข้อความ error ตามที่เห็นในหน้า NAVA หรือ Doctor โดยไม่ส่ง Runtime API key
