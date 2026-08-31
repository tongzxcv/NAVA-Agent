/* global console */

import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await import('./typecheck.mjs');
await rm(dist, { recursive: true, force: true });
await mkdir(dirname(dist), { recursive: true });
await cp(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));
await cp(resolve(root, 'src'), resolve(dist, 'src'), { recursive: true });
console.log(`Built NAVA Command Room extension at ${dist}`);
