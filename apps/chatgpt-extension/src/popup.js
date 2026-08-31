/* global URL, chrome, document, navigator */

(() => {
  'use strict';

  const payloadInput = document.getElementById('pairing-payload');
  const pairButton = document.getElementById('pair-button');
  const checkButton = document.getElementById('check-button');
  const copyOriginButton = document.getElementById('copy-origin-button');
  const status = document.getElementById('status');
  const binding = document.getElementById('binding');

  const messages = Object.freeze({
    INVALID_PAIRING: 'Pairing payload ไม่ถูกต้อง',
    BRIDGE_URL_INVALID: 'Bridge URL ไม่ใช่ loopback ของ NAVA',
    PAIRING_EXPIRED: 'Pairing payload หมดอายุ ให้สร้างใหม่ใน NAVA',
    ORIGIN_NOT_ALLOWLISTED: 'ยังไม่ได้เพิ่ม Extension Origin ใน NAVA allowlist',
    CONVERSATION_MISMATCH: 'แท็บนี้ไม่ใช่บทสนทนาที่รองรับหรือไม่ตรงกับ pairing',
    TAB_NOT_FOUND: 'ไม่พบแท็บบทสนทนาที่จับคู่ไว้',
    AMBIGUOUS_TAB: 'พบแท็บบทสนทนาเดียวกันมากกว่าหนึ่งแท็บ',
    TAB_UNAVAILABLE: 'แท็บเป้าหมายไม่พร้อมใช้งาน',
    DOM_MISMATCH: 'หน้า ChatGPT เปลี่ยนโครงสร้างหรือกำลังทำงานอยู่ จึงหยุดอย่างปลอดภัย',
    COMPOSER_NOT_EMPTY: 'ช่องข้อความมีร่างค้างอยู่ จึงไม่แตะต้องช่องข้อความ',
    BRIDGE_UNAVAILABLE: 'เชื่อมต่อ NAVA Bridge ไม่ได้ ตรวจว่า NAVA เปิดและเปิด Extension Wake แล้ว',
    INVALID_BRIDGE_RESPONSE: 'NAVA Bridge ตอบกลับไม่ตรงสัญญา',
    UNPAIRED: 'ยังไม่ได้จับคู่แท็บกับ NAVA',
    PAIRING_MISMATCH: 'NAVA ยืนยัน binding ไม่ตรงกับ payload',
    EXTENSION_INTERNAL: 'Extension หยุดการทำงานเพื่อป้องกันการส่งผิดแท็บ',
  });

  function textFor(code) {
    return messages[code] ?? 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
  }

  function setStatus(value, code = null) {
    status.textContent = code === null ? value : textFor(code);
  }

  function renderState(state) {
    if (state === null) {
      binding.textContent = '';
      setStatus(textFor('UNPAIRED'));
      return;
    }
    binding.textContent = `${state.slotKey ?? 'Agent'} · binding ${state.bindingId} · epoch ${state.connectionEpoch}`;
    setStatus('จับคู่แล้ว — กดตรวจ wake ได้');
  }

  async function refreshState() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (result?.ok === true) renderState(result.state);
      else setStatus('', result?.code);
    } catch {
      setStatus('', 'EXTENSION_INTERNAL');
    }
  }

  pairButton.addEventListener('click', async () => {
    pairButton.disabled = true;
    setStatus('กำลังจับคู่…');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'PAIR_ACTIVE_TAB', payloadText: payloadInput.value });
      if (result?.ok === true) {
        payloadInput.value = '';
        renderState(result.state);
      } else {
        setStatus('', result?.code);
      }
    } catch {
      setStatus('', 'EXTENSION_INTERNAL');
    } finally {
      pairButton.disabled = false;
    }
  });

  checkButton.addEventListener('click', async () => {
    checkButton.disabled = true;
    setStatus('กำลังตรวจ wake…');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'CHECK_WAKES' });
      if (result?.ok === true) {
        setStatus(`แสดง wake แล้ว ${result.deliveredCount} รายการ · ล้มเหลว ${result.failedCount} รายการ · ค้าง ${result.pendingCount} รายการ`);
      } else {
        setStatus('', result?.code);
      }
    } catch {
      setStatus('', 'EXTENSION_INTERNAL');
    } finally {
      checkButton.disabled = false;
    }
  });

  copyOriginButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(new URL(chrome.runtime.getURL('/')).origin);
      setStatus('คัดลอก Extension Origin แล้ว — เพิ่มใน NAVA allowlist');
    } catch {
      setStatus('', 'EXTENSION_INTERNAL');
    }
  });

  void refreshState();
})();
