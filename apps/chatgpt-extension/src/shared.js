/* global URL */

(() => {
  'use strict';

  const CHATGPT_ORIGIN = 'https://chatgpt.com';
  const BRIDGE_PORT = 18766;
  const WAKE_PROMPT = 'NAVA wake received. Open the NAVA Command Room and continue the assigned task.';
  const FAILURE_CODES = Object.freeze([
    'TAB_NOT_FOUND',
    'AMBIGUOUS_TAB',
    'CONVERSATION_MISMATCH',
    'DOM_MISMATCH',
    'COMPOSER_NOT_EMPTY',
    'SUBMIT_FAILED',
    'TAB_UNAVAILABLE',
    'NAVIGATION_CHANGED',
    'EXTENSION_INTERNAL',
  ]);
  const EXTENSION_ORIGIN_PATTERN = /^(?:chrome-extension:\/\/[a-z]{32}|moz-extension:\/\/[0-9a-f-]{16,64})$/i;

  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function isExtensionOrigin(value) {
    return typeof value === 'string' && EXTENSION_ORIGIN_PATTERN.test(value);
  }

  function boundedString(value, minimum, maximum) {
    return typeof value === 'string' && value.trim().length >= minimum && value.length <= maximum;
  }

  function conversationRefFromUrl(value) {
    if (typeof value !== 'string' || value.length > 4_096) return null;
    try {
      const url = new URL(value);
      if (url.origin !== CHATGPT_ORIGIN) return null;
      if (/^\/c\/[^/]+$/.test(url.pathname) || /^\/g\/[^/]+\/c\/[^/]+$/.test(url.pathname)) {
        return `chatgpt:${url.origin}${url.pathname}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  function projectRefFromUrl(value) {
    if (typeof value !== 'string' || value.length > 4_096) return null;
    try {
      const url = new URL(value);
      if (url.origin !== CHATGPT_ORIGIN) return null;
      const match = /^\/g\/(g-p-[^/]+)(?:\/project|\/c\/[^/]+)$/.exec(url.pathname);
      return match === null ? null : `chatgpt-project:${url.origin}/g/${match[1]}`;
    } catch {
      return null;
    }
  }

  function projectRefFromConversationRef(value) {
    if (typeof value !== 'string' || !value.startsWith('chatgpt:')) return null;
    return projectRefFromUrl(value.slice('chatgpt:'.length));
  }

  function projectHomeUrl(projectRef) {
    if (typeof projectRef !== 'string') return null;
    const match = /^chatgpt-project:(https:\/\/chatgpt\.com\/g\/g-p-[^/]+)$/.exec(projectRef);
    return match === null ? null : `${match[1]}/project`;
  }

  function validateBridgeUrl(value) {
    if (typeof value !== 'string' || value.length > 512) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return null;
      if (url.port !== String(BRIDGE_PORT)) return null;
      if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  function validatePairingPayload(value, nowMs = Date.now()) {
    if (!isRecord(value) || value.protocolVersion !== 1) return { ok: false, code: 'INVALID_PAIRING' };
    const bridgeUrl = validateBridgeUrl(value.bridgeUrl);
    if (bridgeUrl === null) return { ok: false, code: 'BRIDGE_URL_INVALID' };
    if (!boundedString(value.roomId, 1, 512) || !boundedString(value.slotKey, 1, 128)) {
      return { ok: false, code: 'INVALID_PAIRING' };
    }
    if (!boundedString(value.bindingId, 8, 512) || !boundedString(value.challenge, 32, 512)) {
      return { ok: false, code: 'INVALID_PAIRING' };
    }
    if (!Number.isSafeInteger(value.connectionEpoch) || value.connectionEpoch < 1) {
      return { ok: false, code: 'INVALID_PAIRING' };
    }
    const expiresAtMs = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return { ok: false, code: 'PAIRING_EXPIRED' };
    if (!Array.isArray(value.allowedOrigins) || value.allowedOrigins.length === 0 || value.allowedOrigins.length > 16) {
      return { ok: false, code: 'INVALID_PAIRING' };
    }
    if (!value.allowedOrigins.every(isExtensionOrigin)) return { ok: false, code: 'INVALID_PAIRING' };
    return {
      ok: true,
      payload: Object.freeze({
        protocolVersion: 1,
        bridgeUrl,
        roomId: value.roomId,
        slotKey: value.slotKey,
        bindingId: value.bindingId,
        challenge: value.challenge,
        expiresAt: value.expiresAt,
        connectionEpoch: value.connectionEpoch,
        allowedOrigins: Object.freeze([...value.allowedOrigins]),
      }),
    };
  }

  function tabConversationRef(tab) {
    return conversationRefFromUrl(tab && typeof tab.url === 'string' ? tab.url : '');
  }

  function selectExactTab(tabs, expectedConversationRef) {
    if (!Array.isArray(tabs) || typeof expectedConversationRef !== 'string') {
      return { ok: false, errorCode: 'TAB_NOT_FOUND' };
    }
    const matches = tabs.filter((tab) => tabConversationRef(tab) === expectedConversationRef);
    if (matches.length === 0) return { ok: false, errorCode: 'TAB_NOT_FOUND' };
    if (matches.length > 1) return { ok: false, errorCode: 'AMBIGUOUS_TAB' };
    if (!Number.isInteger(matches[0].id)) return { ok: false, errorCode: 'TAB_UNAVAILABLE' };
    return { ok: true, tab: matches[0] };
  }

  function isVisible(element) {
    if (element === null || element === undefined || element.hidden === true) return false;
    if (typeof element.getAttribute === 'function' && element.getAttribute('aria-hidden') === 'true') return false;
    if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false;
    if (typeof element.getBoundingClientRect === 'function') {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
    }
    const ownerDocument = element.ownerDocument;
    const view = ownerDocument && ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === 'function') {
      const style = view.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  const MAX_LENGTH_MESSAGE = "You've reached the maximum length for this conversation, but you can keep talking by starting a new chat.";
  const MESSAGE_DELIVERY_TIMEOUT = 'Message delivery timed out. Please try again.';

  function inspectConversationLimit(documentObject) {
    if (!documentObject || typeof documentObject.querySelectorAll !== 'function') {
      return { ok: false, errorCode: 'DOM_MISMATCH' };
    }
    let candidates;
    try {
      candidates = [...documentObject.querySelectorAll('[role="alert"], [role="status"], main')].filter(isVisible);
    } catch {
      return { ok: false, errorCode: 'DOM_MISMATCH' };
    }
    const matches = candidates.filter((element) => {
      const text = typeof element.innerText === 'string' ? element.innerText : element.textContent;
      return typeof text === 'string' && text.includes(MAX_LENGTH_MESSAGE);
    });
    if (matches.length === 0) return { ok: true, maxLength: false };
    return { ok: true, maxLength: true, trigger: 'EXACT_MAX_LENGTH_MESSAGE' };
  }

  function inspectGenerationActivity(documentObject) {
    if (!documentObject || typeof documentObject.querySelector !== 'function') return { ok: false, active: true };
    try {
      const busy = documentObject.querySelector('[aria-busy="true"], [data-is-streaming="true"], [data-composer-busy="true"], [data-is-recording="true"], [data-recording="true"], [aria-label*="Stop generating" i], [aria-label*="Stop recording" i]');
      return { ok: true, active: busy !== null && isVisible(busy) };
    } catch {
      return { ok: false, active: true };
    }
  }

  function terminalTurnKey(documentObject, element) {
    let container = null;
    try {
      container = typeof element.closest === 'function'
        ? element.closest('[data-message-id], [data-testid^="conversation-turn"], article')
        : null;
    } catch {
      container = null;
    }
    if (container !== null) {
      const stableId = container.getAttribute?.('data-message-id')
        ?? container.getAttribute?.('data-testid')
        ?? container.id;
      if (typeof stableId === 'string' && stableId.trim().length > 0) return `timeout:${stableId.slice(0, 512)}`;
      try {
        const turns = [...documentObject.querySelectorAll('[data-message-id], [data-testid^="conversation-turn"], article')];
        const index = turns.indexOf(container);
        if (index >= 0) return `timeout:turn:${index}`;
      } catch {
        return null;
      }
    }
    try {
      const terminals = [...documentObject.querySelectorAll('[role="alert"], [role="status"], [data-testid*="error" i]')].filter(isVisible);
      const index = terminals.indexOf(element);
      return index >= 0 ? `timeout:terminal:${index}` : null;
    } catch {
      return null;
    }
  }

  function inspectConversationTerminal(documentObject) {
    const limit = inspectConversationLimit(documentObject);
    if (!limit.ok) return limit;
    if (limit.maxLength === true) return { ok: true, terminal: true, kind: 'EXACT_MAX_LENGTH', trigger: limit.trigger };
    if (!documentObject || typeof documentObject.querySelectorAll !== 'function') return { ok: false, errorCode: 'DOM_MISMATCH' };
    let candidates;
    try {
      candidates = [...documentObject.querySelectorAll('[role="alert"], [role="status"], [data-testid*="error" i]')].filter(isVisible);
    } catch {
      return { ok: false, errorCode: 'DOM_MISMATCH' };
    }
    const matches = candidates.filter((element) => {
      const text = typeof element.innerText === 'string' ? element.innerText : element.textContent;
      return typeof text === 'string' && text.includes(MESSAGE_DELIVERY_TIMEOUT);
    });
    if (matches.length === 0) return { ok: true, terminal: false };
    const element = matches.at(-1);
    const turnKey = terminalTurnKey(documentObject, element);
    const generation = inspectGenerationActivity(documentObject);
    if (turnKey === null || generation.ok !== true) return { ok: false, errorCode: 'DOM_MISMATCH' };
    return {
      ok: true,
      terminal: true,
      kind: 'MESSAGE_DELIVERY_TIMEOUT',
      trigger: 'MESSAGE_DELIVERY_TIMED_OUT',
      terminalTurnKey: turnKey,
      generationActive: generation.active,
    };
  }

  function inspectComposer(documentObject) {
    if (!documentObject || typeof documentObject.querySelectorAll !== 'function') {
      return { ok: false, errorCode: 'DOM_MISMATCH' };
    }
    let controls;
    try {
      controls = [...documentObject.querySelectorAll('[contenteditable="true"], textarea')].filter(isVisible);
    } catch {
      return { ok: false, errorCode: 'DOM_MISMATCH' };
    }
    if (controls.length !== 1) return { ok: false, errorCode: 'DOM_MISMATCH' };
    const control = controls[0];
    if (control.disabled === true || (typeof control.getAttribute === 'function' && control.getAttribute('aria-disabled') === 'true')) {
      return { ok: false, errorCode: 'DOM_MISMATCH' };
    }
    if (typeof documentObject.querySelector === 'function') {
      try {
        const busy = documentObject.querySelector('[aria-busy="true"], [data-is-streaming="true"], [data-composer-busy="true"], [data-is-recording="true"], [data-recording="true"], [aria-label*="Stop generating" i], [aria-label*="Stop recording" i]');
        if (busy !== null && isVisible(busy)) return { ok: false, errorCode: 'DOM_MISMATCH' };
      } catch {
        return { ok: false, errorCode: 'DOM_MISMATCH' };
      }
    }
    const rawText = control.tagName === 'TEXTAREA'
      ? control.value
      : (control.innerText ?? control.textContent ?? '');
    if (typeof rawText !== 'string') return { ok: false, errorCode: 'DOM_MISMATCH' };
    if (rawText.trim().length > 0) return { ok: false, errorCode: 'COMPOSER_NOT_EMPTY' };
    return { ok: true, elementKind: control.tagName === 'TEXTAREA' ? 'textarea' : 'contenteditable' };
  }

  globalThis.NavaExtension = Object.freeze({
    BRIDGE_PORT,
    CHATGPT_ORIGIN,
    FAILURE_CODES,
    WAKE_PROMPT,
    conversationRefFromUrl,
    inspectComposer,
    inspectConversationTerminal,
    inspectGenerationActivity,
    inspectConversationLimit,
    isExtensionOrigin,
    projectHomeUrl,
    projectRefFromConversationRef,
    projectRefFromUrl,
    isRecord,
    selectExactTab,
    tabConversationRef,
    validateBridgeUrl,
    validatePairingPayload,
  });
})();
