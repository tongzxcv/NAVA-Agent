import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadOrCreateWindowsProtectedKey, protectWithWindowsDpapi, unprotectLegacyWindowsSecureString, unprotectWithWindowsDpapi } from './windows-dpapi.js';

describe.runIf(process.platform === 'win32')('Windows DPAPI helpers', () => {
  it('round-trips UTF-8 text through direct Windows DPAPI', () => {
    const plaintext = 'lnwjud-dpapi-ทดสอบ-' + Date.now();
    const protectedValue = protectWithWindowsDpapi(plaintext);
    expect(protectedValue).not.toContain(plaintext);
    expect(unprotectWithWindowsDpapi(protectedValue)).toBe(plaintext);
  }, 15_000);

  it('persists a v2 protected key and reuses the same key', async () => {
    const filePath = path.join(os.tmpdir(), 'lnwjud-dpapi-' + process.pid + '-' + Date.now() + '.key');
    try {
      const first = loadOrCreateWindowsProtectedKey(filePath, 32);
      const stored = await readFile(filePath, 'utf8');
      expect(stored).toMatch(/^dpapi:v2:/);
      expect(loadOrCreateWindowsProtectedKey(filePath, 32)).toEqual(first);
    } finally {
      await rm(filePath, { force: true });
    }
  }, 15_000);

  it('decrypts the legacy ConvertFrom-SecureString DPAPI format without PowerShell.Security', () => {
    const plaintext = 'sk-runtime-legacy-' + Date.now();
    const legacyCipher = createLegacySecureStringCipher(plaintext);
    expect(unprotectLegacyWindowsSecureString(legacyCipher)).toBe(plaintext);
  }, 15_000);
});

function createLegacySecureStringCipher(plainText: string): string {
  const script = [
    '$ErrorActionPreference = "Stop"',
    "[Reflection.Assembly]::Load('System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a') | Out-Null",
    '$plain = [Console]::In.ReadToEnd()',
    '$bytes = [Text.Encoding]::Unicode.GetBytes($plain)',
    '$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '-join ($protected | ForEach-Object { $_.ToString("x2") })',
  ].join('; ');
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { input: plainText, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || 'Could not create legacy DPAPI fixture');
  return result.stdout.trim();
}
