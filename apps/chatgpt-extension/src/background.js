/* global NavaBridge, NavaCrypto, NavaExtension, URL, chrome, crypto, importScripts */

importScripts('shared.js', 'crypto.js', 'bridge.js');

(() => {
  'use strict';

  const INSTALLATION_ID_KEY = 'nava.extensionInstallationId';
  const SESSION_STATE_KEY = 'nava.commandRoomBinding';
  const PERSISTED_STATE_KEY = 'nava.commandRoomBindingEncrypted';
  const SESSION_REWRAP_KEY = 'nava.commandRoomBindingRewrapKey';
  const WAKE_ALARM_NAME = 'nava.commandRoomWakePoll';
  const WAKE_POLL_MINUTES = 1;
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
    'SUBMIT_FAILED',
    'PROJECT_IDENTITY_MISSING',
    'PROJECT_MISMATCH',
    'CONTINUATION_TIMEOUT',
    'BRIDGE_UNAVAILABLE',
    'INVALID_BRIDGE_RESPONSE',
    'UNPAIRED',
    'PAIRING_MISMATCH',
    'INVALID_PASSPHRASE',
    'LOCKED',
    'EXTENSION_INTERNAL',
    'SUPERVISOR_IDENTITY_MISMATCH',
    'SUPERVISOR_STALE_EPOCH',
    'SUPERVISOR_UNSUPPORTED',
  ]);
  let checkInFlight = null;
  let continuationInFlight = null;

  function publicError(error) {
    return error && typeof error.code === 'string' && KNOWN_ERROR_CODES.has(error.code)
      ? error.code
      : 'BRIDGE_UNAVAILABLE';
  }

  function extensionOrigin() {
    const extensionUrl = chrome.runtime.getURL('/');
    const origin = new URL(extensionUrl).origin;
    return origin === 'null' ? extensionUrl.replace(/\/$/, '') : origin;
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

  function validState(state) {
    if (!NavaExtension.isRecord(state)) return false;
    const required = ['roomId', 'slotKey', 'bindingId', 'authToken', 'conversationRef', 'bridgeUrl'];
    if (!required.every((key) => typeof state[key] === 'string' && state[key].length > 0 && state[key].length <= 2_048)) return false;
    if (!Number.isSafeInteger(state.connectionEpoch) || state.connectionEpoch < 1) return false;
    if (state.projectRef !== undefined && NavaExtension.projectHomeUrl(state.projectRef) === null) return false;
    if (NavaExtension.validateBridgeUrl(state.bridgeUrl) !== state.bridgeUrl) return false;
    if (!/^nava-v1\.[A-Za-z0-9_-]{16,}$/.test(state.authToken)) return false;
    return /^chatgpt:https:\/\/chatgpt\.com\/(?:c\/[^/]+|g\/[^/]+\/c\/[^/]+)$/.test(state.conversationRef);
  }

  async function readState() {
    const stored = await chrome.storage.session.get(SESSION_STATE_KEY);
    const state = stored?.[SESSION_STATE_KEY];
    return validState(state) ? state : null;
  }

  async function hasPersistedState() {
    try {
      const stored = await chrome.storage.local.get(PERSISTED_STATE_KEY);
      return NavaCrypto.isEnvelope(stored?.[PERSISTED_STATE_KEY]);
    } catch {
      return false;
    }
  }

  async function saveState(state, passphrase) {
    const unlocked = await NavaCrypto.createUnlockedEnvelope(state, passphrase);
    await chrome.storage.local.set({ [PERSISTED_STATE_KEY]: unlocked.envelope });
    await chrome.storage.session.set({
      [SESSION_STATE_KEY]: state,
      [SESSION_REWRAP_KEY]: unlocked.sessionKey,
    });
  }

  async function saveContinuationState(state) {
    const [localStored, sessionStored] = await Promise.all([
      chrome.storage.local.get(PERSISTED_STATE_KEY),
      chrome.storage.session.get(SESSION_REWRAP_KEY),
    ]);
    const envelope = localStored?.[PERSISTED_STATE_KEY];
    const sessionKey = sessionStored?.[SESSION_REWRAP_KEY];
    if (!NavaCrypto.isEnvelope(envelope) || typeof sessionKey !== 'string') throw new Error('LOCKED');
    const encrypted = await NavaCrypto.encryptStateWithSessionKey(envelope, state, sessionKey);
    await chrome.storage.local.set({ [PERSISTED_STATE_KEY]: encrypted });
    await chrome.storage.session.set({ [SESSION_STATE_KEY]: state });
  }

  async function restrictSessionStorage() {
    if (typeof chrome.storage.session?.setAccessLevel !== 'function') return;
    try {
      await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    } catch {
      // The persistent envelope remains encrypted even if this optional guard is unavailable.
    }
  }

  async function ensureWakeAlarm() {
    if (!chrome.alarms || typeof chrome.alarms.create !== 'function') return;
    try {
      await chrome.alarms.create(WAKE_ALARM_NAME, { periodInMinutes: WAKE_POLL_MINUTES });
    } catch {
      // Manual checking remains available if the browser alarm service is unavailable.
    }
  }

  async function clearWakeAlarm() {
    if (!chrome.alarms || typeof chrome.alarms.clear !== 'function') return;
    try {
      await chrome.alarms.clear(WAKE_ALARM_NAME);
    } catch {
      // There is no state to recover when the alarm cannot be cleared.
    }
  }

  async function syncWakeAlarm() {
    try {
      if (await readState()) {
        await ensureWakeAlarm();
      } else {
        await clearWakeAlarm();
      }
    } catch {
      // Storage failures must not create an unhandled service-worker rejection.
    }
  }

  async function syncSupervisorState(state) {
    let supervisorSync = 'DEGRADED';
    let response = null;
    try {
      response = await NavaBridge.syncSupervisor(state);
      supervisorSync = ['OK', 'DEGRADED', 'FAILED'].includes(response?.supervisorSync)
        ? response.supervisorSync
        : 'DEGRADED';
    } catch (error) {
      supervisorSync = error?.status === 401 || error?.status === 409 ? 'FAILED' : 'DEGRADED';
      const nextState = { ...state, supervisorSync };
      try {
        await chrome.storage.session.set({ [SESSION_STATE_KEY]: nextState });
      } catch {
        // Supervisor synchronization is advisory plumbing and must never block core work.
      }
      return { ok: false, code: publicError(error), supervisorSync, state: nextState };
    }
    const nextState = { ...state, supervisorSync };
    try {
      await chrome.storage.session.set({ [SESSION_STATE_KEY]: nextState });
    } catch {
      // Keep core work available even when supervisor state cannot be mirrored locally.
    }
    return { ok: true, response, supervisorSync, state: nextState };
  }

  async function unlockState(passphrase) {
    if (!NavaCrypto.validPassphrase(passphrase)) return { ok: false, code: 'INVALID_PASSPHRASE' };
    let stored;
    try {
      stored = await chrome.storage.local.get(PERSISTED_STATE_KEY);
    } catch {
      return { ok: false, code: 'EXTENSION_INTERNAL' };
    }
    if (!NavaCrypto.isEnvelope(stored?.[PERSISTED_STATE_KEY])) return { ok: false, code: 'UNPAIRED' };
    let unlocked;
    try {
      unlocked = await NavaCrypto.unlockState(stored[PERSISTED_STATE_KEY], passphrase);
    } catch {
      return { ok: false, code: 'INVALID_PASSPHRASE' };
    }
    const state = unlocked.state;
    if (!validState(state)) return { ok: false, code: 'INVALID_PASSPHRASE' };
    if (unlocked.upgraded === true) await chrome.storage.local.set({ [PERSISTED_STATE_KEY]: unlocked.envelope });
    await chrome.storage.session.set({
      [SESSION_STATE_KEY]: state,
      [SESSION_REWRAP_KEY]: unlocked.sessionKey,
    });
    await ensureWakeAlarm();
    const supervisor = await syncSupervisorState({ ...state, supervisorSync: state.supervisorSync ?? 'DEGRADED' });
    return { ok: true, state: publicState(supervisor.state) };
  }

  function publicState(state) {
    if (state === null) return null;
    return {
      roomId: state.roomId,
      slotKey: state.slotKey,
      bindingId: state.bindingId,
      connectionEpoch: state.connectionEpoch,
      conversationRef: state.conversationRef,
      ...(state.projectRef === undefined ? {} : { projectRef: state.projectRef }),
      supervisorSync: ['OK', 'DEGRADED', 'FAILED'].includes(state.supervisorSync) ? state.supervisorSync : 'DEGRADED',
    };
  }

  async function pairActiveTab(payloadText, passphrase) {
    if (!NavaCrypto.validPassphrase(passphrase)) return { ok: false, code: 'INVALID_PASSPHRASE' };
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
    const projectRef = NavaExtension.projectRefFromConversationRef(conversationRef);
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
        ...(projectRef === null ? {} : { projectRef }),
        bridgeUrl: checked.payload.bridgeUrl,
        authToken: paired.authToken,
        supervisorSync: 'DEGRADED',
      };
      try {
        await saveState(state, passphrase);
      } catch {
        return { ok: false, code: 'EXTENSION_INTERNAL' };
      }
      await ensureWakeAlarm();
      const supervisor = await syncSupervisorState(state);
      return { ok: true, state: publicState(supervisor.state) };
    } catch (error) {
      return { ok: false, code: publicError(error) };
    }
  }

  async function sendWakeMessage(tab, message) {
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (firstError) {
      if (!Number.isInteger(tab?.id)) throw firstError;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/shared.js', 'src/content.js'],
        });
      } catch {
        throw firstError;
      }
      return chrome.tabs.sendMessage(tab.id, message);
    }
  }

  async function deliverWake(state, tab, wake) {
    if (wake?.state === 'DELIVERED') return { delivered: false, failed: false, pendingAck: true };
    try {
      await NavaBridge.transition(state, wake.id, 'attempt');
      const response = await sendWakeMessage(tab, {
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

  async function inspectContinuationReady() {
    const state = await readState();
    if (state === null) return { ok: false, code: (await hasPersistedState()) ? 'LOCKED' : 'UNPAIRED' };
    let tabs;
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return { ok: false, code: 'TAB_NOT_FOUND' };
    }
    const target = NavaExtension.selectExactTab(tabs, state.conversationRef);
    if (!target.ok) return { ok: false, code: target.errorCode };
    let inspected;
    try {
      inspected = await sendWakeMessage(target.tab, { type: 'NAVA_INSPECT_CHAT_STATE' });
    } catch {
      return { ok: false, code: 'TAB_UNAVAILABLE' };
    }
    if (!inspected || inspected.ok !== true || inspected.conversationRef !== state.conversationRef) {
      return { ok: false, code: 'CONVERSATION_MISMATCH' };
    }
    if (inspected.limit?.maxLength !== true) return { ok: true, ready: false, reason: 'NOT_AT_MAX_LENGTH' };
    if (inspected.composer?.errorCode === 'COMPOSER_NOT_EMPTY') return { ok: false, code: 'COMPOSER_NOT_EMPTY' };
    if (inspected.composer?.ok !== true) return { ok: false, code: 'DOM_MISMATCH' };
    const projectRef = state.projectRef ?? NavaExtension.projectRefFromConversationRef(state.conversationRef);
    if (projectRef === null || NavaExtension.projectHomeUrl(projectRef) === null) return { ok: false, code: 'PROJECT_IDENTITY_MISSING' };
    let challenge;
    try {
      challenge = await NavaBridge.createContinuationChallenge(state);
    } catch (error) {
      return { ok: false, code: publicError(error) };
    }
    if (!challenge?.continuation || challenge.continuation.connectionEpoch !== state.connectionEpoch) {
      return { ok: false, code: 'PAIRING_MISMATCH' };
    }
    return {
      ok: true,
      ready: true,
      sameEpoch: true,
      connectionEpoch: state.connectionEpoch,
      continuation: challenge.continuation,
    };
  }

  function continuationBootstrap(state) {
    return [
      '@NAVA Agent',
      '',
      'NAVA AUTO CONTINUATION',
      `Room: ${state.roomId}`,
      `Slot: ${state.slotKey}`,
      `Connection epoch: ${state.connectionEpoch}`,
      'Browser-binding continuation only. Do NOT command_room_join, rejoin, rebind, takeover, or rotate connection epoch.',
      'Use NAVA session_resume / durable checkpoint continuity, verify live project/workspace evidence, then continue from the latest safe resume point.',
    ].join('\\n');
  }

  async function waitForProjectHome(tabId, expectedProjectRef) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        return { ok: false, code: 'TAB_UNAVAILABLE' };
      }
      if (NavaExtension.projectRefFromUrl(tab?.url) === expectedProjectRef
        && NavaExtension.conversationRefFromUrl(tab?.url) === null) return { ok: true, tab };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { ok: false, code: 'CONTINUATION_TIMEOUT' };
  }

  async function waitForNewConversation(tabId, expectedProjectRef, oldConversationRef) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        return { ok: false, code: 'TAB_UNAVAILABLE' };
      }
      const projectRef = NavaExtension.projectRefFromUrl(tab?.url);
      const conversationRef = NavaExtension.conversationRefFromUrl(tab?.url);
      if (projectRef !== null && projectRef !== expectedProjectRef) return { ok: false, code: 'PROJECT_MISMATCH' };
      if (projectRef === expectedProjectRef && conversationRef !== null && conversationRef !== oldConversationRef) {
        return { ok: true, conversationRef };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { ok: false, code: 'CONTINUATION_TIMEOUT' };
  }

  async function continueConversation() {
    const ready = await inspectContinuationReady();
    if (ready.ok !== true || ready.ready !== true) return ready;
    const state = await readState();
    if (state === null) return { ok: false, code: 'LOCKED' };
    const projectRef = state.projectRef ?? NavaExtension.projectRefFromConversationRef(state.conversationRef);
    const projectUrl = projectRef === null ? null : NavaExtension.projectHomeUrl(projectRef);
    if (projectRef === null || projectUrl === null) return { ok: false, code: 'PROJECT_IDENTITY_MISSING' };

    let newTab;
    try {
      newTab = await chrome.tabs.create({ url: projectUrl, active: true });
    } catch {
      return { ok: false, code: 'TAB_UNAVAILABLE' };
    }
    if (!Number.isInteger(newTab?.id)) return { ok: false, code: 'TAB_UNAVAILABLE' };
    const home = await waitForProjectHome(newTab.id, projectRef);
    if (!home.ok) return home;

    let submitted;
    try {
      submitted = await sendWakeMessage(home.tab, {
        type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
        expectedProjectRef: projectRef,
        bootstrap: continuationBootstrap(state),
      });
    } catch {
      return { ok: false, code: 'TAB_UNAVAILABLE' };
    }
    if (!submitted || submitted.ok !== true || submitted.submitted !== true) {
      return { ok: false, code: NavaExtension.FAILURE_CODES.includes(submitted?.errorCode) ? submitted.errorCode : 'SUBMIT_FAILED' };
    }
    const navigated = await waitForNewConversation(newTab.id, projectRef, state.conversationRef);
    if (!navigated.ok) return navigated;

    const pairingPayload = {
      protocolVersion: 1,
      bridgeUrl: state.bridgeUrl,
      roomId: state.roomId,
      slotKey: state.slotKey,
      bindingId: ready.continuation.bindingId,
      challenge: ready.continuation.challenge,
      expiresAt: ready.continuation.expiresAt,
      connectionEpoch: state.connectionEpoch,
      allowedOrigins: [extensionOrigin()],
    };
    let paired;
    try {
      paired = await NavaBridge.pair(pairingPayload, navigated.conversationRef, await installationId());
    } catch (error) {
      return { ok: false, code: publicError(error), oldBindingPreserved: true };
    }
    if (paired.binding.id !== ready.continuation.bindingId || paired.binding.connectionEpoch !== state.connectionEpoch) {
      return { ok: false, code: 'PAIRING_MISMATCH' };
    }
    const nextState = {
      ...state,
      bindingId: paired.binding.id,
      authToken: paired.authToken,
      conversationRef: navigated.conversationRef,
      projectRef,
      supervisorSync: 'DEGRADED',
    };
    try {
      await saveContinuationState(nextState);
    } catch {
      await chrome.storage.session.set({ [SESSION_STATE_KEY]: nextState });
      return { ok: false, code: 'EXTENSION_INTERNAL', pairedButPersistenceDegraded: true };
    }
    await ensureWakeAlarm();
    const supervisor = await syncSupervisorState(nextState);
    return {
      ok: true,
      outcome: 'CONTINUED',
      oldConversationRef: state.conversationRef,
      conversationRef: navigated.conversationRef,
      projectRef,
      slotKey: state.slotKey,
      connectionEpoch: state.connectionEpoch,
      sameEpoch: true,
      supervisorSync: supervisor.supervisorSync,
    };
  }

  async function autoContinueConversation() {
    if (continuationInFlight !== null) return continuationInFlight;
    continuationInFlight = continueConversation();
    try {
      return await continuationInFlight;
    } finally {
      continuationInFlight = null;
    }
  }

  async function runCheckWakes() {
    const state = await readState();
    if (state === null) return { ok: false, code: (await hasPersistedState()) ? 'LOCKED' : 'UNPAIRED' };
    const supervisor = await syncSupervisorState(state);
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
      supervisorSync: supervisor.supervisorSync,
    };
  }

  async function checkWakes() {
    if (checkInFlight !== null) return checkInFlight;
    checkInFlight = runCheckWakes();
    try {
      return await checkInFlight;
    } finally {
      checkInFlight = null;
    }
  }

  async function acknowledgeWakeSubmitted(message, sender) {
    const state = await readState();
    if (state === null) return { ok: false, code: (await hasPersistedState()) ? 'LOCKED' : 'UNPAIRED' };
    if (!sender?.tab || typeof sender.tab.id !== 'number') return { ok: false, code: 'TAB_UNAVAILABLE' };
    const conversationRef = NavaExtension.tabConversationRef(sender.tab);
    if (conversationRef !== state.conversationRef) return { ok: false, code: 'CONVERSATION_MISMATCH' };
    if (typeof message.wakeId !== 'string' || message.wakeId.length < 1 || message.wakeId.length > 512) {
      return { ok: false, code: 'EXTENSION_INTERNAL' };
    }
    try {
      await NavaBridge.transition(state, message.wakeId, 'submitted');
      return { ok: true, wakeId: message.wakeId };
    } catch (error) {
      return { ok: false, code: publicError(error) };
    }
  }

  async function handleMessage(message, sender) {
    if (!NavaExtension.isRecord(message) || typeof message.type !== 'string') return null;
    if (message.type === 'PAIR_ACTIVE_TAB') return pairActiveTab(message.payloadText, message.passphrase);
    if (message.type === 'UNLOCK_STATE') return unlockState(message.passphrase);
    if (message.type === 'CHECK_WAKES') return checkWakes();
    if (message.type === 'SYNC_SUPERVISOR_STATE') {
      const state = await readState();
      if (state === null) return { ok: false, code: (await hasPersistedState()) ? 'LOCKED' : 'UNPAIRED', supervisorSync: 'DEGRADED' };
      const result = await syncSupervisorState(state);
      return { ok: result.ok, ...(result.ok ? {} : { code: result.code }), supervisorSync: result.supervisorSync };
    }
    if (message.type === 'CHECK_CONTINUATION_READY') return inspectContinuationReady();
    if (message.type === 'CONTINUE_CONVERSATION') return autoContinueConversation();
    if (message.type === 'ACK_WAKE_SUBMITTED') return acknowledgeWakeSubmitted(message, sender);
    if (message.type === 'GET_STATE') {
      const state = await readState();
      if (state !== null) return { ok: true, state: publicState(state) };
      return (await hasPersistedState()) ? { ok: false, code: 'LOCKED' } : { ok: true, state: null };
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!NavaExtension.isRecord(message) || !['PAIR_ACTIVE_TAB', 'UNLOCK_STATE', 'CHECK_WAKES', 'SYNC_SUPERVISOR_STATE', 'CHECK_CONTINUATION_READY', 'CONTINUE_CONVERSATION', 'ACK_WAKE_SUBMITTED', 'GET_STATE'].includes(message.type)) return false;
    void handleMessage(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false, code: 'EXTENSION_INTERNAL' }));
    return true;
  });

  if (chrome.alarms?.onAlarm?.addListener) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm?.name !== WAKE_ALARM_NAME) return;
      return Promise.all([
        checkWakes().catch(() => ({ ok: false, code: 'EXTENSION_INTERNAL' })),
        autoContinueConversation().catch(() => ({ ok: false, code: 'EXTENSION_INTERNAL' })),
      ]).then(([wakeResult]) => wakeResult);
    });
  }
  if (chrome.runtime.onStartup?.addListener) chrome.runtime.onStartup.addListener(() => void syncWakeAlarm().catch(() => {}));
  void restrictSessionStorage();
  void syncWakeAlarm().catch(() => {});
})();
