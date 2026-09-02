/* global crypto, TextDecoder, TextEncoder, atob, btoa */

(() => {
  'use strict';

  const ENVELOPE_VERSION = 1;
  const KDF_NAME = 'PBKDF2-SHA-256';
  const CIPHER_NAME = 'AES-256-GCM';
  const ITERATIONS = 210_000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
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

  function isEnvelope(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && value.version === ENVELOPE_VERSION
      && value.kdf === KDF_NAME
      && value.cipher === CIPHER_NAME
      && value.iterations === ITERATIONS
      && typeof value.salt === 'string'
      && typeof value.iv === 'string'
      && typeof value.ciphertext === 'string',
    );
  }

  async function encryptState(state, passphrase) {
    if (!validPassphrase(passphrase)) throw cryptoError('INVALID_PASSPHRASE');
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(passphrase, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(state));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
    return Object.freeze({
      version: ENVELOPE_VERSION,
      kdf: KDF_NAME,
      cipher: CIPHER_NAME,
      iterations: ITERATIONS,
      salt: encode(salt),
      iv: encode(iv),
      ciphertext: encode(ciphertext),
    });
  }

  async function decryptState(envelope, passphrase) {
    if (!isEnvelope(envelope) || !validPassphrase(passphrase)) throw cryptoError('LOCKED');
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

  globalThis.NavaCrypto = Object.freeze({
    decryptState,
    encryptState,
    isEnvelope,
    validPassphrase,
  });
})();
