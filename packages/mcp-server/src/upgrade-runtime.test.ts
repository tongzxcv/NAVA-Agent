import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok } from '@lnwjud/domain';
import type { FileActor } from '@lnwjud/application';
import { ActivityTracker } from './activity-tracker.js';
import { UpgradeRuntimeService } from './upgrade-runtime.js';
import { UPGRADE_TOOL_CATALOG } from './upgrade-catalog.js';
import { ToolRegistry } from './tool-registry.js';
import type { McpApplicationServices } from './tools/tool-types.js';

const actor: FileActor = { clientId: 'test', clientName: 'test' };

describe('upgrade runtime', () => {
  it('has deterministic coverage for the roadmap tool catalog', () => {
    expect(UPGRADE_TOOL_CATALOG.length).toBeGreaterThan(100);
    expect(new Set(UPGRADE_TOOL_CATALOG.map((entry) => entry.name)).size).toBe(UPGRADE_TOOL_CATALOG.length);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'dev_context')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'handoff_context')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'context_economy_stats')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'wse_experience_capture')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'wse_strategy_promote')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'workspace_authority')).toBe(true);
    expect(UPGRADE_TOOL_CATALOG.some((entry) => entry.name === 'research_orchestrator')).toBe(true);
  });

  it('smoke-invokes every phase tool through the normal registry boundary', async () => {
    const registry = new ToolRegistry({}, actor);
    for (const entry of UPGRADE_TOOL_CATALOG) {
      const response = await registry.invoke(entry.name, {});
      expect(response).toBeDefined();
      expect(response.structuredContent).toBeDefined();
    }
  }, 20_000);

  it('queries persisted rotating MCP activity instead of losing timeout evidence with the in-memory tracker', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nava-live-logs-'));
    const activityLogPath = path.join(directory, 'mcp-activity.log');
    const older = [
      { callId: 'wait-old', toolName: 'shell', phase: 'started', resultCode: 'STARTED', durationMs: 0, timestamp: '2026-08-29T16:37:10.695Z' },
      { callId: 'wait-old', toolName: 'shell', phase: 'completed', resultCode: 'SUCCESS', durationMs: 60017, timestamp: '2026-08-29T16:38:10.712Z' },
    ];
    const current = [
      { callId: 'wait-unfinished', toolName: 'shell', phase: 'started', resultCode: 'STARTED', durationMs: 0, timestamp: '2026-08-29T18:00:00.000Z', targetSummary: 'shell:wait' },
      { callId: 'other', toolName: 'read_file', phase: 'completed', resultCode: 'SUCCESS', durationMs: 4, timestamp: '2026-08-29T18:01:00.000Z' },
    ];
    await writeFile(`${activityLogPath}.1`, `${older.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
    await writeFile(activityLogPath, `${current.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
    const runtime = new UpgradeRuntimeService({ activityLogPath } as McpApplicationServices, actor);

    await expect(runtime.execute('live_logs_query', { toolName: 'shell', limit: 10 })).resolves.toMatchObject({
      ok: true,
      value: {
        source: 'persistent-mcp',
        bounded: true,
        entries: [
          expect.objectContaining({ callId: 'wait-old', phase: 'started' }),
          expect.objectContaining({ callId: 'wait-old', phase: 'completed', durationMs: 60017 }),
          expect.objectContaining({ callId: 'wait-unfinished', phase: 'started', targetSummary: 'shell:wait' }),
        ],
      },
    });
    await expect(runtime.execute('live_logs_query', { callId: 'wait-unfinished', limit: 10 })).resolves.toMatchObject({
      ok: true,
      value: { entries: [expect.objectContaining({ callId: 'wait-unfinished', phase: 'started' })] },
    });
  });

  it('routes prompts and searches capabilities without an LLM', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const route = await runtime.execute('route_intent', { prompt: 'Live Logs MCP activity ไม่ขึ้น' });
    expect(route).toMatchObject({ ok: true, value: { route: 'debug', domain: 'desktop/mcp/logging' } });
    const search = await runtime.execute('tool_search', { query: 'postgres schema inspection' });
    expect(search.ok).toBe(true);
    if (search.ok) expect(search.value).toHaveProperty('matches');
  });

  it('orchestrates external research into a validation-gated lab plan', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const route = await runtime.execute('route_intent', { prompt: 'วิจัย external evidence แล้วเอา candidate ไปทดสอบใน lab' });
    expect(route).toMatchObject({ ok: true, value: { route: 'research', domain: 'external/research' } });

    const orchestrated = await runtime.execute('research_orchestrator', {
      workspaceId: 'ws-ratchet',
      objective: 'reduce drawdown without sacrificing expectancy',
      source: 'chatgpt-deep-research',
      evidence: [
        { ref: 'paper-1', finding: 'volatility-aware spacing can reduce concentration risk' },
        { ref: 'paper-2', finding: 'walk-forward validation is needed before promotion' },
      ],
      hypotheses: ['adaptive spacing', 'regime gate'],
      constraints: ['production must remain unchanged until validation passes'],
    });
    expect(orchestrated).toMatchObject({
      ok: true,
      value: {
        source: 'chatgpt-deep-research',
        workspaceId: 'ws-ratchet',
        gate: 'validation-required',
        productionTruth: false,
        automaticPromotion: false,
        evidenceCount: 2,
        candidateCount: 2,
        stages: ['external_research', 'evidence_review', 'candidate_design', 'offline_validation', 'native_validation', 'promotion_review'],
      },
    });

    const recipe = await runtime.execute('recipe_describe', { name: 'external-research-to-lab' });
    expect(recipe).toMatchObject({
      ok: true,
      value: {
        name: 'external-research-to-lab',
        route: 'research',
        steps: expect.arrayContaining(['research_orchestrator', 'workspace_context', 'parallel_delegate', 'execution_plan', 'session_checkpoint']),
      },
    });
  });

  it('publishes the NAVA operating recipes and keeps execution dry-run by default', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const catalog = await runtime.execute('recipe_catalog', {});
    expect(catalog).toMatchObject({ ok: true, value: { recipes: expect.arrayContaining([
      expect.objectContaining({ name: 'safe-git-commit-and-push' }),
      expect.objectContaining({ name: 'nava-release-build-install-verify', requiresConfirmation: true }),
      expect.objectContaining({ name: 'mt5-seven-terminal-backtest' }),
      expect.objectContaining({ name: 'obsidian-project-update' }),
      expect.objectContaining({ name: 'tunnel-reconnect-and-verify' }),
    ]) } });
    await expect(runtime.execute('recipe_run', { name: 'tunnel-reconnect-and-verify' })).resolves.toMatchObject({
      ok: true,
      value: { dryRun: true, sideEffectsStarted: false, operations: ['diagnostic_bundle_create', 'self_heal_plan', 'shell', 'mcp_health', 'diagnostic_bundle_create'] },
    });
  });

  it('ranks primitive and upgrade tools with deterministic reasons without granting authorization', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const search = await runtime.execute('tool_dynamic_filter', { query: 'run a Linux WSL developer command', limit: 20, reranker: 'local' });

    expect(search).toMatchObject({ ok: true, value: {
      selectedModel: 'deterministic',
      fallbackReason: 'local_model_not_configured',
      primitiveToolsRemainAvailable: true,
      authorizationUnchanged: true,
      rankedCandidates: expect.arrayContaining([
        expect.objectContaining({ name: 'wsl_exec', permission: 'EXECUTE', reasonCodes: expect.any(Array) }),
      ]),
    } });
    if (search.ok) expect(search.value.rankedCandidates[0]?.name).toBe('wsl_exec');
  });

  it('returns route reason codes and a measurable deterministic model selection', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const route = await runtime.execute('route_intent', { prompt: 'debug the WSL task timeout and inspect live logs' });

    expect(route).toMatchObject({ ok: true, value: {
      route: 'debug',
      selectedModel: 'deterministic',
      reasonCodes: expect.arrayContaining(['keyword:debug', 'keyword:wsl']),
      authorizationUnchanged: true,
    } });
  });

  it('keeps context reads unrestricted while asking for dangerous actions', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const read = await runtime.execute('permission_check', { action: 'filesystem.read' });
    const remove = await runtime.execute('permission_check', { action: 'filesystem.delete' });
    expect(read).toMatchObject({ ok: true, value: { decision: 'allow', contextAccess: 'unrestricted' } });
    expect(remove).toMatchObject({ ok: true, value: { decision: 'ask', contextAccess: 'unrestricted' } });
  });

  it('reports local MCP health without claiming remote tunnel or connector health', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    await expect(runtime.execute('mcp_health', {})).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'local-mcp-only',
        localMcp: { state: 'available' },
        controlPlane: { state: 'unknown' },
        connectorSchema: { state: 'unknown' },
        essentialTools: expect.arrayContaining(['session_resume', 'workspace_lease_call']),
        manifestVersion: expect.any(String),
      },
    });
  });

  it('matches checkpoints across stable project-key aliases and reports workspace authority', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nava-authority-'));
    const statePath = path.join(directory, 'runtime.json');
    const services = {
      runtimeStatePath: statePath,
      workspaceInfo: {
        async list(): Promise<ReturnType<typeof ok>> {
          return ok([{ id: 'ws-beel', displayName: 'BEELZEBUB EA', realRootPath: 'D:\\EA\\BEELZEBUB EA_Lab' }]);
        },
      },
      workspaceLeases: {
        async status(): Promise<ReturnType<typeof ok>> {
          return ok([{ workspaceId: 'ws-beel', leaseId: 'lease-1', owner: 'chat-a', acquiredAt: '2026-08-28T00:00:00.000Z', heartbeatAt: '2026-08-28T00:01:00.000Z', expiresAt: '2026-08-28T00:15:00.000Z' }]);
        },
      },
    } as McpApplicationServices;
    const first = new UpgradeRuntimeService(services, actor);
    await first.execute('session_checkpoint', { projectKey: 'BEELZEBUB EA', workspaceId: 'ws-beel', summary: 'milestone' });

    const resumed = await new UpgradeRuntimeService(services, actor).execute('session_resume', { projectKey: 'beelzebub_ea', workspaceId: 'ws-beel' });
    expect(resumed).toMatchObject({ ok: true, value: { recovered: true, matchedProjectKey: 'beelzebub-ea', checkpoint: { summary: 'milestone' } } });
    await expect(new UpgradeRuntimeService(services, actor).execute('workspace_authority', { workspaceId: 'ws-beel' })).resolves.toMatchObject({
      ok: true,
      value: { activeWriterCount: 1, activeWriters: [{ workspaceId: 'ws-beel', owner: 'chat-a' }], workspaces: [{ id: 'ws-beel', displayName: 'BEELZEBUB EA' }] },
    });
  });

  it('shares context economy telemetry between workspace context and the stats tool', async () => {
    const registry = new ToolRegistry({
      workspaceInfo: { async list(): Promise<ReturnType<typeof ok>> { return ok([{ id: 'workspace-1' }]); } },
      search: {
        async searchText(): Promise<ReturnType<typeof ok>> { return ok({ matches: [{ path: 'src/app.ts', line: 1, text: 'login' }], truncated: false }); },
        async searchFiles(): Promise<ReturnType<typeof ok>> { return ok({ paths: ['src/app.ts'], truncated: false }); },
      },
      file: { async readFile(): Promise<ReturnType<typeof ok>> { return ok({ path: 'src/app.ts', content: 'export function login() {}\n', startLine: 1, endLine: 1, encoding: 'utf8' as const, byteLength: 28 }); } },
      git: { async status(): Promise<ReturnType<typeof ok>> { return ok({ entries: [] }); } },
    }, actor);

    const context = await registry.invoke('workspace_context', { query: 'login', workspaceId: 'workspace-1' });
    expect(context.isError).not.toBe(true);
    const stats = await registry.invoke('context_economy_stats', {});
    expect(stats.isError).not.toBe(true);
    expect(stats).toMatchObject({ structuredContent: { filesDiscovered: 1, filesDelivered: 1 } });
  });

  it('captures real completed activity as bounded persistent WSE experience and evaluates it', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nava-wse-'));
    const statePath = path.join(directory, 'runtime.json');
    const activity = new ActivityTracker();
    const success = await activity.begin('read_file', { workspaceId: 'ws-1', path: 'src/app.ts' });
    await activity.end(success, 'SUCCESS', 10);
    const failure = await activity.begin('shell', { workspaceId: 'ws-1', command: 'test' });
    await activity.end(failure, 'PROCESS_FAILED', 30, 'failed');

    const runtime = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor, undefined, activity);
    await expect(runtime.execute('telemetry_dashboard', {})).resolves.toMatchObject({
      ok: true,
      value: { mcpCalls: 2, errors: 1, averageLatencyMs: 20, p95LatencyMs: 30 },
    });
    await expect(runtime.execute('wse_experience_capture', {})).resolves.toMatchObject({
      ok: true,
      value: { captured: 2, total: 2, rawPayloadsRetained: false },
    });

    const resumed = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);
    await expect(resumed.execute('wse_evaluate', {})).resolves.toMatchObject({
      ok: true,
      value: { sampleSize: 2, successRate: 0.5, averageLatencyMs: 20, p95LatencyMs: 30 },
    });
  });

  it('scores strategies offline and changes ranking only after explicit human promotion', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nava-wse-strategy-'));
    const statePath = path.join(directory, 'runtime.json');
    const activity = new ActivityTracker();
    for (let index = 0; index < 20; index += 1) {
      const callId = await activity.begin(index < 16 ? 'read_file' : 'shell', { workspaceId: 'ws-1', path: `src/${index}.ts` });
      await activity.end(callId, index < 18 ? 'SUCCESS' : 'PROCESS_FAILED', index < 16 ? 10 : 100);
    }
    const runtime = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor, undefined, activity);
    await runtime.execute('wse_experience_capture', { limit: 50 });

    await expect(runtime.execute('wse_strategy_score', {})).resolves.toMatchObject({
      ok: true,
      value: { sampleSize: 20, candidates: expect.arrayContaining([
        expect.objectContaining({ strategy: 'baseline', score: expect.any(Number), reasonCodes: expect.any(Array) }),
        expect.objectContaining({ strategy: 'reliability-first', score: expect.any(Number) }),
      ]) },
    });
    await expect(runtime.execute('wse_strategy_promote', { strategy: 'reliability-first' })).resolves.toMatchObject({
      ok: false, error: { code: 'PERMISSION_REQUIRED' },
    });
    await expect(runtime.execute('wse_strategy_promote', { strategy: 'reliability-first', userConfirmed: true })).resolves.toMatchObject({
      ok: true, value: { promoted: true, activeStrategy: 'reliability-first', automaticPromotion: false },
    });
    const ranked = await runtime.execute('tool_dynamic_filter', { query: 'read file', limit: 20 });
    expect(ranked).toMatchObject({ ok: true, value: { activeStrategy: 'reliability-first', authorizationUnchanged: true } });
    if (ranked.ok) {
      const readFile = ranked.value.rankedCandidates.find((candidate) => candidate.name === 'read_file');
      expect(readFile?.reasonCodes).toContain('strategy:reliability-first');
    }

    const resumed = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);
    await expect(resumed.execute('wse_strategy_status', {})).resolves.toMatchObject({
      ok: true, value: { activeStrategy: 'reliability-first', automaticPromotion: false },
    });
    await expect(resumed.execute('wse_strategy_promote', { action: 'rollback', userConfirmed: true })).resolves.toMatchObject({
      ok: true, value: { rolledBack: true, activeStrategy: 'baseline' },
    });
  });

  it('records real WSE benchmark snapshots and reports measured regression', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nava-wse-benchmark-'));
    const statePath = path.join(directory, 'runtime.json');
    const activity = new ActivityTracker();
    const runtime = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor, undefined, activity);
    for (let index = 0; index < 10; index += 1) {
      const callId = await activity.begin('read_file', { workspaceId: 'ws-1', path: `${index}.ts` });
      await activity.end(callId, 'SUCCESS', 10);
    }
    await runtime.execute('wse_experience_capture', { limit: 50 });
    await runtime.execute('benchmark_run', { dryRun: false });
    for (let index = 0; index < 10; index += 1) {
      const callId = await activity.begin('shell', { workspaceId: 'ws-1', command: `fail-${index}` });
      await activity.end(callId, 'PROCESS_FAILED', 100);
    }
    await runtime.execute('wse_experience_capture', { limit: 50 });
    await runtime.execute('benchmark_run', { dryRun: false });

    await expect(runtime.execute('regression_report', {})).resolves.toMatchObject({
      ok: true,
      value: { status: 'regression', regressions: expect.arrayContaining(['success_rate_decreased', 'p95_latency_increased']), snapshotCount: 2 },
    });
  });

  it('persists redacted session/task state outside the repository', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lnwjud-runtime-'));
    const statePath = path.join(directory, 'runtime.json');
    const first = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);
    await first.execute('session_checkpoint', { summary: 'inspect logs', token: 'must-not-be-retained' });
    const second = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);
    const resumed = await second.execute('session_context', {});
    expect(resumed).toMatchObject({ ok: true, value: { checkpoints: [{ summary: 'inspect logs' }] } });
    const task = await second.execute('task_create', { instruction: 'run tests' });
    expect(task).toMatchObject({ ok: true, value: { inputDigest: expect.any(String) } });
    });
  });

  it('normalizes the machine-readable end-of-round contract conservatively', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    await expect(runtime.execute('session_checkpoint', {
      projectKey: 'ratchet',
      summary: 'Round complete',
      status: 'DONE',
      nextAction: 'Continue the verified next stage',
      safeToContinue: true,
      needsUser: false,
      durableTaskIds: ['task-1'],
    })).resolves.toMatchObject({
      ok: true,
      value: { status: 'DONE', safeToContinue: true, needsUser: false, nextAction: 'Continue the verified next stage', durableTaskIds: ['task-1'] },
    });
    await expect(runtime.execute('session_checkpoint', {
      projectKey: 'ratchet', summary: 'Blocked round', status: 'DONE', nextAction: 'Retry',
      safeToContinue: true, needsUser: true, blockers: ['User decision required'],
    })).resolves.toMatchObject({ ok: true, value: { status: 'DONE', safeToContinue: false, needsUser: true } });
  });

  it('resumes the latest bounded checkpoint for one project without retaining secrets', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nava-continuity-'));
    const statePath = path.join(directory, 'runtime.json');
    const activity = new ActivityTracker();
    const first = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor, undefined, activity);

    await first.execute('session_checkpoint', {
      projectKey: 'beelzebub-ea',
      workspaceId: 'workspace-beelzebub',
      objective: 'Repair the EA entry gate',
      phase: 'diagnosis',
      completed: ['Reproduced BLOCK_TIME'],
      files: ['Experts/BEELZEBUB.mq5'],
      verification: ['compile pending'],
      blockers: [],
      boundaries: ['Keep Live unchanged'],
      nextAction: 'Inspect the time filter',
      token: 'must-not-be-retained',
    });
    await first.execute('session_checkpoint', {
      projectKey: 'beelzebub-ea',
      workspaceId: 'workspace-beelzebub',
      objective: 'Repair the EA entry gate',
      phase: 'verification',
      completed: ['Reproduced BLOCK_TIME', 'Patched the time filter'],
      files: ['Experts/BEELZEBUB.mq5'],
      verification: ['MetaEditor compile passed'],
      blockers: ['Native backtest pending'],
      boundaries: ['Keep Live unchanged'],
      nextAction: 'Run the isolated native backtest',
    });
    await first.execute('session_checkpoint', {
      projectKey: 'autobots',
      workspaceId: 'workspace-autobots',
      summary: 'Unrelated project checkpoint',
    });

    const callId = await activity.begin('project_test', { workspaceId: 'workspace-beelzebub', path: 'Experts/BEELZEBUB.mq5' });
    await activity.end(callId, 'SUCCESS', 1234);

    const resumed = await new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor, undefined, activity)
      .execute('session_resume', { projectKey: 'beelzebub-ea' });

    expect(resumed).toMatchObject({
      ok: true,
      value: {
        projectKey: 'beelzebub-ea',
        checkpoint: {
          workspaceId: 'workspace-beelzebub',
          phase: 'verification',
          nextAction: 'Run the isolated native backtest',
          verification: ['MetaEditor compile passed'],
          blockers: ['Native backtest pending'],
        },
        checkpointCount: 2,
        recentActivity: [expect.objectContaining({ toolName: 'project_test', resultCode: 'SUCCESS' })],
      },
    });
    expect(JSON.stringify(resumed)).not.toContain('must-not-be-retained');
    expect(JSON.stringify(resumed)).not.toContain('Unrelated project checkpoint');
  });

  it('preserves checkpoints written concurrently by separate chat runtimes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'nava-continuity-concurrent-'));
    const statePath = path.join(directory, 'runtime.json');
    const chatA = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);
    const chatB = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);

    await Promise.all([
      chatA.execute('session_checkpoint', { projectKey: 'beelzebub-ea', summary: 'BEELZEBUB milestone' }),
      chatB.execute('session_checkpoint', { projectKey: 'autobots', summary: 'Autobots milestone' }),
    ]);

    const recovered = new UpgradeRuntimeService({ runtimeStatePath: statePath }, actor);
    await expect(recovered.execute('session_resume', { projectKey: 'beelzebub-ea' }))
      .resolves.toMatchObject({ ok: true, value: { recovered: true, checkpoint: { summary: 'BEELZEBUB milestone' } } });
    await expect(recovered.execute('session_resume', { projectKey: 'autobots' }))
      .resolves.toMatchObject({ ok: true, value: { recovered: true, checkpoint: { summary: 'Autobots milestone' } } });
  });

  it('keeps Git worktree spawning path-scoped and dry-run first', async () => {
    const calls: unknown[] = [];
    const runtime = new UpgradeRuntimeService({
      git: {
        async run(_actor, request): Promise<ReturnType<typeof ok>> {
          calls.push(request);
          return ok({ exitCode: 0, stdout: 'worktree ready', stderr: '' });
        },
      },
    }, actor);

    await expect(runtime.execute('git_worktree_spawn', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', ref: 'main' })).resolves.toMatchObject({ ok: true, value: { dryRun: true, sideEffectsStarted: false } });
    await expect(runtime.execute('git_worktree_spawn', { workspaceId: 'ws-1', worktreePath: '..\\outside', ref: 'main', dryRun: false, userConfirmed: true })).resolves.toMatchObject({ ok: false, error: { code: 'PATH_OUTSIDE_WORKSPACE' } });
    await expect(runtime.execute('git_worktree_spawn', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', ref: 'main', dryRun: false })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    await expect(runtime.execute('git_worktree_spawn', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', ref: 'main', dryRun: false, userConfirmed: true })).resolves.toMatchObject({ ok: true, value: { status: 'completed', sideEffectsStarted: true } });
    expect(calls).toEqual([{ workspaceId: 'ws-1', args: ['worktree', 'add', '--detach', '.worktrees/agent-1', 'main'] }]);

    await expect(runtime.execute('git_worktree_remove', { workspaceId: 'ws-1', worktreePath: '.worktrees/unknown' })).resolves.toMatchObject({ ok: false, error: { code: 'PROCESS_NOT_FOUND' } });
    await expect(runtime.execute('git_worktree_remove', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1' })).resolves.toMatchObject({ ok: true, value: { dryRun: true } });
    await expect(runtime.execute('git_worktree_remove', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', dryRun: false })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    await expect(runtime.execute('git_worktree_remove', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', dryRun: false, userConfirmed: true })).resolves.toMatchObject({ ok: true, value: { status: 'completed' } });
    expect(calls.at(-1)).toMatchObject({ args: ['worktree', 'remove', '.worktrees/agent-1'] });
    await expect(runtime.execute('git_worktree_remove', { workspaceId: 'ws-1', worktreePath: '.worktrees/agent-1', dryRun: false, userConfirmed: true })).resolves.toMatchObject({ ok: false, error: { code: 'PROCESS_NOT_FOUND' } });
  });

  it('routes PowerPoint and Outlook upgrade tools into the Office capability', async () => {
    const calls: Record<string, unknown>[] = [];
    const runtime = new UpgradeRuntimeService({
      capabilities: {
        async execute(tool: string, request: Record<string, unknown>): Promise<ReturnType<typeof ok>> {
          expect(tool).toBe('office');
          calls.push(request);
          return ok({ app: request.app, action: request.action, ok: true });
        },
      },
    }, actor);

    await expect(runtime.execute('office_ppt', { action: 'read', file_path: 'C:\\work\\deck.pptx' })).resolves.toMatchObject({
      ok: true, value: { executed: true, action: 'read' },
    });
    await expect(runtime.execute('office_ppt', { action: 'save_as', file_path: 'C:\\work\\deck.pptx', target_path: 'C:\\work\\copy.pptx' })).resolves.toMatchObject({
      ok: true, value: { dryRun: true, executed: false },
    });
    await expect(runtime.execute('office_outlook', { action: 'list_messages', folder: '\\Mailbox\\Inbox', max_messages: 250 })).resolves.toMatchObject({
      ok: true, value: { available: true, action: 'list_messages' },
    });
    expect(calls).toEqual([
      { app: 'powerpoint', action: 'read', file_path: 'C:\\work\\deck.pptx' },
      { app: 'outlook', action: 'list_messages', folder: '\\Mailbox\\Inbox', max_messages: 100 },
    ]);
  });

  it('keeps the 50-prompt routing golden set in the top-20 with a local p95 budget', async () => {
    const templates = [
      ['run a Linux WSL developer command', 'wsl_exec'],
      ['capture a numbered native UI observation', 'vision_annotated_capture'],
      ['read Thai and English text with offline OCR', 'vision'],
      ['detonate an artifact offline in Windows Sandbox', 'sandbox_exec'],
      ['watch an allowlisted ETW event provider', 'event_watch'],
      ['show TypeScript compiler diagnostics from LSP', 'lsp_diagnostics'],
      ['rename a symbol with a cross-file LSP edit plan', 'lsp_rename'],
      ['attach to an owned DAP debug adapter', 'debug_attach'],
      ['step the debugger and inspect locals', 'debug_step'],
      ['spawn an isolated Git worktree', 'git_worktree_spawn'],
      ['inspect the local database schema', 'db_inspect'],
      ['run a bounded local SQL database query', 'db_query'],
      ['create a PowerPoint slide through Office', 'office_ppt'],
      ['draft an Outlook message through Office', 'office_outlook'],
      ['extract tables from a PDF', 'pdf_extract_tables'],
      ['merge DOCX documents after approval', 'docx_merge'],
      ['plan a safe reversible self-healing fix', 'self_heal_plan'],
      ['import a compatible local agent skill', 'skills_import'],
      ['plan an owned parallel agent swarm', 'agent_swarm_run'],
      ['discover connected MCP servers in the hub', 'mcp_hub'],
      ['run a bounded shell process', 'shell'],
      ['act on a revalidated marked UI control', 'ui_target_action'],
      ['translate a registered Windows path to WSL', 'wsl_fs'],
      ['inspect context economy telemetry', 'context_economy_stats'],
      ['discover project tests', 'discover_tests'],
    ] as const;
    const golden = Array.from({ length: 50 }, (_, index) => ({ query: `${templates[index % templates.length]![0]} ${index}`, target: templates[index % templates.length]![1] }));
    const runtime = new UpgradeRuntimeService({}, actor);
    const latencies: number[] = [];
    for (const prompt of golden) {
      const started = performance.now();
      const result = await runtime.execute('tool_dynamic_filter', { query: prompt.query, limit: 20 });
      latencies.push(performance.now() - started);
      expect(result).toMatchObject({ ok: true, value: { rankedCandidates: expect.any(Array), primitiveToolsRemainAvailable: true } });
      if (result.ok) expect(result.value.rankedCandidates.map((candidate) => candidate.name)).toContain(prompt.target);
    }
    const sorted = [...latencies].sort((left, right) => left - right);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
    expect(p95).toBeLessThan(50);
  });

describe('self-healing (Wave 8)', () => {
  it('plans safe reversible fixes from live evidence', async () => {
    const staleStart = new Date(Date.now() - 48 * 60 * 60 * 1_000).toISOString();
    const runtime = new UpgradeRuntimeService({
      workspaceIndex: {
        async status(): Promise<ReturnType<typeof ok>> { return ok({ indexed: false, snapshot: null }); },
        async indexWorkspace(): Promise<ReturnType<typeof ok>> { return ok({ entries: [] }); },
      },
      capabilities: {
        async execute(_tool: string, request: { operation?: string }): Promise<ReturnType<typeof ok>> {
          if (request.operation === 'list') {
            return ok({ tasks: [
              { task_id: 'stale-1', state: 'running', durable: true, started_at: staleStart },
              { task_id: 'fresh-1', state: 'running', durable: true, started_at: new Date().toISOString() },
              { task_id: 'done-1', state: 'completed', durable: true, started_at: staleStart },
            ] });
          }
          expect(request.operation).toBe('cancel');
          return ok({ task_id: request.task_id, state: 'cancelled' });
        },
      },
    }, actor);

    const plan = await runtime.execute('self_heal_plan', { workspaceId: 'ws-1' });
    expect(plan).toMatchObject({ ok: true, value: {
      tool: 'self_heal_plan', applied: false, planId: expect.any(String), mutationRequired: true, automaticDestructiveRetry: false,
      evidence: { index: { indexed: false }, durableTasks: { staleOlderThan24h: 1 } },
      safeReversibleFixes: [
        expect.objectContaining({ id: 'reindex-workspace', kind: 'reindex_workspace', requiresConfirmation: false }),
        expect.objectContaining({ id: 'cancel-stale-task-stale-1', kind: 'cancel_stale_task', requiresConfirmation: true }),
      ],
    } });

    await expect(runtime.execute('self_heal_apply', { workspaceId: 'ws-1' })).resolves.toMatchObject({ ok: true, value: { dryRun: true, applied: [] } });
    await expect(runtime.execute('self_heal_apply', { workspaceId: 'ws-1', dryRun: false })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    await expect(runtime.execute('self_heal_apply', { workspaceId: 'ws-1', dryRun: false, userConfirmed: true })).resolves.toMatchObject({ ok: false, error: { code: 'PERMISSION_REQUIRED' } });
    if (!plan.ok) throw new Error('plan should be available');
    const planId = String((plan.value as { planId: string }).planId);
    const applied = await runtime.execute('self_heal_apply', { workspaceId: 'ws-1', planId, dryRun: false, userConfirmed: true, fixIds: ['cancel-stale-task-stale-1'] });
    expect(applied).toMatchObject({ ok: true, value: {
      dryRun: false, automaticDestructiveRetry: false,
      applied: [expect.objectContaining({ id: 'cancel-stale-task-stale-1', ok: true })],
    } });
  });

  it('reports an empty plan when everything is healthy', async () => {
    const runtime = new UpgradeRuntimeService({}, actor);
    const plan = await runtime.execute('self_heal_plan', {});
    expect(plan).toMatchObject({ ok: true, value: { safeReversibleFixes: [], mutationRequired: false } });
  });
});
