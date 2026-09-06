/* global NavaBridge, NavaCrypto, NavaExtension, URL, chrome, crypto, importScripts */

importScripts('shared.js', 'crypto.js', 'bridge.js');

(() => {
  'use strict';

  const INSTALLATION_ID_KEY = 'nava.extensionInstallationId';
  const SESSION_STATE_KEY = 'nava.commandRoomBinding';
  const SESSION_REGISTRY_KEY = 'nava.commandRoomBindings';
  const PERSISTED_STATE_KEY = 'nava.commandRoomBindingEncrypted';
  const SESSION_REWRAP_KEY = 'nava.commandRoomBindingRewrapKey';
  const REGISTRY_VERSION = 1;
  const MAX_BINDINGS = 32;
  const TERMINAL_RECOVERY_LEDGER_KEY = 'nava.terminalRecoveryLedgerV2';
  const MAX_TERMINAL_RECOVERIES = 64;
  const CONTINUATION_ATTEMPT_LEDGER_KEY = 'nava.continuationAttemptLedgerV2';
  const MAX_CONTINUATION_ATTEMPTS = 64;
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
    'TERMINAL_RECOVERY_BLOCKED',
  ]);
  let checkInFlight = null;
  const continuationInFlightByBinding = new Map();
  const continuationSubmissionPlans = new Map();
  let registryMutationTail = Promise.resolve();

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

  async function readTerminalRecoveryLedger() {
    const stored = await chrome.storage.local.get(TERMINAL_RECOVERY_LEDGER_KEY);
    const value = stored?.[TERMINAL_RECOVERY_LEDGER_KEY];
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => (
      NavaExtension.isRecord(entry)
      && typeof entry.recoveryId === 'string'
      && typeof entry.bindingId === 'string'
      && typeof entry.checkpointId === 'string'
      && ['CLAIMED', 'TAB_CREATED', 'COMPLETED'].includes(entry.stage)
      && (entry.tabId === undefined || Number.isInteger(entry.tabId))
    )).slice(-MAX_TERMINAL_RECOVERIES);
  }

  async function writeTerminalRecoveryLedger(entries) {
    await chrome.storage.local.set({ [TERMINAL_RECOVERY_LEDGER_KEY]: entries.slice(-MAX_TERMINAL_RECOVERIES) });
  }

  async function claimTerminalRecovery(recoveryId, bindingId, checkpointId) {
    const entries = await readTerminalRecoveryLedger();
    if (entries.some((entry) => entry.recoveryId === recoveryId)) return false;
    entries.push({ recoveryId, bindingId, checkpointId, stage: 'CLAIMED', updatedAt: new Date().toISOString() });
    await writeTerminalRecoveryLedger(entries);
    return true;
  }

  async function updateTerminalRecovery(recoveryId, patch) {
    const entries = await readTerminalRecoveryLedger();
    const index = entries.findIndex((entry) => entry.recoveryId === recoveryId);
    if (index < 0) return false;
    entries[index] = { ...entries[index], ...patch, updatedAt: new Date().toISOString() };
    await writeTerminalRecoveryLedger(entries);
    return true;
  }

  async function hasTerminalRecovery(recoveryId) {
    return (await readTerminalRecoveryLedger()).some((entry) => entry.recoveryId === recoveryId);
  }

  async function readContinuationAttemptLedger() {
    const stored = await chrome.storage.local.get(CONTINUATION_ATTEMPT_LEDGER_KEY);
    const value = stored?.[CONTINUATION_ATTEMPT_LEDGER_KEY];
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => (
      NavaExtension.isRecord(entry)
      && typeof entry.identity === 'string'
      && typeof entry.bindingId === 'string'
      && typeof entry.conversationRef === 'string'
      && typeof entry.terminalKind === 'string'
      && ['CLAIMED', 'TAB_CREATED', 'SUBMIT_ATTEMPTED', 'COMPLETED'].includes(entry.stage)
      && (entry.tabId === undefined || Number.isInteger(entry.tabId))
    )).slice(-MAX_CONTINUATION_ATTEMPTS);
  }

  async function writeContinuationAttemptLedger(entries) {
    await chrome.storage.local.set({ [CONTINUATION_ATTEMPT_LEDGER_KEY]: entries.slice(-MAX_CONTINUATION_ATTEMPTS) });
  }

  function continuationAttemptIdentity(source, terminalKind) {
    return [source.bindingId, source.conversationRef, terminalKind].join('\0');
  }

  async function hasContinuationAttempt(identity) {
    return (await readContinuationAttemptLedger()).some((entry) => entry.identity === identity);
  }

  async function claimContinuationAttempt(source, terminalKind) {
    const identity = continuationAttemptIdentity(source, terminalKind);
    const entries = await readContinuationAttemptLedger();
    if (entries.some((entry) => entry.identity === identity)) return null;
    const attemptId = crypto.randomUUID();
    entries.push({
      identity,
      attemptId,
      bindingId: source.bindingId,
      conversationRef: source.conversationRef,
      terminalKind,
      stage: 'CLAIMED',
      updatedAt: new Date().toISOString(),
    });
    await writeContinuationAttemptLedger(entries);
    return { identity, attemptId };
  }

  async function updateContinuationAttempt(identity, patch) {
    const entries = await readContinuationAttemptLedger();
    const index = entries.findIndex((entry) => entry.identity === identity);
    if (index < 0) return false;
    entries[index] = { ...entries[index], ...patch, updatedAt: new Date().toISOString() };
    await writeContinuationAttemptLedger(entries);
    return true;
  }

  function queueRegistryMutation(operation) {
    const run = registryMutationTail.then(operation, operation);
    registryMutationTail = run.catch(() => {});
    return run;
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

  function validRegistry(value) {
    if (!NavaExtension.isRecord(value) || value.registryVersion !== REGISTRY_VERSION || !Array.isArray(value.bindings)) return false;
    if (value.bindings.length < 1 || value.bindings.length > MAX_BINDINGS || !value.bindings.every(validState)) return false;
    const slots = new Set();
    const ids = new Set();
    for (const state of value.bindings) {
      const slotIdentity = state.roomId + '\0' + state.slotKey;
      if (slots.has(slotIdentity) || ids.has(state.bindingId)) return false;
      slots.add(slotIdentity);
      ids.add(state.bindingId);
    }
    return true;
  }

  function registryFromValue(value) {
    if (validRegistry(value)) return { registryVersion: REGISTRY_VERSION, bindings: [...value.bindings] };
    if (validState(value)) return { registryVersion: REGISTRY_VERSION, bindings: [value] };
    return null;
  }

  function upsertRegistryState(registry, state) {
    const bindings = registry.bindings.filter((entry) => (
      !(entry.roomId === state.roomId && entry.slotKey === state.slotKey)
      && entry.bindingId !== state.bindingId
    ));
    bindings.push(state);
    if (bindings.length > MAX_BINDINGS) bindings.splice(0, bindings.length - MAX_BINDINGS);
    return { registryVersion: REGISTRY_VERSION, bindings };
  }

  async function readRegistry() {
    const stored = await chrome.storage.session.get([SESSION_REGISTRY_KEY, SESSION_STATE_KEY]);
    return registryFromValue(stored?.[SESSION_REGISTRY_KEY]) ?? registryFromValue(stored?.[SESSION_STATE_KEY]);
  }

  async function stateForActiveTab(registry, fallback = null) {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tabs.length === 1) {
        const conversationRef = NavaExtension.tabConversationRef(tabs[0]);
        if (conversationRef !== null) {
          const exact = registry.bindings.find((state) => state.conversationRef === conversationRef);
          if (exact !== undefined) return exact;
        }
      }
    } catch {
      // Fall back to the previously selected state.
    }
    if (validState(fallback)) {
      const exact = registry.bindings.find((state) => state.bindingId === fallback.bindingId);
      if (exact !== undefined) return exact;
    }
    return registry.bindings[0] ?? null;
  }

  async function writeSessionRegistry(registry, currentState = null, sessionKey = undefined) {
    const selected = await stateForActiveTab(registry, currentState);
    await chrome.storage.session.set({
      [SESSION_REGISTRY_KEY]: registry,
      ...(selected === null ? {} : { [SESSION_STATE_KEY]: selected }),
      ...(typeof sessionKey === 'string' ? { [SESSION_REWRAP_KEY]: sessionKey } : {}),
    });
    return selected;
  }

  async function readState() {
    const stored = await chrome.storage.session.get(SESSION_STATE_KEY);
    const registry = await readRegistry();
    if (registry === null) return null;
    return stateForActiveTab(registry, validState(stored?.[SESSION_STATE_KEY]) ? stored[SESSION_STATE_KEY] : null);
  }

  async function updateSessionState(state) {
    return queueRegistryMutation(async () => {
      const registry = await readRegistry();
      if (registry === null) {
        await chrome.storage.session.set({
          [SESSION_REGISTRY_KEY]: { registryVersion: REGISTRY_VERSION, bindings: [state] },
          [SESSION_STATE_KEY]: state,
        });
        return state;
      }
      const nextRegistry = upsertRegistryState(registry, state);
      await writeSessionRegistry(nextRegistry, state);
      return state;
    });
  }

  async function updateRegistryBindingState(state) {
    return queueRegistryMutation(async () => {
      const registry = await readRegistry();
      const nextRegistry = registry === null
        ? { registryVersion: REGISTRY_VERSION, bindings: [state] }
        : upsertRegistryState(registry, state);
      await chrome.storage.session.set({ [SESSION_REGISTRY_KEY]: nextRegistry });
      return state;
    });
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
    let registry = { registryVersion: REGISTRY_VERSION, bindings: [state] };
    const stored = await chrome.storage.local.get(PERSISTED_STATE_KEY);
    const envelope = stored?.[PERSISTED_STATE_KEY];
    if (NavaCrypto.isEnvelope(envelope)) {
      const existing = await NavaCrypto.unlockState(envelope, passphrase);
      const existingRegistry = registryFromValue(existing.state);
      if (existingRegistry === null) throw new Error('LOCKED');
      registry = upsertRegistryState(existingRegistry, state);
    }
    const unlocked = await NavaCrypto.createUnlockedEnvelope(registry, passphrase);
    await chrome.storage.local.set({ [PERSISTED_STATE_KEY]: unlocked.envelope });
    await writeSessionRegistry(registry, state, unlocked.sessionKey);
  }

  async function saveContinuationState(state) {
    return queueRegistryMutation(async () => {
      const [localStored, sessionStored, registry] = await Promise.all([
        chrome.storage.local.get(PERSISTED_STATE_KEY),
        chrome.storage.session.get(SESSION_REWRAP_KEY),
        readRegistry(),
      ]);
      const envelope = localStored?.[PERSISTED_STATE_KEY];
      const sessionKey = sessionStored?.[SESSION_REWRAP_KEY];
      if (!NavaCrypto.isEnvelope(envelope) || typeof sessionKey !== 'string' || registry === null) throw new Error('LOCKED');
      const nextRegistry = upsertRegistryState(registry, state);
      const encrypted = await NavaCrypto.encryptStateWithSessionKey(envelope, nextRegistry, sessionKey);
      await chrome.storage.local.set({ [PERSISTED_STATE_KEY]: encrypted });
      await writeSessionRegistry(nextRegistry, state);
      return state;
    });
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
      if (await readRegistry()) {
        await ensureWakeAlarm();
      } else {
        await clearWakeAlarm();
      }
    } catch {
      // Storage failures must not create an unhandled service-worker rejection.
    }
  }

  async function syncSupervisorState(state) {
    if (state.slotKey === 'MAIN') return { ok: true, response: null, supervisorSync: 'OK', state };
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
        await updateRegistryBindingState(nextState);
      } catch {
        // Supervisor synchronization is advisory plumbing and must never block core work.
      }
      return { ok: false, code: publicError(error), supervisorSync, state: nextState };
    }
    const nextState = { ...state, supervisorSync };
    try {
      await updateRegistryBindingState(nextState);
    } catch {
      // Keep core work available even when supervisor state cannot be mirrored locally.
    }
    return { ok: true, response, supervisorSync, state: nextState };
  }

  async function recoverRegistry(registry) {
    const seed = registry.bindings.find((state) => validState(state));
    if (seed === undefined) return registry;
    let tabs;
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return registry;
    }
    const conversationRefs = [...new Set(tabs.map((tab) => NavaExtension.tabConversationRef(tab)).filter((value) => value !== null))];
    if (conversationRefs.length === 0) return registry;
    let response;
    try {
      response = await NavaBridge.recoverBindings(seed, conversationRefs.slice(0, MAX_BINDINGS));
    } catch {
      return registry;
    }
    const recovered = Array.isArray(response?.bindings) ? response.bindings : [];
    let next = registry;
    for (const item of recovered) {
      if (!NavaExtension.isRecord(item) || !NavaExtension.isRecord(item.binding)) continue;
      const conversationRef = item.conversationRef;
      const binding = item.binding;
      if (
        typeof conversationRef !== 'string'
        || typeof item.authToken !== 'string'
        || typeof binding.id !== 'string'
        || typeof binding.roomId !== 'string'
        || typeof binding.slotKey !== 'string'
        || !Number.isSafeInteger(binding.connectionEpoch)
      ) continue;
      const projectRef = NavaExtension.projectRefFromConversationRef(conversationRef);
      const state = {
        roomId: binding.roomId,
        slotKey: binding.slotKey,
        bindingId: binding.id,
        connectionEpoch: binding.connectionEpoch,
        conversationRef,
        ...(projectRef === null ? {} : { projectRef }),
        bridgeUrl: seed.bridgeUrl,
        authToken: item.authToken,
        supervisorSync: 'DEGRADED',
      };
      if (validState(state)) next = upsertRegistryState(next, state);
    }
    return next;
  }

  function mergeSupervisorSync(left, right) {
    if (left === 'FAILED' || right === 'FAILED') return 'FAILED';
    if (left === 'DEGRADED' || right === 'DEGRADED') return 'DEGRADED';
    return 'OK';
  }

  async function syncAllSupervisorStates(registry) {
    let supervisorSync = 'OK';
    let ok = true;
    let code;
    for (const state of registry.bindings) {
      const result = await syncSupervisorState(state);
      supervisorSync = mergeSupervisorSync(supervisorSync, result.supervisorSync);
      if (result.ok !== true) {
        ok = false;
        if (code === undefined) code = result.code;
      }
    }
    return { ok, ...(code === undefined ? {} : { code }), supervisorSync };
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
    let registry = registryFromValue(unlocked.state);
    if (registry === null) return { ok: false, code: 'INVALID_PASSPHRASE' };
    registry = await recoverRegistry(registry);
    const encrypted = await NavaCrypto.encryptStateWithSessionKey(unlocked.envelope, registry, unlocked.sessionKey);
    await chrome.storage.local.set({ [PERSISTED_STATE_KEY]: encrypted });
    const selected = await writeSessionRegistry(registry, registry.bindings[0] ?? null, unlocked.sessionKey);
    await ensureWakeAlarm();
    await syncAllSupervisorStates(registry);
    const refreshed = await readState();
    return { ok: true, state: publicState(refreshed ?? selected) };
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

  function continuationSourceSnapshot(state) {
    const projectRef = state.projectRef ?? NavaExtension.projectRefFromConversationRef(state.conversationRef);
    return Object.freeze({
      roomId: state.roomId,
      slotKey: state.slotKey,
      bindingId: state.bindingId,
      conversationRef: state.conversationRef,
      ...(projectRef === null ? {} : { projectRef }),
      connectionEpoch: state.connectionEpoch,
      bridgeUrl: state.bridgeUrl,
      authToken: state.authToken,
    });
  }

  function sameContinuationSource(left, right) {
    return left !== null && right !== null
      && left.roomId === right.roomId
      && left.slotKey === right.slotKey
      && left.bindingId === right.bindingId
      && left.conversationRef === right.conversationRef
      && left.projectRef === right.projectRef
      && left.connectionEpoch === right.connectionEpoch
      && left.bridgeUrl === right.bridgeUrl
      && left.authToken === right.authToken;
  }

  async function revalidateContinuationSource(source) {
    const registry = await readRegistry();
    if (registry === null) return false;
    const current = registry.bindings.find((state) => state.bindingId === source.bindingId);
    if (current === undefined) return false;
    return sameContinuationSource(source, continuationSourceSnapshot(current));
  }

  function freezeContinuationPlan(source, terminalKind, continuation, recovery = undefined) {
    return Object.freeze({
      source,
      terminalKind,
      continuation: Object.freeze({ ...continuation }),
      ...(recovery === undefined ? {} : { recovery: Object.freeze({ ...recovery }) }),
    });
  }

  async function inspectContinuationReady(sourceState = undefined) {
    const state = validState(sourceState) ? sourceState : await readState();
    if (state === null) return { ok: false, code: (await hasPersistedState()) ? 'LOCKED' : 'UNPAIRED' };
    const source = continuationSourceSnapshot(state);
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
    const terminal = inspected.terminal;
    const exactMax = inspected.limit?.maxLength === true || terminal?.kind === 'EXACT_MAX_LENGTH';
    const timeout = terminal?.terminal === true && terminal?.kind === 'MESSAGE_DELIVERY_TIMEOUT';
    if (!exactMax && !timeout) return { ok: true, ready: false, reason: 'NOT_AT_MAX_LENGTH' };
    if (inspected.composer?.errorCode === 'COMPOSER_NOT_EMPTY') return { ok: false, code: 'COMPOSER_NOT_EMPTY' };
    if (timeout && terminal.generationActive === true) {
      return { ok: true, ready: false, reason: 'RECOVERY_WAIT', recoveryReason: 'GENERATION_ACTIVE' };
    }
    if (inspected.composer?.ok !== true) return { ok: false, code: 'DOM_MISMATCH' };
    const projectRef = state.projectRef ?? NavaExtension.projectRefFromConversationRef(state.conversationRef);
    if (projectRef === null || NavaExtension.projectHomeUrl(projectRef) === null) return { ok: false, code: 'PROJECT_IDENTITY_MISSING' };

    if (timeout) {
      if (typeof terminal.terminalTurnKey !== 'string' || terminal.terminalTurnKey.length < 8) return { ok: false, code: 'DOM_MISMATCH' };
      let recovery;
      try {
        recovery = await NavaBridge.assessTerminalRecovery(state, {
          terminalKind: 'MESSAGE_DELIVERY_TIMEOUT',
          conversationRef: state.conversationRef,
          terminalTurnKey: terminal.terminalTurnKey,
          generationActive: false,
        });
      } catch (error) {
        return { ok: false, code: publicError(error) };
      }
      if (recovery?.outcome === 'wait') {
        return { ok: true, ready: false, reason: 'RECOVERY_WAIT', recoveryReason: recovery.reason, checkpointId: recovery.checkpointId };
      }
      if (recovery?.outcome === 'duplicate') {
        return { ok: true, ready: false, reason: 'RECOVERY_ALREADY_HANDLED', recoveryId: recovery.recoveryId, checkpointId: recovery.checkpointId };
      }
      if (recovery?.outcome === 'failed') return { ok: false, code: 'TERMINAL_RECOVERY_BLOCKED', recoveryReason: recovery.reason };
      if (recovery?.outcome !== 'authorized' || !recovery.continuation) return { ok: false, code: 'EXTENSION_INTERNAL' };
      if (recovery.continuation.connectionEpoch !== state.connectionEpoch) return { ok: false, code: 'PAIRING_MISMATCH' };
      if (await hasTerminalRecovery(recovery.recoveryId)) {
        return { ok: true, ready: false, reason: 'RECOVERY_ALREADY_HANDLED', recoveryId: recovery.recoveryId, checkpointId: recovery.checkpointId };
      }
      if (!(await revalidateContinuationSource(source))) return { ok: false, code: 'CONVERSATION_MISMATCH' };
      return {
        ok: true,
        ready: true,
        plan: freezeContinuationPlan(
          source,
          'MESSAGE_DELIVERY_TIMEOUT',
          recovery.continuation,
          { recoveryId: recovery.recoveryId, checkpointId: recovery.checkpointId },
        ),
      };
    }

    const exactAttemptIdentity = continuationAttemptIdentity(source, 'EXACT_MAX_LENGTH');
    if (await hasContinuationAttempt(exactAttemptIdentity)) {
      return { ok: true, ready: false, reason: 'CONTINUATION_ALREADY_ATTEMPTED', attemptIdentity: exactAttemptIdentity };
    }
    let challenge;
    try {
      challenge = await NavaBridge.createContinuationChallenge(state);
    } catch (error) {
      return { ok: false, code: publicError(error) };
    }
    if (!challenge?.continuation || challenge.continuation.connectionEpoch !== state.connectionEpoch) {
      return { ok: false, code: 'PAIRING_MISMATCH' };
    }
    if (!(await revalidateContinuationSource(source))) return { ok: false, code: 'CONVERSATION_MISMATCH' };
    return {
      ok: true,
      ready: true,
      plan: freezeContinuationPlan(source, 'EXACT_MAX_LENGTH', challenge.continuation),
    };
  }

  function continuationBootstrap(state, recovery) {
    const lines = [
      '@NAVA Agent',
      '',
      'NAVA AUTO CONTINUATION',
      `Room: ${state.roomId}`,
      `Slot: ${state.slotKey}`,
      `Connection epoch: ${state.connectionEpoch}`,
      'Browser-binding continuation only. Do NOT command_room_join, rejoin, rebind, takeover, or rotate connection epoch.',
    ];
    if (recovery !== undefined) {
      lines.push(
        'TERMINAL RECOVERY V2 — MESSAGE DELIVERY TIMED OUT.',
        `Recovery ID: ${recovery.recoveryId}`,
        `Authoritative checkpoint: ${recovery.checkpointId}`,
        'Do NOT retry, replay, or resubmit the failed user turn.',
        'Assume side effects represented by the authoritative checkpoint may already have happened; resume strictly after that checkpoint.',
      );
    }
    lines.push('Use NAVA session_resume / durable checkpoint continuity, verify live project/workspace evidence, then continue from the latest safe resume point.');
    return lines.join('\\n');
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

  async function validateContinuationSubmission(message, sender) {
    if (typeof message.attemptId !== 'string' || message.attemptId.length < 8) return { ok: false, code: 'EXTENSION_INTERNAL' };
    const attempt = continuationSubmissionPlans.get(message.attemptId);
    if (attempt === undefined) return { ok: false, code: 'CONVERSATION_MISMATCH' };
    if (!Number.isInteger(sender?.tab?.id) || sender.tab.id !== attempt.tabId) return { ok: false, code: 'TAB_UNAVAILABLE' };
    if (Date.now() >= attempt.expiresAtMs) return { ok: false, code: 'PAIRING_EXPIRED' };
    if (!(await revalidateContinuationSource(attempt.source))) return { ok: false, code: 'CONVERSATION_MISMATCH' };
    return { ok: true };
  }

  async function continueConversation(sourceState = undefined) {
    const ready = await inspectContinuationReady(sourceState);
    if (ready.ok !== true || ready.ready !== true) return ready;
    const plan = ready.plan;
    if (!NavaExtension.isRecord(plan) || !NavaExtension.isRecord(plan.source) || !NavaExtension.isRecord(plan.continuation)) {
      return { ok: false, code: 'EXTENSION_INTERNAL' };
    }
    const source = plan.source;
    if (!(await revalidateContinuationSource(source))) return { ok: false, code: 'CONVERSATION_MISMATCH' };
    const projectRef = source.projectRef ?? NavaExtension.projectRefFromConversationRef(source.conversationRef);
    const projectUrl = projectRef === null ? null : NavaExtension.projectHomeUrl(projectRef);
    if (projectRef === null || projectUrl === null) return { ok: false, code: 'PROJECT_IDENTITY_MISSING' };
    const expiresAtMs = Date.parse(plan.continuation.expiresAt);
    if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) return { ok: false, code: 'PAIRING_EXPIRED' };

    const recovery = plan.terminalKind === 'MESSAGE_DELIVERY_TIMEOUT' ? plan.recovery : undefined;
    let continuationAttempt = null;
    if (recovery !== undefined) {
      const claimed = await claimTerminalRecovery(recovery.recoveryId, source.bindingId, recovery.checkpointId);
      if (!claimed) return { ok: true, ready: false, reason: 'RECOVERY_ALREADY_HANDLED', ...recovery };
    } else {
      continuationAttempt = await claimContinuationAttempt(source, plan.terminalKind);
      if (continuationAttempt === null) {
        return { ok: true, ready: false, reason: 'CONTINUATION_ALREADY_ATTEMPTED' };
      }
    }

    if (!(await revalidateContinuationSource(source))) return { ok: false, code: 'CONVERSATION_MISMATCH' };
    let newTab;
    try {
      newTab = await chrome.tabs.create({ url: projectUrl, active: true });
    } catch {
      return { ok: false, code: 'TAB_UNAVAILABLE' };
    }
    if (!Number.isInteger(newTab?.id)) return { ok: false, code: 'TAB_UNAVAILABLE' };
    if (recovery !== undefined) await updateTerminalRecovery(recovery.recoveryId, { stage: 'TAB_CREATED', tabId: newTab.id });
    if (continuationAttempt !== null) {
      await updateContinuationAttempt(continuationAttempt.identity, { stage: 'TAB_CREATED', tabId: newTab.id });
    }
    const home = await waitForProjectHome(newTab.id, projectRef);
    if (!home.ok) return home;
    if (!(await revalidateContinuationSource(source))) return { ok: false, code: 'CONVERSATION_MISMATCH' };

    const submissionAttemptId = crypto.randomUUID();
    continuationSubmissionPlans.set(submissionAttemptId, {
      source,
      tabId: newTab.id,
      expiresAtMs,
      continuationBindingId: plan.continuation.bindingId,
    });
    let submitted;
    try {
      submitted = await sendWakeMessage(home.tab, {
        type: 'NAVA_SUBMIT_CONTINUATION_BOOTSTRAP',
        expectedProjectRef: projectRef,
        sourceBindingId: source.bindingId,
        submissionAttemptId,
        authorityExpiresAt: plan.continuation.expiresAt,
        bootstrap: continuationBootstrap(source, recovery),
      });
    } catch {
      continuationSubmissionPlans.delete(submissionAttemptId);
      return { ok: false, code: 'TAB_UNAVAILABLE' };
    }
    continuationSubmissionPlans.delete(submissionAttemptId);
    if (!submitted || submitted.ok !== true || submitted.submitted !== true) {
      return { ok: false, code: NavaExtension.FAILURE_CODES.includes(submitted?.errorCode) ? submitted.errorCode : 'SUBMIT_FAILED' };
    }
    if (continuationAttempt !== null) {
      await updateContinuationAttempt(continuationAttempt.identity, { stage: 'SUBMIT_ATTEMPTED', tabId: newTab.id });
    }
    const navigated = await waitForNewConversation(newTab.id, projectRef, source.conversationRef);
    if (!navigated.ok) return navigated;
    if (!(await revalidateContinuationSource(source))) return { ok: false, code: 'CONVERSATION_MISMATCH', oldBindingPreserved: true };
    if (Date.now() >= expiresAtMs) return { ok: false, code: 'PAIRING_EXPIRED', oldBindingPreserved: true };

    const pairingPayload = {
      protocolVersion: 1,
      bridgeUrl: source.bridgeUrl,
      roomId: source.roomId,
      slotKey: source.slotKey,
      bindingId: plan.continuation.bindingId,
      challenge: plan.continuation.challenge,
      expiresAt: plan.continuation.expiresAt,
      connectionEpoch: source.connectionEpoch,
      allowedOrigins: [extensionOrigin()],
    };
    let paired;
    try {
      paired = await NavaBridge.pair(pairingPayload, navigated.conversationRef, await installationId());
    } catch (error) {
      return { ok: false, code: publicError(error), oldBindingPreserved: true };
    }
    if (paired.binding.id !== plan.continuation.bindingId || paired.binding.connectionEpoch !== source.connectionEpoch) {
      return { ok: false, code: 'PAIRING_MISMATCH' };
    }
    const nextState = {
      ...source,
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
    if (recovery !== undefined) await updateTerminalRecovery(recovery.recoveryId, { stage: 'COMPLETED', tabId: newTab.id });
    if (continuationAttempt !== null) {
      await updateContinuationAttempt(continuationAttempt.identity, { stage: 'COMPLETED', tabId: newTab.id });
    }
    await ensureWakeAlarm();
    const supervisor = await syncSupervisorState(nextState);
    return {
      ok: true,
      outcome: 'CONTINUED',
      oldConversationRef: source.conversationRef,
      conversationRef: navigated.conversationRef,
      projectRef,
      slotKey: source.slotKey,
      connectionEpoch: source.connectionEpoch,
      sameEpoch: true,
      supervisorSync: supervisor.supervisorSync,
      ...(recovery === undefined ? {} : { recoveryId: recovery.recoveryId, checkpointId: recovery.checkpointId, terminalKind: 'MESSAGE_DELIVERY_TIMEOUT' }),
    };
  }

  async function autoContinueConversation(sourceState = undefined) {
    const source = validState(sourceState) ? sourceState : await readState();
    if (source === null) return { ok: false, code: (await hasPersistedState()) ? 'LOCKED' : 'UNPAIRED' };
    const key = source.bindingId;
    const existing = continuationInFlightByBinding.get(key);
    if (existing !== undefined) return existing;
    const pending = continueConversation(source);
    continuationInFlightByBinding.set(key, pending);
    try {
      return await pending;
    } finally {
      if (continuationInFlightByBinding.get(key) === pending) continuationInFlightByBinding.delete(key);
    }
  }

  async function autoContinueRegistry() {
    const registry = await readRegistry();
    if (registry === null) return [];
    let tabs;
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return [];
    }
    const candidates = registry.bindings.filter((state) => NavaExtension.selectExactTab(tabs, state.conversationRef).ok);
    return Promise.all(candidates.map((state) => autoContinueConversation(state).catch(() => ({ ok: false, code: 'EXTENSION_INTERNAL' }))));
  }

  async function runCheckWakes() {
    const registry = await readRegistry();
    if (registry === null) return { ok: false, code: (await hasPersistedState()) ? 'LOCKED' : 'UNPAIRED' };
    let tabs;
    try {
      tabs = await chrome.tabs.query({});
    } catch {
      return { ok: false, code: 'TAB_NOT_FOUND' };
    }
    let deliveredCount = 0;
    let failedCount = 0;
    let pendingCount = 0;
    let supervisorSync = 'OK';
    let anyCoreSuccess = false;
    let firstError = null;
    for (const state of registry.bindings) {
      const supervisor = await syncSupervisorState(state);
      supervisorSync = mergeSupervisorSync(supervisorSync, supervisor.supervisorSync);
      const target = NavaExtension.selectExactTab(tabs, state.conversationRef);
      if (!target.ok) {
        pendingCount += 1;
        if (firstError === null) firstError = target.errorCode;
        continue;
      }
      let response;
      try {
        response = await NavaBridge.listWakes(state);
      } catch (error) {
        if (firstError === null) firstError = publicError(error);
        continue;
      }
      anyCoreSuccess = true;
      const wakes = Array.isArray(response.wakes) ? response.wakes : [];
      let handled = 0;
      for (const wake of wakes) {
        if (!NavaExtension.isRecord(wake) || typeof wake.id !== 'string') continue;
        const result = await deliverWake(state, target.tab, wake);
        if (result.delivered) deliveredCount += 1;
        if (result.failed) failedCount += 1;
        if (result.pendingAck) pendingCount += 1;
        handled += 1;
      }
      pendingCount += Math.max(0, wakes.length - handled);
      try {
        await NavaBridge.touch(state);
      } catch {
        // A wake result remains authoritative; a heartbeat can be retried later.
      }
    }
    if (!anyCoreSuccess && firstError !== null) return { ok: false, code: firstError };
    return { ok: true, deliveredCount, failedCount, pendingCount, supervisorSync };
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
    const registry = await readRegistry();
    if (registry === null) return { ok: false, code: (await hasPersistedState()) ? 'LOCKED' : 'UNPAIRED' };
    if (!sender?.tab || typeof sender.tab.id !== 'number') return { ok: false, code: 'TAB_UNAVAILABLE' };
    const conversationRef = NavaExtension.tabConversationRef(sender.tab);
    const state = conversationRef === null ? null : registry.bindings.find((entry) => entry.conversationRef === conversationRef) ?? null;
    if (state === null) return { ok: false, code: 'CONVERSATION_MISMATCH' };
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
      const registry = await readRegistry();
      if (registry === null) return { ok: false, code: (await hasPersistedState()) ? 'LOCKED' : 'UNPAIRED', supervisorSync: 'DEGRADED' };
      return syncAllSupervisorStates(registry);
    }
    if (message.type === 'CHECK_CONTINUATION_READY') return inspectContinuationReady();
    if (message.type === 'CONTINUE_CONVERSATION') return autoContinueConversation();
    if (message.type === 'NAVA_VALIDATE_CONTINUATION_SUBMISSION') return validateContinuationSubmission(message, sender);
    if (message.type === 'ACK_WAKE_SUBMITTED') return acknowledgeWakeSubmitted(message, sender);
    if (message.type === 'GET_STATE') {
      const state = await readState();
      if (state !== null) return { ok: true, state: publicState(state) };
      return (await hasPersistedState()) ? { ok: false, code: 'LOCKED' } : { ok: true, state: null };
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!NavaExtension.isRecord(message) || !['PAIR_ACTIVE_TAB', 'UNLOCK_STATE', 'CHECK_WAKES', 'SYNC_SUPERVISOR_STATE', 'CHECK_CONTINUATION_READY', 'CONTINUE_CONVERSATION', 'NAVA_VALIDATE_CONTINUATION_SUBMISSION', 'ACK_WAKE_SUBMITTED', 'GET_STATE'].includes(message.type)) return false;
    void handleMessage(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false, code: 'EXTENSION_INTERNAL' }));
    return true;
  });

  if (chrome.alarms?.onAlarm?.addListener) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm?.name !== WAKE_ALARM_NAME) return;
      // Auto Continuation is intentionally disabled globally.
      // Alarm polling may deliver wakes/supervisor state, but it must never create ChatGPT tabs.
      return checkWakes().catch(() => ({ ok: false, code: 'EXTENSION_INTERNAL' }));
    });
  }
  if (chrome.runtime.onStartup?.addListener) chrome.runtime.onStartup.addListener(() => void syncWakeAlarm().catch(() => {}));
  void restrictSessionStorage();
  void syncWakeAlarm().catch(() => {});
})();
