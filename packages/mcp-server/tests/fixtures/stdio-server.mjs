/* global process */
import { startMcpStdio } from '../../dist/stdio.js';

process.stderr.write('lnwjud-stdio-test-diagnostic\n');
startMcpStdio({
  services: {
    runtimeStatePath: process.env.NAVA_TEST_RUNTIME_STATE_PATH,
    search: {
      async searchText(_actor, _workspaceId, input, signal) {
        if (input.query === 'fast') return { ok: true, value: { matches: [], truncated: false } };
        return new Promise((resolve) => {
          signal?.addEventListener('abort', () => resolve({ ok: true, value: { matches: [], truncated: true } }), { once: true });
        });
      },
      async searchFiles() {
        return { ok: true, value: { paths: [], truncated: false } };
      },
    },
    file: {
      async readFile(_actor, _workspaceId, input) {
        if (input.path !== 'large-response.txt') return { ok: false, error: { code: 'FILE_NOT_FOUND', message: 'File was not found', recoverable: false } };
        return {
          ok: true,
          value: {
            path: input.path,
            content: 'x'.repeat(14_786_001),
            startLine: 1,
            endLine: 1,
            encoding: 'utf8',
            mimeType: 'text/plain',
            byteLength: 14_786_001,
          },
        };
      },
    },
  },
  actor: { clientId: 'stdio-test', clientName: 'stdio-test' },
  ...(process.env.NAVA_TEST_MAX_TOOL_DURATION_MS === undefined
    ? {}
    : { maxToolDurationMs: Number(process.env.NAVA_TEST_MAX_TOOL_DURATION_MS) }),
});
