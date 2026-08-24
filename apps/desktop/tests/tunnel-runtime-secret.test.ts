import { describe, expect, it } from 'vitest';
import { decryptRuntimeSecret, encryptRuntimeSecret } from '../src/main/tunnel-controller.js';

describe.runIf(process.platform === 'win32')('runtime secret protection', () => {
  it('stores new Runtime API keys with direct DPAPI v2 protection', async () => {
    const plaintext = 'sk-runtime-v2-' + Date.now();
    const encrypted = await encryptRuntimeSecret(plaintext);
    expect(encrypted).toMatch(/^dpapi:v2:/);
    expect(encrypted).not.toContain(plaintext);
    await expect(decryptRuntimeSecret(encrypted)).resolves.toBe(plaintext);
  }, 15_000);
});
