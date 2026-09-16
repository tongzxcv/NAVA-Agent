import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createMcpServer, type McpServerOptions } from './server.js';
import { IncrementalVerifier } from './incremental-verifier.js';
import { RunBudgetGuard } from './run-budget.js';

export interface McpStdioOptions extends McpServerOptions {
  readonly onError?: (error: Error) => void;
}

// Keep this comfortably below tunnel-client's command response deadline (~120s).
// A timed-out tool is cancelled and returns PROCESS_TIMEOUT, freeing serialized stdio.
export const MCP_STDIO_TOOL_RESPONSE_BUDGET_MS = 90_000;

export function isBenignStdioPipeError(error: Error): boolean {
  return /EPIPE|ECONNRESET|broken pipe/i.test(error.message);
}

function writeStdioDiagnostic(error: Error): void {
  if (isBenignStdioPipeError(error)) {
    process.stderr.write(`lnwjud MCP stdio: peer closed (${error.message})\n`);
    return;
  }
  process.stderr.write(`lnwjud MCP stdio error: ${error.message}\n`);
}

export function startMcpStdio(options: McpStdioOptions): StdioServerHandle {
  const runBudgetGuard = options.runBudgetGuard ?? new RunBudgetGuard();
  const incrementalVerifier = options.incrementalVerifier ?? new IncrementalVerifier();
  return serveStdio(
    () => createMcpServer({
      ...options,
      runBudgetGuard,
      incrementalVerifier,
      maxToolDurationMs: options.maxToolDurationMs ?? MCP_STDIO_TOOL_RESPONSE_BUDGET_MS,
    }),
    { legacy: 'reject', onerror: options.onError ?? writeStdioDiagnostic },
  );
}
