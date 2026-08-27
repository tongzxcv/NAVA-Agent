import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { err, ok } from '@lnwjud/domain';
import { ContextEconomyRuntime } from '../context-economy.js';
import { IncrementalVerifier } from '../incremental-verifier.js';
import { UpgradeRuntimeService } from '../upgrade-runtime.js';
import { sessionTools } from './session-tools.js';
import type { McpToolContext, McpToolDefinition } from './tool-types.js';

const actor = { clientId: 'test-client', clientName: 'test' };
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function findTool(context: McpToolContext, verifier: IncrementalVerifier, name: string): McpToolDefinition {
  const tool = sessionTools(context, verifier).find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`Missing tool ${name}`);
  return tool;
}

describe('session tools', () => {
  it('creates a same-chat handoff from the real tracker content, git changes, and durable task IDs', async () => {
    const context = {
      actor,
      contextEconomy: new ContextEconomyRuntime(),
      services: {
        file: {
          async readFile() {
            return ok({
              path: 'docs/PHASE_PROGRESS.md',
              content: '# Tracker\n## Next chat startup probe\nRUN-SMOKE-42\n## Current phase\nPhase budget guard',
              startLine: 1,
              endLine: 5,
            });
          },
        },
        git: {
          async status() {
            return ok({ entries: [{ path: 'packages/mcp-server/src/run-budget.ts', index: ' ', worktree: 'M' }] });
          },
          async diff(_actor: unknown, _workspaceId: string, request: { staged?: boolean }) {
            return ok({ patch: request.staged === true ? '' : '+RUN-BUDGET-DIFF', truncated: false });
          },
        },
        capabilities: {
          async execute(tool: string, request: { operation?: string }) {
            expect(tool).toBe('shell');
            expect(request.operation).toBe('list');
            return ok({
              tasks: [
                { task_id: 'durable-123', state: 'running', durable: true, started_at: '2026-08-22T01:00:00.000Z' },
                { task_id: 'ephemeral-1', state: 'running', durable: false },
              ],
            });
          },
        },
      },
    } as unknown as McpToolContext;

    const response = await findTool(context, new IncrementalVerifier(), 'session_handoff').execute(
      { workspaceId: 'workspace-1' },
      new AbortController().signal,
    );

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const value = response.value as Record<string, unknown>;
    expect(value.tracker_excerpt).toContain('RUN-SMOKE-42');
    expect(value.changed_files).toContain('packages/mcp-server/src/run-budget.ts');
    expect(value.background_tasks).toEqual([expect.objectContaining({ task_id: 'durable-123', state: 'running' })]);
    expect(value.prompt).toEqual(expect.stringContaining('Continue this run in the same chat'));
    expect(value.prompt).toEqual(expect.stringContaining('durable-123'));
    expect(value.prompt).toEqual(expect.stringContaining('Refresh connector'));
  });

  it('falls back to a root phase tracker when the default docs tracker is absent', async () => {
    const reads: string[] = [];
    const context = {
      actor,
      contextEconomy: new ContextEconomyRuntime(),
      services: {
        file: {
          async readFile(_actor: unknown, _workspaceId: string, request: { path: string }) {
            reads.push(request.path);
            return request.path === 'PHASE_PROGRESS.md'
              ? ok({ path: request.path, content: '# RATCHET tracker', startLine: 1, endLine: 1 })
              : err({ code: 'FILE_NOT_FOUND' as const, message: 'File was not found', recoverable: false });
          },
        },
        git: {
          async status() { return ok({ entries: [] }); },
          async diff() { return ok({ patch: '', truncated: false }); },
        },
      },
    } as unknown as McpToolContext;

    const response = await findTool(context, new IncrementalVerifier(), 'session_handoff').execute(
      { workspaceId: 'workspace-ratchet' },
      new AbortController().signal,
    );

    expect(response).toMatchObject({
      ok: true,
      value: {
        tracker_path: 'PHASE_PROGRESS.md',
        tracker_excerpt: '# RATCHET tracker',
      },
    });
    expect(reads).toEqual(['docs/PHASE_PROGRESS.md', 'PHASE_PROGRESS.md']);
  });

  it('uses the latest rolling checkpoint for the same workspace when no phase tracker exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nava-handoff-checkpoint-'));
    temporaryRoots.push(root);
    const services = {
      runtimeStatePath: path.join(root, 'runtime.json'),
      file: {
        async readFile(): Promise<ReturnType<typeof err>> {
          return err({ code: 'FILE_NOT_FOUND' as const, message: 'File was not found', recoverable: false });
        },
      },
      git: {
        async status(): Promise<ReturnType<typeof ok>> { return ok({ entries: [] }); },
        async diff(): Promise<ReturnType<typeof ok>> { return ok({ patch: '', truncated: false }); },
      },
    };
    const runtime = new UpgradeRuntimeService(services, actor);
    await runtime.execute('session_checkpoint', {
      projectKey: 'autobots',
      workspaceId: 'workspace-autobots',
      summary: 'Unrelated checkpoint',
    });
    await runtime.execute('session_checkpoint', {
      projectKey: 'beelzebub',
      workspaceId: 'workspace-beelzebub',
      phase: 'R94 verification',
      nextAction: 'Run the next targeted matrix',
      summary: 'BEELZEBUB R94 checkpoint',
    });
    const context = { actor, contextEconomy: new ContextEconomyRuntime(), services } as unknown as McpToolContext;

    const response = await findTool(context, new IncrementalVerifier(), 'session_handoff').execute(
      { workspaceId: 'workspace-beelzebub' },
      new AbortController().signal,
    );

    expect(response).toMatchObject({
      ok: true,
      value: {
        tracker_path: null,
        tracker_source: 'checkpoint',
        tracker_excerpt: expect.stringContaining('BEELZEBUB R94 checkpoint'),
        warnings: [expect.stringContaining('phase tracker was not found')],
      },
    });
    expect(JSON.stringify(response)).not.toContain('Unrelated checkpoint');
  });

  it('still creates a Git and task handoff with a warning when no tracker or checkpoint exists', async () => {
    const context = {
      actor,
      contextEconomy: new ContextEconomyRuntime(),
      services: {
        file: {
          async readFile() {
            return err({ code: 'FILE_NOT_FOUND' as const, message: 'File was not found', recoverable: false });
          },
        },
        git: {
          async status() { return ok({ entries: [{ path: 'Experts/BEELZEBUB.mq5', index: ' ', worktree: 'M' }] }); },
          async diff() { return ok({ patch: '', truncated: false }); },
        },
      },
    } as unknown as McpToolContext;

    const response = await findTool(context, new IncrementalVerifier(), 'session_handoff').execute(
      { workspaceId: 'workspace-without-checkpoint' },
      new AbortController().signal,
    );

    expect(response).toMatchObject({
      ok: true,
      value: {
        tracker_path: null,
        tracker_source: 'none',
        tracker_excerpt: '',
        changed_files: ['Experts/BEELZEBUB.mq5'],
        warnings: [expect.stringContaining('No phase tracker or rolling checkpoint was found')],
      },
    });
  });

  it('returns verify_incremental cache hit for unchanged diff and miss after the diff changes', async () => {
    let patch = '+first-diff';
    let starts = 0;
    const context = {
      actor,
      contextEconomy: new ContextEconomyRuntime(),
      services: {
        git: {
          async status() {
            return ok({ entries: [{ path: 'src/app.ts', index: ' ', worktree: 'M' }] });
          },
          async diff(_actor: unknown, _workspaceId: string, request: { staged?: boolean }) {
            return ok({ patch: request.staged === true ? '' : patch, truncated: false });
          },
        },
        process: {
          async startProjectCommand() {
            starts += 1;
            return ok({
              processId: `typecheck-${starts}`,
              executable: 'pnpm',
              args: ['typecheck'],
              cwd: 'E:/repo',
              state: 'exited' as const,
              startedAt: '2026-08-22T01:00:00.000Z',
              finishedAt: '2026-08-22T01:00:01.000Z',
              exitCode: 0,
            });
          },
          async status() {
            throw new Error('status should not be needed for an already-terminal start result');
          },
          async logs(_actor: unknown, _workspaceId: string, processId: string) {
            return ok({
              entries: [{ sequence: 1, stream: 'stdout' as const, text: `${processId}: typecheck passed` }],
              truncated: false,
              nextSequence: 2,
            });
          },
        },
      },
    } as unknown as McpToolContext;
    const verifier = new IncrementalVerifier();
    const tool = findTool(context, verifier, 'verify_incremental');
    const signal = new AbortController().signal;

    const first = await tool.execute({ workspaceId: 'workspace-1' }, signal);
    const second = await tool.execute({ workspaceId: 'workspace-1' }, signal);
    patch = '+second-diff';
    const third = await tool.execute({ workspaceId: 'workspace-1' }, signal);

    expect(first).toMatchObject({ ok: true, value: { cache: 'miss', passed: true } });
    expect(second).toMatchObject({ ok: true, value: { cache: 'hit', passed: true } });
    expect(third).toMatchObject({ ok: true, value: { cache: 'miss', passed: true } });
    expect(starts).toBe(2);
  });
});
