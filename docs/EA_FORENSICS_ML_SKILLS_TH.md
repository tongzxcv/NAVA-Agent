# Skill วิเคราะห์ EA Forex สำหรับ NAVA

NAVA ใช้ Tool เดิมสำหรับอ่านไฟล์ ค้นโค้ด รันคำสั่ง Git งานเบื้องหลัง และ MT5 ได้อยู่แล้ว จึงเพิ่มเป็น Skill เฉพาะทาง 2 ตัวแทนการสร้าง Tool ซ้ำ

## 1. ea-forensics

ใช้เมื่ออยากแกะโครงสร้างหรือกฎของ EA จาก source, input, log, tester report หรือพฤติกรรมของ EX4/EX5 ที่ได้รับอนุญาต

ตัวอย่างคำสั่งใน ChatGPT:

> ใช้ NAVA ค้นหา Skill `ea-forensics` แล้วอ่าน Skill ก่อน วิเคราะห์โปรเจกต์ BEELZEBUB แบบ read-only แยกสิ่งที่พิสูจน์จาก source, runtime, สิ่งที่เป็นข้อสันนิษฐาน และสิ่งที่ยังไม่รู้ ห้ามแก้ไฟล์

ถ้ามีแต่ EX5:

> ใช้ `ea-forensics` โหมด black-box วางแผนทดลองแบบเปลี่ยนทีละตัวแปร ห้ามอ้างว่ากู้ source ได้ และยังไม่รัน MT5 จนกว่าผมยืนยัน

## 2. ea-ml-research

ใช้เมื่อสร้างหรือตรวจ ML/AI สำหรับสัญญาณ Regime Filter Entry Exit หรือ Risk โดยเน้น data leakage, feature availability, walk-forward, calibration, trading cost, drift และ OOS

ตัวอย่างคำสั่ง:

> ใช้ NAVA ค้นหาและอ่าน Skill `ea-ml-research` ตรวจชุดข้อมูลและแผน ML ของ Autobots แบบ read-only ก่อน รายงาน leakage, split, baseline, feature provenance และหลักฐานที่ยังขาด ห้าม train หรือแก้ไฟล์จนกว่าผมยืนยัน

ถ้ากำลังหา Candidate จากข้อมูลเก่าแล้วจะเก็บ Forward ใหม่:

> แยก discovery กับ confirmation ให้ชัด Freeze และ preregister สูตร Candidate, baseline, metric, เวลาเริ่มเก็บข้อมูลใหม่ และ gate 30/50/100 cases ก่อน ห้ามนำข้อมูล discovery มานับซ้ำ และคง Live ตัวเดิมไว้จนกว่าจะผ่าน gate และผมยืนยัน

ถ้าแก้เฉพาะ UI/Input โดยห้ามกระทบ Logic เทรด:

> ใช้ `ea-forensics` ล็อก scope เป็น UI/Input only เทียบฟังก์ชัน trade-critical ก่อนและหลัง ทดสอบค่าเวลา/อินพุตว่าเทียบเท่าของเดิม ระบุ Tester/Runtime ที่ยังไม่ได้รัน และถ้าชื่อ input เปลี่ยนให้สร้าง `.set` ใหม่พร้อมคู่มือย้ายค่า

## ระดับหลักฐาน

- `PROVEN_SOURCE` — มี source และตำแหน่งอ้างอิงชัดเจน
- `PROVEN_RUNTIME` — พิสูจน์ด้วยการทำงานจริงแบบควบคุมได้
- `SUPPORTED_INFERENCE` — หลักฐานสนับสนุน แต่ยังไม่รู้ implementation จริง
- `CONTRADICTED` — หลักฐานขัดแย้ง
- `UNKNOWN` — หลักฐานไม่พอหรือยังไม่ได้สอบเทียบ

Skill ทั้งสองไม่รับรองกำไรหรือความพร้อม Live การทดสอบเชิงกลยุทธ์ต้องส่งต่อให้ `ea-research-lab` และเก็บหลักฐานขนาดใหญ่ใน `E:\AI_CACHE\mt5-backtests`
