/* global NavaExtension, fetch */

(() => {
  'use strict';

  const TRANSITIONS = Object.freeze(['attempt', 'delivered', 'submitted', 'failed']);

  function bridgeError(code, status = 0) {
    const error = new Error(code);
    error.code = code;
    error.status = status;
    return error;
  }

  function safeResponseCode(value, status) {
    if (value && typeof value.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(value.code)) return value.code;
    return `HTTP_${status}`;
  }

  async function requestJson(url, options = {}) {
    const headers = { Accept: 'application/json' };
    if (typeof options.authToken === 'string') headers.Authorization = `Bearer ${options.authToken}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
    } catch {
      throw bridgeError('BRIDGE_UNAVAILABLE');
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      throw bridgeError('INVALID_BRIDGE_RESPONSE', response.status);
    }
    if (!response.ok) throw bridgeError(safeResponseCode(body, response.status), response.status);
    if (!NavaExtension.isRecord(body)) throw bridgeError('INVALID_BRIDGE_RESPONSE', response.status);
    return body;
  }

  function endpoint(baseUrl, path) {
    const normalized = NavaExtension.validateBridgeUrl(baseUrl);
    if (normalized === null) throw bridgeError('BRIDGE_URL_INVALID');
    return `${normalized}${path}`;
  }

  async function pair(payload, conversationRef, installationId) {
    const checked = NavaExtension.validatePairingPayload(payload);
    if (!checked.ok) throw bridgeError(checked.code);
    if (typeof conversationRef !== 'string' || conversationRef.length < 8 || conversationRef.length > 2_048) {
      throw bridgeError('CONVERSATION_MISMATCH');
    }
    if (typeof installationId !== 'string' || installationId.length < 8 || installationId.length > 512) {
      throw bridgeError('EXTENSION_INTERNAL');
    }
    const body = await requestJson(endpoint(checked.payload.bridgeUrl, '/v1/pair/confirm'), {
      method: 'POST',
      body: {
        bindingId: checked.payload.bindingId,
        challenge: checked.payload.challenge,
        extensionInstallationId: installationId,
        conversationRef,
      },
    });
    if (body.outcome !== 'paired' || typeof body.authToken !== 'string' || !/^nava-v1\.[A-Za-z0-9_-]{16,}$/.test(body.authToken) || !NavaExtension.isRecord(body.binding)) {
      throw bridgeError('INVALID_BRIDGE_RESPONSE');
    }
    return { binding: body.binding, authToken: body.authToken };
  }

  async function assessTerminalRecovery(state, evidence) {
    if (!NavaExtension.isRecord(evidence)
      || evidence.terminalKind !== 'MESSAGE_DELIVERY_TIMEOUT'
      || typeof evidence.conversationRef !== 'string'
      || typeof evidence.terminalTurnKey !== 'string'
      || evidence.generationActive !== false) throw bridgeError('EXTENSION_INTERNAL');
    return requestJson(endpoint(state.bridgeUrl, `/v1/bindings/${encodeURIComponent(state.bindingId)}/terminal-recovery`), {
      method: 'POST',
      authToken: state.authToken,
      body: evidence,
    });
  }

  async function createContinuationChallenge(state) {
    return requestJson(endpoint(state.bridgeUrl, `/v1/bindings/${encodeURIComponent(state.bindingId)}/continuation`), {
      method: 'POST',
      authToken: state.authToken,
      body: {},
    });
  }

  async function listWakes(state) {
    return requestJson(endpoint(state.bridgeUrl, `/v1/bindings/${encodeURIComponent(state.bindingId)}/wakes?limit=25`), {
      authToken: state.authToken,
    });
  }

  async function recoverBindings(state, conversationRefs) {
    if (!Array.isArray(conversationRefs) || conversationRefs.length < 1 || conversationRefs.length > 32) {
      throw bridgeError('EXTENSION_INTERNAL');
    }
    return requestJson(endpoint(state.bridgeUrl, `/v1/bindings/${encodeURIComponent(state.bindingId)}/recover`), {
      method: 'POST',
      authToken: state.authToken,
      body: { conversationRefs },
    });
  }

  async function syncSupervisor(state) {
    return requestJson(endpoint(state.bridgeUrl, `/v1/bindings/${encodeURIComponent(state.bindingId)}/supervisor`), {
      method: 'POST',
      authToken: state.authToken,
      body: {},
    });
  }

  async function touch(state) {
    return requestJson(endpoint(state.bridgeUrl, `/v1/bindings/${encodeURIComponent(state.bindingId)}/touch`), {
      method: 'POST',
      authToken: state.authToken,
      body: {},
    });
  }

  async function transition(state, wakeId, transitionName, errorCode) {
    if (!TRANSITIONS.includes(transitionName)) throw bridgeError('EXTENSION_INTERNAL');
    if (typeof wakeId !== 'string' || wakeId.length < 1 || wakeId.length > 512) throw bridgeError('EXTENSION_INTERNAL');
    const body = { bindingId: state.bindingId };
    if (transitionName === 'failed') {
      if (!NavaExtension.FAILURE_CODES.includes(errorCode)) throw bridgeError('EXTENSION_INTERNAL');
      body.errorCode = errorCode;
    }
    return requestJson(endpoint(state.bridgeUrl, `/v1/wakes/${encodeURIComponent(wakeId)}/${transitionName}`), {
      method: 'POST',
      authToken: state.authToken,
      body,
    });
  }

  globalThis.NavaBridge = Object.freeze({ assessTerminalRecovery, createContinuationChallenge, listWakes, pair, recoverBindings, syncSupervisor, touch, transition });
})();
