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

  const continuationSubmissionAttempts = new Set();

  function visibleComposerControls() {
    return [...document.querySelectorAll('[contenteditable="true"], textarea')].filter((element) => {
      if (element.hidden === true) return false;
      if (typeof element.getAttribute === 'function' && element.getAttribute('aria-hidden') === 'true') return false;
      if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
      return true;
    });
  }

  function composerValue(control) {
    if (control?.tagName === 'TEXTAREA') return typeof control.value === 'string' ? control.value : '';
    if (typeof control?.innerText === 'string') return control.innerText;
    return typeof control?.textContent === 'string' ? control.textContent : '';
  }

  function enabledSendButtons() {
    return [...document.querySelectorAll('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Send"]')]
      .filter((button) => (
        button.hidden !== true
        && button.disabled !== true
        && button.getAttribute?.('aria-disabled') !== 'true'
        && (typeof button.getClientRects !== 'function' || button.getClientRects().length > 0)
      ));
  }

  function projectHomeStillMatches(expectedProjectRef) {
    return NavaExtension.projectRefFromUrl(location.href) === expectedProjectRef
      && NavaExtension.conversationRefFromUrl(location.href) === null;
  }

  function insertBootstrap(control, bootstrap) {
    control.focus?.();
    if (control.tagName === 'TEXTAREA') {
      control.value = bootstrap;
      control.dispatchEvent?.(new globalThis.Event('input', { bubbles: true }));
      return;
    }
    let inserted = false;
    if (typeof document.execCommand === 'function') inserted = document.execCommand('insertText', false, bootstrap) === true;
    if (!inserted) {
      control.textContent = bootstrap;
      control.dispatchEvent?.(new globalThis.InputEvent('input', { bubbles: true, inputType: 'insertText', data: bootstrap }));
    }
  }

  async function submitContinuationBootstrap(message) {
    if (typeof message.expectedProjectRef !== 'string' || typeof message.bootstrap !== 'string'
      || message.bootstrap.trim().length === 0 || message.bootstrap.length > 32_768
      || typeof message.submissionAttemptId !== 'string' || message.submissionAttemptId.length < 8
      || typeof message.sourceBindingId !== 'string' || message.sourceBindingId.length < 1
      || typeof message.authorityExpiresAt !== 'string') {
      return { ok: false, errorCode: 'DOM_MISMATCH' };
    }
    const authorityExpiresAt = Date.parse(message.authorityExpiresAt);
    if (!Number.isFinite(authorityExpiresAt) || Date.now() >= authorityExpiresAt) {
      return { ok: false, errorCode: 'PAIRING_EXPIRED' };
    }
    if (!projectHomeStillMatches(message.expectedProjectRef)) return { ok: false, errorCode: 'PROJECT_MISMATCH' };
    if (continuationSubmissionAttempts.has(message.submissionAttemptId)) {
      return { ok: true, submitted: true, duplicate: true, projectRef: message.expectedProjectRef };
    }

    const guarded = NavaExtension.inspectComposer(document);
    if (!guarded.ok) return guarded;
    let controls;
    try {
      controls = visibleComposerControls();
    } catch {
      return { ok: false, errorCode: 'DOM_MISMATCH' };
    }
    if (controls.length !== 1) return { ok: false, errorCode: 'DOM_MISMATCH' };
    if (composerValue(controls[0]).trim().length !== 0) return { ok: false, errorCode: 'COMPOSER_NOT_EMPTY' };
    try {
      insertBootstrap(controls[0], message.bootstrap);
    } catch {
      return { ok: false, errorCode: 'SUBMIT_FAILED' };
    }

    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (Date.now() >= authorityExpiresAt) return { ok: false, errorCode: 'PAIRING_EXPIRED' };
      if (!projectHomeStillMatches(message.expectedProjectRef)) return { ok: false, errorCode: 'PROJECT_MISMATCH' };

      let currentControls;
      let buttons;
      try {
        currentControls = visibleComposerControls();
        buttons = enabledSendButtons();
      } catch {
        return { ok: false, errorCode: 'DOM_MISMATCH' };
      }
      if (currentControls.length !== 1) return { ok: false, errorCode: 'DOM_MISMATCH' };
      const value = composerValue(currentControls[0]);
      if (value !== message.bootstrap) {
        if (value.trim().length > 0) return { ok: false, errorCode: 'COMPOSER_NOT_EMPTY' };
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        continue;
      }
      if (buttons.length > 1) return { ok: false, errorCode: 'DOM_MISMATCH' };
      if (buttons.length === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
        continue;
      }

      let authority;
      try {
        authority = await chrome.runtime.sendMessage({
          type: 'NAVA_VALIDATE_CONTINUATION_SUBMISSION',
          attemptId: message.submissionAttemptId,
          sourceBindingId: message.sourceBindingId,
        });
      } catch {
        return { ok: false, errorCode: 'EXTENSION_INTERNAL' };
      }
      if (!authority || authority.ok !== true) {
        return { ok: false, errorCode: NavaExtension.FAILURE_CODES.includes(authority?.code) ? authority.code : 'CONVERSATION_MISMATCH' };
      }

      if (!projectHomeStillMatches(message.expectedProjectRef)) return { ok: false, errorCode: 'PROJECT_MISMATCH' };
      let finalControls;
      let finalButtons;
      try {
        finalControls = visibleComposerControls();
        finalButtons = enabledSendButtons();
      } catch {
        return { ok: false, errorCode: 'DOM_MISMATCH' };
      }
      if (finalControls.length !== 1 || composerValue(finalControls[0]) !== message.bootstrap) {
        const finalValue = finalControls.length === 1 ? composerValue(finalControls[0]) : '';
        return { ok: false, errorCode: finalValue.trim().length > 0 ? 'COMPOSER_NOT_EMPTY' : 'DOM_MISMATCH' };
      }
      if (finalButtons.length !== 1) return { ok: false, errorCode: 'DOM_MISMATCH' };
      if (continuationSubmissionAttempts.has(message.submissionAttemptId)) {
        return { ok: true, submitted: true, duplicate: true, projectRef: message.expectedProjectRef };
      }
      continuationSubmissionAttempts.add(message.submissionAttemptId);
      try {
        finalButtons[0].click();
      } catch {
        return { ok: false, errorCode: 'SUBMIT_FAILED' };
      }
      return {
        ok: true,
        submitted: true,
        submissionAttemptId: message.submissionAttemptId,
        projectRef: message.expectedProjectRef,
      };
    }
    return { ok: false, errorCode: 'SUBMIT_FAILED' };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!NavaExtension.isRecord(message)) return false;
    if (message.type === 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP') {
      void submitContinuationBootstrap(message)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, errorCode: 'SUBMIT_FAILED' }));
      return true;
    }
    if (message.type === 'NAVA_INSPECT_CHAT_STATE') {
      try {
        const conversationRef = NavaExtension.conversationRefFromUrl(location.href);
        if (conversationRef === null) {
          sendResponse({ ok: false, errorCode: 'CONVERSATION_MISMATCH' });
          return false;
        }
        const limit = NavaExtension.inspectConversationLimit(document);
        const terminal = NavaExtension.inspectConversationTerminal(document);
        const composer = NavaExtension.inspectComposer(document);
        sendResponse({ ok: limit.ok === true && terminal.ok === true, conversationRef, limit, terminal, composer });
      } catch {
        sendResponse({ ok: false, errorCode: 'DOM_MISMATCH' });
      }
      return false;
    }
    if (message.type !== 'NAVA_WAKE') return false;
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
