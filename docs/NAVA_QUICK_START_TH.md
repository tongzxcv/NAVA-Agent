---
title: คู่มือเริ่มใช้ NAVA Agent
version: 4.8.5
updated: 2026-08-24
---

# คู่มือเริ่มใช้ NAVA Agent v4.8.5

NAVA Agent เชื่อม ChatGPT หรือ Codex เข้ากับไฟล์ Git คำสั่ง และโปรแกรมบนเครื่อง Windows ของคุณผ่าน MCP โดยงานยังรันอยู่บนเครื่องนี้

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

ถ้าใช้เฉพาะ Codex บนเครื่อง ไม่จำเป็นต้องเปิด Secure Tunnel ตลอดเวลา แต่ Local MCP ต้องทำงาน

## ใช้กับ Codex Desktop หรือ Codex CLI

ตรวจการตั้งค่าด้วยคำสั่ง:

```powershell
codex mcp list
```

ควรเห็น MCP ชื่อ `nava` ชี้ไปที่:

```text
http://127.0.0.1:18765/mcp
```

จากนั้นสั่งใน Codex ได้ตรง ๆ เช่น:

```text
ใช้ NAVA ตรวจ git status ของโปรเจกต์ THANATOS แบบอ่านอย่างเดียว แล้วสรุปจำนวนไฟล์
```

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

### โปรแกรมยังทำงานหลังปิดหน้าต่าง

NAVA อาจซ่อนไปที่ System Tray ตามค่าปัจจุบัน ให้คลิกไอคอน NAVA ข้างนาฬิกาเพื่อเปิด หรือเลือก Quit เพื่อปิดทั้งหมด

## ตำแหน่งสำคัญบนเครื่องนี้

- โปรแกรม: `D:\Program Files\NAVA Agent`
- Shortcut: `C:\Users\Public\Desktop\NAVA Agent.lnk`
- Local MCP: `http://127.0.0.1:18765/mcp`
- คู่มือ PDF: `C:\Users\Endlessly\Desktop\คู่มือ NAVA Agent.pdf`

ถ้าสถานะไม่ตรงคู่มือนี้ ให้บอกข้อความ error ตามที่เห็นในหน้า NAVA หรือ Doctor โดยไม่ส่ง Runtime API key
