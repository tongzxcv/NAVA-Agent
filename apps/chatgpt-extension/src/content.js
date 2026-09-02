/* global NavaExtension, chrome, document, location, navigator, window */

(() => {
  'use strict';

  const CONTENT_SENTINEL = '__navaCommandRoomWakeContentV1';
  if (globalThis[CONTENT_SENTINEL] === true) return;
  globalThis[CONTENT_SENTINEL] = true;

  const BANNER_ID = 'nava-command-room-wake-banner';
  const STYLE_ID = 'nava-command-room-wake-style';
  let navigationTimer = null;

  function removeBanner() {
    if (navigationTimer !== null) {
      window.clearInterval(navigationTimer);
      navigationTimer = null;
    }
    document.getElementById(BANNER_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BANNER_ID} { position: fixed; z-index: 2147483647; top: 14px; right: 14px; max-width: 390px; padding: 14px 16px; border: 1px solid #62d9c4; border-radius: 12px; background: #071b25; color: #e7fffa; box-shadow: 0 10px 30px rgba(0,0,0,.35); font: 14px/1.45 system-ui, sans-serif; }
      #${BANNER_ID} strong { display: block; margin-bottom: 5px; }
      #${BANNER_ID} small { display: block; color: #b5d8d2; margin-bottom: 10px; overflow-wrap: anywhere; }
      #${BANNER_ID} button { border: 0; border-radius: 7px; padding: 7px 10px; background: #62d9c4; color: #06231f; cursor: pointer; font-weight: 700; }
      #${BANNER_ID} button + button { margin-left: 8px; }
      #${BANNER_ID} button:disabled { opacity: .55; cursor: default; }
      #${BANNER_ID} button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    `;
    document.head?.appendChild(style);
  }

  function showWake(message, expectedConversationRef) {
    if (NavaExtension.conversationRefFromUrl(location.href) !== expectedConversationRef) {
      return { ok: false, errorCode: 'CONVERSATION_MISMATCH' };
    }
    const composer = NavaExtension.inspectComposer(document);
    if (!composer.ok) return composer;
    if (!document.body) return { ok: false, errorCode: 'DOM_MISMATCH' };
    removeBanner();
    installStyle();
    const banner = document.createElement('aside');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'status');
    const title = document.createElement('strong');
    title.textContent = 'NAVA มีงานรอต่อ';
    const detail = document.createElement('small');
    const eventKey = typeof message.eventKey === 'string' ? message.eventKey.slice(0, 160) : '';
    const taskId = typeof message.taskId === 'string' ? message.taskId.slice(0, 120) : '';
    detail.textContent = [eventKey, taskId].filter(Boolean).join(' · ') || 'ตรวจ Command Room เพื่อดูรายละเอียด';
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'คัดลอกคำสั่งต่อ';
    const acknowledgeButton = document.createElement('button');
    acknowledgeButton.type = 'button';
    acknowledgeButton.disabled = true;
    acknowledgeButton.textContent = 'ฉันส่งในแชทแล้ว';
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(NavaExtension.WAKE_PROMPT);
        copyButton.textContent = 'คัดลอกแล้ว — วางและส่งเอง';
        acknowledgeButton.disabled = false;
      } catch {
        copyButton.textContent = 'คัดลอกไม่ได้ — เปิด Command Room';
      }
    });
    acknowledgeButton.addEventListener('click', async () => {
      if (acknowledgeButton.disabled || typeof message.wakeId !== 'string') return;
      acknowledgeButton.disabled = true;
      try {
        const result = await chrome.runtime.sendMessage({ type: 'ACK_WAKE_SUBMITTED', wakeId: message.wakeId });
        if (result?.ok === true) {
          removeBanner();
          return;
        }
        acknowledgeButton.textContent = 'ยืนยันไม่สำเร็จ — ลองใหม่';
        acknowledgeButton.disabled = false;
      } catch {
        acknowledgeButton.textContent = 'ยืนยันไม่สำเร็จ — ลองใหม่';
        acknowledgeButton.disabled = false;
      }
    });
    banner.append(title, detail, copyButton, acknowledgeButton);
    document.body.appendChild(banner);
    const checkNavigation = () => {
      if (NavaExtension.conversationRefFromUrl(location.href) !== expectedConversationRef) removeBanner();
    };
    navigationTimer = window.setInterval(checkNavigation, 1_000);
    return { ok: true, delivery: 'shown' };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!NavaExtension.isRecord(message) || message.type !== 'NAVA_WAKE') return false;
    let result;
    try {
      result = showWake(message, message.expectedConversationRef);
    } catch {
      result = { ok: false, errorCode: 'DOM_MISMATCH' };
    }
    sendResponse(result);
    return false;
  });
})();
