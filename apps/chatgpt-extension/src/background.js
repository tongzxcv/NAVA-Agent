/* global NavaBridge, NavaExtension, URL, chrome, crypto, importScripts */

importScripts('shared.js', 'bridge.js');

(() => {
  'use strict';

  const INSTALLATION_ID_KEY = 'nava.extensionInstallationId';
  const SESSION_STATE_KEY = 'nava.commandRoomBinding';
  const KNOWN_ERROR_CODES = new Set([
    'INVALID_PAIRING',
    'BRIDGE_URL_INVALID',
    'PAIRING_EXPIRED',
    'ORIGIN_NOT_ALLOWLISTED',
    'CONVERSATION_MISMATCH',
    'TAB_NOT_FOUND',
    'AMBIGUOUS_TAB',
    'TAB_UNAVAILABLE',
    'DOM_MISMATCH',
    'COMPOSER_NOT_EMPTY',
    'BRIDGE_UNAVAILABLE',
    'INVALID_BRIDGE_RESPONSE',
    'UNPAIRED',
    'PAIRING_MISMATCH',
    'EXTENSION_INTERNAL',
  ]);

  function publicError(error) {
    return error && typeof error.code === 'string' && KNOWN_ERROR_CODES.has(error.code)
      ? error.code
      : 'BRIDGE_UNAVAILABLE';
  }

  function extensionOrigin() {
    return new URL(chrome.runtime.getURL('/')).origin;
  }

  async function installationId() {
    const stored = await chrome.storage.local.get(INSTALLATION_ID_KEY);
    if (stored && typeof stored[INSTALLATION_ID_KEY] === 'string' && stored[INSTALLATION_ID_KEY].length >= 8) {
      return stored[INSTALLATION_ID_KEY];
    }
    const generated = `nava-${crypto.randomUUID()}`;
    await chrome.storage.local.set({ [INSTALLATION_ID_KEY]: generated });
    return generated;
  }

  async function readState() {
    const stored = await chrome.storage.session.get(SESSION_STATE_KEY);
    const state = stored?.[SESSION_STATE_KEY];
    if (!NavaExtension.isRecord(state)) return null;
    const required = ['bridgeUrl', 'bindingId', 'authToken', 'conversationRef'];
    if (!required.every((key) => typeof state[key] === 'string' && state[key].length > 0)) return null;
    if (!Number.isSafeInteger(state.connectionEpoch) || state.connectionEpoch < 1) return null;
    return state;
  }

  function publicState(state) {
    if (state === null) return null;
    return {
      roomId: state.roomId,
      slotKey: state.slotKey,
      bindingId: state.bindingId,
      connectionEpoch: state.connectionEpoch,
      conversationRef: state.conversationRef,
    };
  }

  async function pairActiveTab(payloadText) {
    if (typeof payloadText !== 'string' || payloadText.length === 0 || payloadText.length > 16_384) {
      return { ok: false, code: 'INVALID_PAIRING' };
    }
    let rawPayload;
    try {
      rawPayload = JSON.parse(payloadText);
    } catch {
      return { ok: false, code: 'INVALID_PAIRING' };
    }
    const checked = NavaExtension.validatePairingPayload(rawPayload);
    if (!checked.ok) return checked;
    if (!checked.payload.allowedOrigins.includes(extensionOrigin())) {
      return { ok: false, code: 'ORIGIN_NOT_ALLOWLISTED' };
    }
    let tabs;
    try {
      tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    } catch {
      return { ok: false, code: 'TAB_NOT_FOUND' };
    }
    if (tabs.length === 0) return { ok: false, code: 'TAB_NOT_FOUND' };
    if (tabs.length !== 1) return { ok: false, code: 'AMBIGUOUS_TAB' };
    const tab = tabs[0];
    const conversationRef = NavaExtension.tabConversationRef(tab);
    if (conversationRef === null) return { ok: false, code: 'CONVERSATION_MISMATCH' };
    try {
      const paired = await NavaBridge.pair(checked.payload, conversationRef, await installationId());
      if (paired.binding.id !== checked.payload.bindingId || paired.binding.connectionEpoch !== checked.payload.connectionEpoch) {
        return { ok: false, code: 'PAIRING_MISMATCH' };
      }
      const state = {
        roomId: checked.payload.roomId,
        slotKey: checked.payload.slotKey,
        bindingId: checked.payload.bindingId,
        connectionEpoch: checked.payload.connectionEpoch,
        conversationRef,
        bridgeUrl: checked.payload.bridgeUrl,
        authToken: paired.authToken,
      };
      await chrome.storage.session.set({ [SESSION_STATE_KEY]: state });
      return { ok: true, state: publicState(state) };
    } catch (error) {
      return { ok: false, code: publicError(error) };
    }
  }

  async function deliverWake(state, tab, wake) {
    try {
      await NavaBridge.transition(state, wake.id, 'attempt');
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'NAVA_WAKE',
        wakeId: wake.id,
        eventKey: typeof wake.eventKey === 'string' ? wake.eventKey : '',
        taskId: typeof wake.taskId === 'string' ? wake.taskId : undefined,
        reason: typeof wake.reason === 'string' ? wake.reason : '',
        expectedConversationRef: state.conversationRef,
      });
      if (!response || response.ok !== true) {
        const errorCode = NavaExtension.FAILURE_CODES.includes(response?.errorCode) ? response.errorCode : 'EXTENSION_INTERNAL';
        await NavaBridge.transition(state, wake.id, 'failed', errorCode);
        return { delivered: false, failed: true };
      }
      await NavaBridge.transition(state, wake.id, 'delivered');
      return { delivered: true, failed: false };
    } catch (error) {
      const errorCode = error && NavaExtension.FAILURE_CODES.includes(error.code) ? error.code : 'TAB_UNAVAILABLE';
      try {
        await NavaBridge.transition(state, wake.id, 'failed', errorCode);
      } catch {
        // Keep the wake recoverable if the transition itself cannot reach NAVA.
      }
      return { delivered: false, failed: true };
    }
  }

  async function checkWakes() {
    const state = await readState();
    if (state === null) return { ok: false, code: 'UNPAIRED' };
    let tabs;
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return { ok: false, code: 'TAB_NOT_FOUND' };
    }
    const target = NavaExtension.selectExactTab(tabs, state.conversationRef);
    if (!target.ok) return { ok: false, code: target.errorCode, pending: true };
    let response;
    try {
      response = await NavaBridge.listWakes(state);
    } catch (error) {
      return { ok: false, code: publicError(error) };
    }
    const wakes = Array.isArray(response.wakes) ? response.wakes : [];
    let deliveredCount = 0;
    let failedCount = 0;
    for (const wake of wakes) {
      if (!NavaExtension.isRecord(wake) || typeof wake.id !== 'string') continue;
      const result = await deliverWake(state, target.tab, wake);
      if (result.delivered) deliveredCount += 1;
      if (result.failed) failedCount += 1;
    }
    try {
      await NavaBridge.touch(state);
    } catch {
      // A wake result remains authoritative; a heartbeat can be retried later.
    }
    return {
      ok: true,
      deliveredCount,
      failedCount,
      pendingCount: Math.max(0, wakes.length - deliveredCount - failedCount),
    };
  }

  async function handleMessage(message) {
    if (!NavaExtension.isRecord(message) || typeof message.type !== 'string') return null;
    if (message.type === 'PAIR_ACTIVE_TAB') return pairActiveTab(message.payloadText);
    if (message.type === 'CHECK_WAKES') return checkWakes();
    if (message.type === 'GET_STATE') return { ok: true, state: publicState(await readState()) };
    return null;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!NavaExtension.isRecord(message) || !['PAIR_ACTIVE_TAB', 'CHECK_WAKES', 'GET_STATE'].includes(message.type)) return false;
    void handleMessage(message).then(sendResponse).catch(() => sendResponse({ ok: false, code: 'EXTENSION_INTERNAL' }));
    return true;
  });
})();
