/* global console, process */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (manifest.manifest_version !== 3) throw new Error('Manifest V3 is required.');
if (manifest.background?.service_worker !== 'src/background.js') throw new Error('Unexpected background worker.');
if (manifest.action?.default_popup !== 'src/popup.html') throw new Error('Unexpected popup entry.');
if (JSON.stringify(manifest.permissions) !== JSON.stringify(['storage', 'alarms', 'scripting'])) throw new Error('Extension permissions changed unexpectedly.');
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://chatgpt.com/*', 'http://127.0.0.1/*'])) {
  throw new Error('Extension host permissions widened or reordered.');
}
const contentScript = manifest.content_scripts?.[0];
if (!contentScript || JSON.stringify(contentScript.matches) !== JSON.stringify(['https://chatgpt.com/*'])) {
  throw new Error('Content script origin is not exact.');
}

const requiredFiles = [
  'src/shared.js',
  'src/crypto.js',
  'src/bridge.js',
  'src/background.js',
  'src/content.js',
  'src/popup.html',
  'src/popup.css',
  'src/popup.js',
];
for (const relative of requiredFiles) {
  const path = resolve(root, relative);
  await readFile(path);
  if (relative.endsWith('.js')) execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
}

const forbiddenPermissions = new Set([
  'clipboardRead',
  'cookies',
  'debugger',
  'downloads',
  'history',
  'nativeMessaging',
  'tabs',
  'webRequest',
  'webRequestBlocking',
]);
const declaredPermissions = [...(manifest.permissions ?? []), ...(manifest.optional_permissions ?? [])];
if (declaredPermissions.some((permission) => forbiddenPermissions.has(permission))) {
  throw new Error('Forbidden browser permission declared.');
}
console.log('NAVA Command Room extension typecheck passed.');
