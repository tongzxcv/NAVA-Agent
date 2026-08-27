import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const fixturePath = fileURLToPath(new URL('../tests/fixtures/stdio-server.mjs', import.meta.url));

describe('MCP stdio transport', () => {
  it('serves independent 2026-07-28 requests with protocol-only stdout', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fixturePath],
      stderr: 'pipe',
    });
    let diagnostics = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString('utf8');
    });
    const client = new Client(
      { name: 'lnwjud-stdio-test-client', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );

    try {
      await client.connect(transport);
      expect(client.getInstructions()).toContain('session_checkpoint');
      expect(client.getInstructions()).toContain('session_resume');
      expect(client.getInstructions()).toContain('before a long operation');
      expect(client.getInstructions()).toContain('workspace_lease_call');
      expect(client.getInstructions()).toContain('Refresh connector');
      const first = await client.listTools();
      const second = await client.listTools();

      expect(first.tools.map((tool) => tool.name)).toHaveLength(221);
      expect(first.tools.some((tool) => tool.name.startsWith('codex_'))).toBe(false);
      expect(second.tools.map((tool) => tool.name)).toEqual(first.tools.map((tool) => tool.name));
      expect(diagnostics).toContain('lnwjud-stdio-test-diagnostic');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('keeps the same stdio session alive after rejecting an oversized tool response', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fixturePath],
      stderr: 'pipe',
    });
    const client = new Client(
      { name: 'lnwjud-stdio-budget-test', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );

    try {
      await client.connect(transport);
      const oversized = await client.callTool({ name: 'read_file', arguments: { path: 'large-response.txt' } });
      expect(oversized).toMatchObject({
        isError: true,
        structuredContent: { error: { code: 'RESPONSE_TOO_LARGE', recoverable: true } },
      });
      expect(Buffer.byteLength(JSON.stringify(oversized), 'utf8')).toBeLessThan(8 * 1024 * 1024);

      const next = await client.listTools();
      expect(next.tools.some((tool) => tool.name === 'read_file_page')).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);

  it('recovers one project checkpoint through a fresh MCP client and server process', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nava-stdio-continuity-'));
    const statePath = path.join(directory, 'runtime.json');
    const environment = { ...process.env, NAVA_TEST_RUNTIME_STATE_PATH: statePath } as Record<string, string>;

    const firstTransport = new StdioClientTransport({ command: process.execPath, args: [fixturePath], env: environment, stderr: 'pipe' });
    const firstClient = new Client(
      { name: 'nava-continuity-writer', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    try {
      await firstClient.connect(firstTransport);
      const saved = await firstClient.callTool({
        name: 'session_checkpoint',
        arguments: {
          projectKey: 'beelzebub-ea',
          workspaceId: 'workspace-beelzebub',
          phase: 'verification',
          verification: ['targeted test passed'],
          nextAction: 'Run native validation',
        },
      });
      expect(saved.isError).not.toBe(true);
      expect(saved).toMatchObject({ structuredContent: { projectKey: 'beelzebub-ea' } });
    } finally {
      await firstClient.close();
    }

    const secondTransport = new StdioClientTransport({ command: process.execPath, args: [fixturePath], env: environment, stderr: 'pipe' });
    const secondClient = new Client(
      { name: 'nava-continuity-reader', version: '0.1.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    try {
      await secondClient.connect(secondTransport);
      const resumed = await secondClient.callTool({ name: 'session_resume', arguments: { projectKey: 'beelzebub-ea' } });
      expect(resumed.isError).not.toBe(true);
      expect(resumed).toMatchObject({
        structuredContent: {
          recovered: true,
          checkpoint: {
            workspaceId: 'workspace-beelzebub',
            verification: ['targeted test passed'],
            nextAction: 'Run native validation',
          },
        },
      });
    } finally {
      await secondClient.close();
    }
  }, 30_000);
});
