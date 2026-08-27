import { z } from 'zod';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import { IncrementalVerifier } from '../incremental-verifier.js';
import { UpgradeRuntimeService } from '../upgrade-runtime.js';
import { defineTool, missingService, type McpToolContext, type McpToolDefinition } from './tool-types.js';

const DEFAULT_TRACKER_PATH = 'docs/PHASE_PROGRESS.md';
const ROOT_TRACKER_PATH = 'PHASE_PROGRESS.md';
const DEFAULT_MAX_DIFF_BYTES = 16_000;
const MAX_TRACKER_EXCERPT_CHARS = 4_000;
const MAX_BACKGROUND_TASKS = 20;

const sessionHandoffSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  trackerPath: z.string().trim().min(1).max(4096).optional(),
  maxDiffBytes: z.number().int().min(1_000).max(100_000).optional(),
}).strict();

const verifyIncrementalSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
}).strict();

export function sessionTools(context: McpToolContext, verifier: IncrementalVerifier): McpToolDefinition[] {
  return [
    defineTool({
      name: 'session_handoff',
      description: 'Create a concise same-chat continuation message from the phase tracker, current git status/diff, and durable background task IDs. When trackerPath is omitted, discover docs/PHASE_PROGRESS.md then PHASE_PROGRESS.md and fall back to the latest rolling checkpoint for the same workspace. Use near the end of a run so the next run can resume without re-reading the whole project. If a tool schema looks stale, Refresh connector first; open a new chat only if refresh does not fix it.',
      permission: 'READ',
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: sessionHandoffSchema,
      handler: async (input, signal) => createSessionHandoff(context, input, signal),
    }),
    defineTool({
      name: 'verify_incremental',
      description: 'Run the detected project typecheck only when the current git status/diff fingerprint changed. Returns cache=hit when unchanged and cache=miss after a new verification. Prefer this during iterative edits; use project_test/project_lint/project_build only when that specific verification is needed. For full suites or packaging expected to exceed ~5 minutes, launch a durable shell background task and record its task_id in the tracker.',
      permission: 'EXECUTE',
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: verifyIncrementalSchema,
      handler: async (input, signal) => verifier.verify(context, input.workspaceId, signal),
    }),
  ];
}

async function createSessionHandoff(
  context: McpToolContext,
  input: z.infer<typeof sessionHandoffSchema>,
  signal: AbortSignal,
): Promise<Result<Record<string, unknown>>> {
  if (context.services.file === undefined || context.services.git === undefined) return missingService();
  let trackerPath: string | null = input.trackerPath ?? DEFAULT_TRACKER_PATH;
  let trackerSource: 'tracker' | 'checkpoint' | 'none' = 'tracker';
  const warnings: string[] = [];
  const maxDiffBytes = input.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES;

  let tracker = await context.services.file.readFile(context.actor, input.workspaceId, { path: trackerPath });
  if (input.trackerPath === undefined && !tracker.ok && tracker.error.code === 'FILE_NOT_FOUND') {
    trackerPath = ROOT_TRACKER_PATH;
    tracker = await context.services.file.readFile(context.actor, input.workspaceId, { path: trackerPath });
  }
  let trackerExcerpt: string;
  if (!tracker.ok) {
    if (input.trackerPath !== undefined || tracker.error.code !== 'FILE_NOT_FOUND') return err(tracker.error);
    const checkpoint = await latestCheckpointForWorkspace(context, input.workspaceId);
    trackerPath = null;
    if (checkpoint === undefined) {
      trackerSource = 'none';
      trackerExcerpt = '';
      warnings.push('No phase tracker or rolling checkpoint was found; handoff used current Git and durable task evidence only.');
    } else {
      trackerSource = 'checkpoint';
      trackerExcerpt = compactCheckpoint(checkpoint);
      warnings.push('The phase tracker was not found; handoff used the latest rolling checkpoint for this workspace.');
    }
  } else {
    trackerExcerpt = compactTracker(tracker.value.content);
  }
  if (signal.aborted) return cancelledHandoff();

  const status = await context.services.git.status(context.actor, input.workspaceId, signal);
  if (!status.ok) return err(status.error);
  if (signal.aborted) return cancelledHandoff();
  const unstaged = await context.services.git.diff(context.actor, input.workspaceId, { maxBytes: maxDiffBytes }, signal);
  if (!unstaged.ok) return err(unstaged.error);
  if (signal.aborted) return cancelledHandoff();
  const staged = await context.services.git.diff(context.actor, input.workspaceId, { staged: true, maxBytes: maxDiffBytes }, signal);
  if (!staged.ok) return err(staged.error);

  const backgroundTasks = await readBackgroundTasks(context, signal);
  const changedFiles = [...new Set(status.value.entries.map((entry) => entry.path))].sort();
  const diffSummary = compactDiff(unstaged.value.patch, staged.value.patch, maxDiffBytes);
  const prompt = buildHandoffPrompt({
    trackerPath,
    trackerSource,
    trackerExcerpt,
    changedFiles,
    diffSummary,
    backgroundTasks,
  });

  return ok({
    prompt,
    tracker_path: trackerPath,
    tracker_source: trackerSource,
    tracker_excerpt: trackerExcerpt,
    warnings,
    changed_files: changedFiles,
    git_status: status.value.entries,
    git_diff: {
      unstaged: unstaged.value.patch,
      staged: staged.value.patch,
      truncated: unstaged.value.truncated || staged.value.truncated,
    },
    background_tasks: backgroundTasks,
  });
}

async function readBackgroundTasks(context: McpToolContext, signal: AbortSignal): Promise<readonly Record<string, unknown>[]> {
  if (context.services.capabilities === undefined || signal.aborted) return [];
  const listed = await context.services.capabilities.execute('shell', { operation: 'list' }, signal);
  if (!listed.ok || typeof listed.value !== 'object' || listed.value === null || Array.isArray(listed.value)) return [];
  const tasks = (listed.value as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter((task): task is Record<string, unknown> => typeof task === 'object' && task !== null && !Array.isArray(task))
    .filter((task) => task.durable === true && typeof task.task_id === 'string')
    .slice(0, MAX_BACKGROUND_TASKS)
    .map((task) => ({
      task_id: task.task_id,
      state: task.state,
      ...(task.started_at === undefined ? {} : { started_at: task.started_at }),
      ...(task.finished_at === undefined ? {} : { finished_at: task.finished_at }),
      ...(task.exit_code === undefined ? {} : { exit_code: task.exit_code }),
    }));
}

function buildHandoffPrompt(input: {
  readonly trackerPath: string | null;
  readonly trackerSource: 'tracker' | 'checkpoint' | 'none';
  readonly trackerExcerpt: string;
  readonly changedFiles: readonly string[];
  readonly diffSummary: string;
  readonly backgroundTasks: readonly Record<string, unknown>[];
}): string {
  const tasks = input.backgroundTasks.length === 0
    ? '- none recorded by the durable shell task store'
    : input.backgroundTasks.map((task) => `- ${String(task.task_id)} (${String(task.state ?? 'unknown')})`).join('\n');
  const changed = input.changedFiles.length === 0 ? '(clean)' : input.changedFiles.join(', ');
  const opening = input.trackerSource === 'tracker'
    ? `Continue this run in the same chat from ${input.trackerPath}.`
    : input.trackerSource === 'checkpoint'
      ? 'Continue this run in the same chat from the latest NAVA rolling checkpoint for this workspace.'
      : 'Continue this run in the same chat from current workspace evidence.';
  const firstStep = input.trackerSource === 'tracker'
    ? '1. Run the "Next chat startup probe" from the tracker.'
    : input.trackerSource === 'checkpoint'
      ? '1. Verify the rolling checkpoint against current Git, workspace, durable task, and Obsidian evidence.'
      : '1. Inspect current Git, workspace, durable task, and Obsidian evidence before mutation.';
  const evidenceLabel = input.trackerSource === 'tracker'
    ? 'Tracker excerpt:'
    : input.trackerSource === 'checkpoint'
      ? 'Rolling checkpoint:'
      : 'Continuation evidence:';
  return [
    opening,
    '',
    evidenceLabel,
    input.trackerExcerpt || '(no tracker or rolling checkpoint)',
    '',
    `Current Git changes: ${changed}`,
    input.diffSummary.length === 0 ? 'Git diff summary: (no diff)' : `Git diff summary:\n${input.diffSummary}`,
    '',
    'Durable background tasks:',
    tasks,
    '',
    'Start by:',
    firstStep,
    '2. Recover durable jobs by task_id with shell status/logs/result; do not tight-poll.',
    '3. Inspect git status/diff only as needed for the current phase.',
    '4. Work one phase only and use search_text/read_file_page instead of re-reading large files.',
    '5. Use verify_incremental for repeated typecheck; use targeted project_* verification as needed.',
    '6. Before ending, update the tracker. Jobs expected to exceed ~5 minutes should run as durable shell background tasks and their task_id must be written to the tracker.',
    '',
    'Do not redo completed phases unless verification proves a regression. If tool schema looks stale, Refresh connector first; open a new chat only if Refresh connector does not fix it.',
  ].join('\n');
}

async function latestCheckpointForWorkspace(
  context: McpToolContext,
  workspaceId: string,
): Promise<Record<string, unknown> | undefined> {
  const runtime = new UpgradeRuntimeService(context.services, context.actor, context.contextEconomy, context.activity);
  const state = await runtime.execute('session_context', {});
  if (!state.ok || !isRecord(state.value) || !Array.isArray(state.value.checkpoints)) return undefined;
  return [...state.value.checkpoints].reverse().find((checkpoint): checkpoint is Record<string, unknown> => (
    isRecord(checkpoint) && checkpoint.workspaceId === workspaceId
  ));
}

function compactCheckpoint(checkpoint: Readonly<Record<string, unknown>>): string {
  const lines = [
    ['Summary', checkpoint.summary],
    ['Objective', checkpoint.objective],
    ['Phase', checkpoint.phase],
    ['Next action', checkpoint.nextAction],
  ].flatMap(([label, value]) => typeof value === 'string' && value.length > 0 ? [`${label}: ${value}`] : []);
  for (const [label, key] of [['Completed', 'completed'], ['Verification', 'verification'], ['Blockers', 'blockers'], ['Boundaries', 'boundaries']] as const) {
    const values = checkpoint[key];
    if (Array.isArray(values) && values.length > 0) lines.push(`${label}: ${values.map(String).join('; ')}`);
  }
  return compactTracker(lines.join('\n'));
}

function compactTracker(content: string): string {
  const normalized = content.trim();
  if (normalized.length <= MAX_TRACKER_EXCERPT_CHARS) return normalized;
  const half = Math.floor((MAX_TRACKER_EXCERPT_CHARS - 64) / 2);
  return `${normalized.slice(0, half)}\n... tracker excerpt truncated ...\n${normalized.slice(-half)}`;
}

function compactDiff(unstaged: string, staged: string, maxBytes: number): string {
  const combined = [
    unstaged.trim().length === 0 ? '' : `UNSTAGED\n${unstaged.trim()}`,
    staged.trim().length === 0 ? '' : `STAGED\n${staged.trim()}`,
  ].filter((value) => value.length > 0).join('\n\n');
  const maxChars = Math.min(maxBytes, 4_000);
  return combined.length <= maxChars ? combined : `${combined.slice(0, maxChars)}\n... diff truncated for handoff ...`;
}

function cancelledHandoff(): Result<never> {
  return err(appError('PROCESS_TIMEOUT', 'Session handoff was cancelled', true));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
