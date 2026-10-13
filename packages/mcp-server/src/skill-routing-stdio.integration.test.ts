import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fixturePath = fileURLToPath(new URL('../tests/fixtures/skill-routing-stdio.mjs', import.meta.url));

function createClient(name: string): { client: Client; transport: StdioClientTransport } {
  const transport = new StdioClientTransport({ command: process.execPath, args: [fixturePath], stderr: 'pipe' });
  const client = new Client({ name, version: '0.1.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  return { client, transport };
}

describe('S3 real MCP stdio Skill routing', () => {
  it('routes and loads a bounded fixture through actual MCP stdio', async () => {
    const { client, transport } = createClient('nava-s3-client-a');
    try {
      await client.connect(transport);
      const matched = await client.callTool({ name: 'skill_match', arguments: { query: 'physical workspace isolation shared runtime and lease' } });
      expect(matched.isError).not.toBe(true);
      expect(matched).toMatchObject({ structuredContent: { skills: [expect.objectContaining({ id: 'fixture-skills/nava-workspace-isolation-auditor' })] } });
      const loaded = await client.callTool({ name: 'skill_load', arguments: { skillId: 'fixture-skills/nava-workspace-isolation-auditor' } });
      expect(loaded.isError).not.toBe(true);
      expect(loaded).toMatchObject({ structuredContent: { loaded: true, authorizationUnchanged: true, skill: { id: 'fixture-skills/nava-workspace-isolation-auditor' } } });
      const rejected = await client.callTool({ name: 'skill_load', arguments: { skillId: '../escape' } });
      expect(rejected.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);

  it('keeps two real OS-process MCP sessions independent', async () => {
    const a = createClient('nava-s3-client-first');
    const b = createClient('nava-s3-client-second');
    try {
      await Promise.all([a.client.connect(a.transport), b.client.connect(b.transport)]);
      const [first, second] = await Promise.all([
        a.client.callTool({ name: 'skill_match', arguments: { query: 'NTFS rename ABA restricted Rust native broker security' } }),
        b.client.callTool({ name: 'skill_match', arguments: { query: 'physical workspace isolation shared runtime writer lease' } }),
      ]);
      expect(first).toMatchObject({ structuredContent: { skills: [expect.objectContaining({ name: 'nava-native-security-verifier' })] } });
      expect(second).toMatchObject({ structuredContent: { skills: [expect.objectContaining({ name: 'nava-workspace-isolation-auditor' })] } });
      const missing = await b.client.callTool({ name: 'skill_match', arguments: { query: 'Forex strategy backtest' } });
      expect(missing).toMatchObject({ structuredContent: { skills: [] } });
    } finally {
      await Promise.all([a.client.close(), b.client.close()]);
    }
  }, 30_000);
});
