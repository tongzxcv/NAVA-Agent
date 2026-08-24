import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok } from '@lnwjud/domain';
import { ToolRegistry } from '../tool-registry.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('diagnostic_bundle_create', () => {
  it('returns bounded read-only evidence and redacts activity secrets', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-diagnostic-'));
    roots.push(root);
    const activityLogPath = path.join(root, 'activity.ndjson');
    await writeFile(activityLogPath, `${JSON.stringify({ toolName: 'shell', Authorization: 'Bearer secret-value', API_KEY: 'sk-secret' })}\n`, 'utf8');
    const registry = new ToolRegistry({
      activityLogPath,
      capabilities: { async execute(): Promise<ReturnType<typeof ok>> { return ok({ healthy: true }); } },
    }, { clientId: 'test', clientName: 'test' });

    const response = await registry.invoke('diagnostic_bundle_create', { includeEventLog: false, tailEntries: 10 });
    const serialized = JSON.stringify(response);
    expect(response).toMatchObject({ structuredContent: { readOnly: true, bounded: true, checks: { health: { healthy: true } } } });
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('sk-secret');
    expect(serialized).toContain('[REDACTED]');
  });
});
