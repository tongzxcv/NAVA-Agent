/* global crypto, TextDecoder, TextEncoder, atob, btoa */

(() => {
  'use strict';

  const LEGACY_ENVELOPE_VERSION = 1;
  const ENVELOPE_VERSION = 2;
  const KDF_NAME = 'PBKDF2-SHA-256';
  const CIPHER_NAME = 'AES-256-GCM';
  const ITERATIONS = 210_000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const DATA_KEY_BYTES = 32;
  const MAX_CIPHERTEXT_BYTES = 65_536;

  function cryptoError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function validPassphrase(value) {
    return typeof value === 'string' && value.trim().length >= 12 && value.length <= 256;
  }

  function encode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function decode(value, expectedLength = null) {
    if (typeof value !== 'string' || value.length > 100_000) throw cryptoError('LOCKED');
    let binary;
    try {
      binary = atob(value);
    } catch {
      throw cryptoError('LOCKED');
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (expectedLength !== null && bytes.length !== expectedLength) throw cryptoError('LOCKED');
    return bytes;
  }

  async function deriveKey(passphrase, salt) {
    if (!validPassphrase(passphrase)) throw cryptoError('INVALID_PASSPHRASE');
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async function importDataKey(raw) {
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  function isLegacyEnvelope(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && value.version === LEGACY_ENVELOPE_VERSION
      && value.kdf === KDF_NAME
      && value.cipher === CIPHER_NAME
      && value.iterations === ITERATIONS
      && typeof value.salt === 'string'
      && typeof value.iv === 'string'
      && typeof value.ciphertext === 'string',
    );
  }

  function isV2Envelope(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && value.version === ENVELOPE_VERSION
      && value.kdf === KDF_NAME
      && value.cipher === CIPHER_NAME
      && value.iterations === ITERATIONS
      && typeof value.salt === 'string'
      && typeof value.wrapIv === 'string'
      && typeof value.wrappedKey === 'string'
      && typeof value.stateIv === 'string'
      && typeof value.ciphertext === 'string',
    );
  }

  function isEnvelope(value) {
    return isLegacyEnvelope(value) || isV2Envelope(value);
  }

  async function encryptStateWithDataKey(state, dataKeyBytes) {
    const stateIv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await importDataKey(dataKeyBytes);
    const plaintext = new TextEncoder().encode(JSON.stringify(state));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: stateIv }, key, plaintext));
    return { stateIv: encode(stateIv), ciphertext: encode(ciphertext) };
  }

  async function decryptStateWithDataKey(envelope, dataKeyBytes) {
    const stateIv = decode(envelope.stateIv, IV_BYTES);
    const ciphertext = decode(envelope.ciphertext);
    if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) throw cryptoError('LOCKED');
    const key = await importDataKey(dataKeyBytes);
    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: stateIv }, key, ciphertext);
      const state = JSON.parse(new TextDecoder().decode(plaintext));
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw cryptoError('LOCKED');
      return state;
    } catch {
      throw cryptoError('LOCKED');
    }
  }

  async function createUnlockedEnvelope(state, passphrase) {
    if (!validPassphrase(passphrase)) throw cryptoError('INVALID_PASSPHRASE');
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const wrapIv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const dataKeyBytes = crypto.getRandomValues(new Uint8Array(DATA_KEY_BYTES));
    const wrappingKey = await deriveKey(passphrase, salt);
    const wrappedKey = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, wrappingKey, dataKeyBytes));
    const encrypted = await encryptStateWithDataKey(state, dataKeyBytes);
    return {
      envelope: Object.freeze({
        version: ENVELOPE_VERSION,
        kdf: KDF_NAME,
        cipher: CIPHER_NAME,
        iterations: ITERATIONS,
        salt: encode(salt),
        wrapIv: encode(wrapIv),
        wrappedKey: encode(wrappedKey),
        stateIv: encrypted.stateIv,
        ciphertext: encrypted.ciphertext,
      }),
      sessionKey: encode(dataKeyBytes),
    };
  }

  async function encryptState(state, passphrase) {
    return (await createUnlockedEnvelope(state, passphrase)).envelope;
  }

  async function decryptLegacyState(envelope, passphrase) {
    const salt = decode(envelope.salt, SALT_BYTES);
    const iv = decode(envelope.iv, IV_BYTES);
    const ciphertext = decode(envelope.ciphertext);
    if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) throw cryptoError('LOCKED');
    try {
      const key = await deriveKey(passphrase, salt);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      const state = JSON.parse(new TextDecoder().decode(plaintext));
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw cryptoError('LOCKED');
      return state;
    } catch {
      throw cryptoError('LOCKED');
    }
  }

  async function unlockState(envelope, passphrase) {
    if (!isEnvelope(envelope) || !validPassphrase(passphrase)) throw cryptoError('LOCKED');
    if (isLegacyEnvelope(envelope)) {
      const state = await decryptLegacyState(envelope, passphrase);
      const upgraded = await createUnlockedEnvelope(state, passphrase);
      return { state, envelope: upgraded.envelope, sessionKey: upgraded.sessionKey, upgraded: true };
    }
    const salt = decode(envelope.salt, SALT_BYTES);
    const wrapIv = decode(envelope.wrapIv, IV_BYTES);
    const wrappedKey = decode(envelope.wrappedKey);
    let dataKeyBytes;
    try {
      const wrappingKey = await deriveKey(passphrase, salt);
      dataKeyBytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: wrapIv }, wrappingKey, wrappedKey));
    } catch {
      throw cryptoError('LOCKED');
    }
    if (dataKeyBytes.length !== DATA_KEY_BYTES) throw cryptoError('LOCKED');
    const state = await decryptStateWithDataKey(envelope, dataKeyBytes);
    return { state, envelope, sessionKey: encode(dataKeyBytes), upgraded: false };
  }

  async function decryptState(envelope, passphrase) {
    return (await unlockState(envelope, passphrase)).state;
  }

  async function encryptStateWithSessionKey(envelope, state, sessionKey) {
    if (!isV2Envelope(envelope)) throw cryptoError('LOCKED');
    const dataKeyBytes = decode(sessionKey, DATA_KEY_BYTES);
    await decryptStateWithDataKey(envelope, dataKeyBytes);
    const encrypted = await encryptStateWithDataKey(state, dataKeyBytes);
    return Object.freeze({
      ...envelope,
      stateIv: encrypted.stateIv,
      ciphertext: encrypted.ciphertext,
    });
  }

  globalThis.NavaCrypto = Object.freeze({
    decryptState,
    encryptState,
    encryptStateWithSessionKey,
    isEnvelope,
    unlockState,
    validPassphrase,
    createUnlockedEnvelope,
  });
})();
