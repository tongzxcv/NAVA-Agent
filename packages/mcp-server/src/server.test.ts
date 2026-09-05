import type { CallToolResult } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { enforceResponseBudget, MCP_RESPONSE_BUDGET_BYTES, NAVA_SERVER_INSTRUCTIONS } from './server.js';

describe('MCP response budget', () => {
  it.each([
    ['read_file', 'read_file_page'],
    ['shell', 'max_output_bytes'],
    ['accessibility', 'observe_summary'],
  ])('returns bounded recovery guidance for oversized %s results', (toolName, expectedHint) => {
    const response = enforceResponseBudget(toolName, oversizedResult());

    expect(response).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'RESPONSE_TOO_LARGE', recoverable: true } },
    });
    expect(JSON.stringify(response)).toContain(expectedHint);
    expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBeLessThan(MCP_RESPONSE_BUDGET_BYTES);
  });

  it('instructs browser-bound LEADs to use epoch-preserving supervisor linkage', () => {
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('authenticated active browser binding');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('session_checkpoint');
    expect(NAVA_SERVER_INSTRUCTIONS).toContain('never command_room_join, rebind, takeover, or rotate connectionEpoch');
  });

  it('leaves bounded results unchanged', () => {
    const response: CallToolResult = { content: [{ type: 'text', text: 'ok' }] };
    expect(enforceResponseBudget('read_file', response)).toBe(response);
  });
});

function oversizedResult(): CallToolResult {
  return { content: [{ type: 'text', text: 'x'.repeat(MCP_RESPONSE_BUDGET_BYTES) }] };
}
