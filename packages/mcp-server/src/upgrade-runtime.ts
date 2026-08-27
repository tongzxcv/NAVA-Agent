import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appError, err, ok, type Result } from '@lnwjud/domain';
import type { FileActor } from '@lnwjud/application';
import { capabilityDescriptors, EventLogCapabilityBackend, type CapabilityDescriptor } from '@lnwjud/capabilities';
import type { McpApplicationServices } from './tools/tool-types.js';
import { ContextEngine } from './context-engine.js';
import { ContextEconomyRuntime } from './context-economy.js';
import { DatabaseRuntimeService } from './database-runtime.js';
import { DocumentRuntimeService } from './document-runtime.js';
import { LspRuntimeService } from './lsp-runtime.js';
import { SandboxRuntimeService } from './sandbox-runtime.js';
import { UPGRADE_TOOL_CATALOG, type UpgradeToolCatalogEntry } from './upgrade-catalog.js';
import { ActivityTracker, type ActivitySinkEvent } from './activity-tracker.js';

interface RuntimeTask {
  readonly id: string;
  readonly kind: 'task' | 'delegate';
  readonly createdAt: string;
  readonly inputDigest: string;
  state: 'queued' | 'running' | 'completed' | 'cancelled';
  result?: unknown;
}

interface SessionCheckpoint {
  readonly id: string;
  readonly createdAt: string;
  readonly summary: string;
  readonly inputDigest: string;
  readonly projectKey?: string;
  readonly workspaceId?: string;
  readonly objective?: string;
  readonly phase?: string;
  readonly completed?: readonly string[];
  readonly files?: readonly string[];
  readonly verification?: readonly string[];
  readonly blockers?: readonly string[];
  readonly boundaries?: readonly string[];
  readonly nextAction?: string;
}

interface CacheCounters {
  hits: number;
  misses: number;
  bytesSaved: number;
}

interface SearchCatalogEntry extends UpgradeToolCatalogEntry {
  readonly primitive?: boolean;
  readonly auditTarget?: string;
}

interface RankedToolCandidate {
  readonly name: string;
  readonly score: number;
  readonly reasonCodes: readonly string[];
  readonly essential: boolean;
  readonly permission: UpgradeToolCatalogEntry['permission'];
  readonly permissionMetadata: {
    readonly permission: UpgradeToolCatalogEntry['permission'];
    readonly authorization: 'not_granted_by_ranking';
    readonly destructiveHint: boolean;
  };
  readonly source: 'primitive' | 'upgrade';
  readonly tags: readonly string[];
  readonly phase: number;
}

interface WorktreeLedgerEntry {
  readonly workspaceId: string;
  readonly worktreePath: string;
  readonly ref: string;
  readonly owner: string;
  readonly createdAt: string;
}

interface SelfHealFix {
  readonly id: string;
  readonly kind: 'reindex_workspace' | 'cancel_stale_task';
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly description: string;
  readonly reversible: boolean;
  readonly requiresConfirmation: boolean;
}

interface PersistedRuntimeState {
  readonly tasks?: readonly RuntimeTask[];
  readonly checkpoints?: readonly SessionCheckpoint[];
  readonly plugins?: readonly { readonly name: string; readonly enabled: boolean }[];
  readonly session?: readonly [string, unknown][];
  readonly worktrees?: readonly WorktreeLedgerEntry[];
  readonly experiences?: readonly WseExperience[];
  readonly activeStrategy?: WseStrategy;
  readonly promotionHistory?: readonly WsePromotion[];
  readonly benchmarks?: readonly WseBenchmarkSnapshot[];
}

interface PersistedContinuityState {
  readonly checkpoints?: readonly SessionCheckpoint[];
  readonly lastCheckpointId?: string;
  readonly lastProjectKey?: string;
}

interface WseExperience {
  readonly id: string;
  readonly callId: string;
  readonly toolName: string;
  readonly resultCode: string;
  readonly durationMs: number;
  readonly timestamp: string;
  readonly outcome: 'success' | 'failure';
  readonly workspaceId?: string;
  readonly targetDigest?: string;
}

const MAX_WSE_EXPERIENCES = 512;
const MAX_WSE_PROMOTIONS = 64;
const MIN_WSE_PROMOTION_SAMPLES = 10;
const MAX_SESSION_CHECKPOINTS = 128;
const MAX_CHECKPOINT_LIST_ITEMS = 20;
const MAX_CHECKPOINT_TEXT_CHARS = 1_000;
const MAX_AUTHORITY_WORKSPACES = 64;
const MAX_AUTHORITY_LEASES = 64;
const continuityWriteLocks = new Map<string, Promise<void>>();
type WseStrategy = 'baseline' | 'reliability-first' | 'latency-first';

const ESSENTIAL_TOOL_NAMES = [
  'workspace_list',
  'workspace_tree',
  'read_file',
  'search_text',
  'session_resume',
  'session_checkpoint',
  'workspace_lease_status',
  'workspace_lease_acquire',
  'workspace_lease_renew',
  'workspace_lease_release',
  'workspace_lease_call',
  'health',
  'mcp_health',
  'capabilities',
  'tool_categories',
  'live_logs_query',
  'live_logs_status',
] as const;

interface WsePromotion {
  readonly id: string;
  readonly action: 'promote' | 'rollback';
  readonly previousStrategy: WseStrategy;
  readonly activeStrategy: WseStrategy;
  readonly timestamp: string;
  readonly evidenceDigest: string;
}

interface WseBenchmarkSnapshot {
  readonly id: string;
  readonly timestamp: string;
  readonly sampleSize: number;
  readonly successRate: number;
  readonly averageLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly evidenceDigest: string;
}

interface WseEvaluation {
  readonly sampleSize: number;
  readonly successRate: number;
  readonly averageLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly failuresByCode: Readonly<Record<string, number>>;
  readonly deterministic: true;
  readonly rawPayloadsRetained: false;
}

const PRIMITIVE_SEARCH_ENTRIES: readonly SearchCatalogEntry[] = [
  primitiveEntry('workspace_list', 'List registered workspaces.', 'READ', ['workspace', 'read']),
  primitiveEntry('workspace_tree', 'Read a bounded registered workspace tree.', 'READ', ['workspace', 'tree', 'read']),
  primitiveEntry('read_file', 'Read one guarded workspace file.', 'READ', ['workspace', 'file', 'read']),
  primitiveEntry('read_files', 'Read multiple guarded workspace files.', 'READ', ['workspace', 'file', 'read']),
  primitiveEntry('search_files', 'Search guarded workspace file paths.', 'READ', ['workspace', 'search', 'read']),
  primitiveEntry('search_text', 'Search guarded workspace text.', 'READ', ['workspace', 'search', 'read']),
  primitiveEntry('git', 'Run a guarded Git operation.', 'DANGEROUS', ['git', 'execute']),
  primitiveEntry('write_file', 'Write a guarded workspace file.', 'WRITE', ['workspace', 'file', 'write']),
  primitiveEntry('apply_patch', 'Apply a guarded workspace patch.', 'WRITE', ['workspace', 'file', 'write']),
  primitiveEntry('shell', 'Run a local task through the bounded shell runner.', 'EXECUTE', ['shell', 'process', 'execute']),
  primitiveEntry('vision', 'Capture local screen content or use the OCR boundary.', 'READ', ['vision', 'display', 'read']),
  primitiveEntry('vision_annotated_capture', 'Capture an expiring Set-of-Marks observation.', 'READ', ['vision', 'ui', 'read']),
  primitiveEntry('ui_target_action', 'Act on a revalidated visual mark.', 'DANGEROUS', ['vision', 'ui', 'execute']),
  primitiveEntry('tool_batch', 'Invoke registered tools with bounded dependency groups.', 'DANGEROUS', ['workflow', 'execute']),
  primitiveEntry('workspace_lease_acquire', 'Acquire one expiring writer lease for a workspace.', 'WRITE', ['workspace', 'lease', 'coordination']),
  primitiveEntry('workspace_lease_status', 'List active workspace writer leases and their owners.', 'READ', ['workspace', 'lease', 'coordination']),
  primitiveEntry('workspace_lease_renew', 'Renew an owned workspace writer lease.', 'WRITE', ['workspace', 'lease', 'coordination']),
  primitiveEntry('workspace_lease_release', 'Release an owned workspace writer lease.', 'WRITE', ['workspace', 'lease', 'coordination']),
  primitiveEntry('workspace_lease_call', 'Run one non-read tool under a matching workspace writer lease.', 'DANGEROUS', ['workspace', 'lease', 'coordination']),
];

const CAPABILITY_SEARCH_ENTRIES: readonly SearchCatalogEntry[] = capabilityDescriptors.map((descriptor) => capabilitySearchEntry(descriptor));
const SEARCH_CATALOG: readonly SearchCatalogEntry[] = dedupeSearchEntries([
  ...PRIMITIVE_SEARCH_ENTRIES,
  ...CAPABILITY_SEARCH_ENTRIES,
  ...UPGRADE_TOOL_CATALOG,
]);
const TOOL_MANIFEST_VERSION = digest({
  primitive: PRIMITIVE_SEARCH_ENTRIES.map((entry) => `${entry.name}:${entry.permission}`).sort(),
  upgrade: UPGRADE_TOOL_CATALOG.map((entry) => `${entry.name}:${entry.permission}:${entry.phase}`).sort(),
});

export class UpgradeRuntimeService {
  private readonly contextEngine: ContextEngine;
  private readonly actor: FileActor;
  private readonly contextEconomy: ContextEconomyRuntime;
  private readonly tasks = new Map<string, RuntimeTask>();
  private readonly checkpoints: SessionCheckpoint[] = [];
  private readonly hooks = new Map<string, { readonly name: string; readonly event: string }>();
  private readonly plugins = new Map<string, { readonly name: string; enabled: boolean }>();
  private readonly cache: CacheCounters = { hits: 0, misses: 0, bytesSaved: 0 };
  private readonly session = new Map<string, unknown>();
  private readonly worktrees: WorktreeLedgerEntry[] = [];
  private readonly experiences: WseExperience[] = [];
  private activeStrategy: WseStrategy = 'baseline';
  private readonly promotionHistory: WsePromotion[] = [];
  private readonly benchmarks: WseBenchmarkSnapshot[] = [];
  private readonly eventLog: EventLogCapabilityBackend;
  private readonly sandbox: SandboxRuntimeService;
  private readonly database: DatabaseRuntimeService;
  private readonly lsp: LspRuntimeService;
  private readonly documents: DocumentRuntimeService;
  private loaded = false;

  public constructor(
    private readonly services: McpApplicationServices,
    actor: FileActor,
    contextEconomy: ContextEconomyRuntime = new ContextEconomyRuntime(),
    private readonly activity?: ActivityTracker,
  ) {
    this.actor = actor;
    this.contextEconomy = contextEconomy;
    this.contextEngine = new ContextEngine(services, actor, contextEconomy);
    this.eventLog = new EventLogCapabilityBackend();
    this.sandbox = new SandboxRuntimeService(services, actor);
    this.database = new DatabaseRuntimeService(services, actor);
    this.lsp = new LspRuntimeService(services, actor);
    this.documents = new DocumentRuntimeService(services, actor);
  }

  public async execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<Result<unknown>> {
    await this.loadState();
    switch (name) {
      case 'tool_search':
      case 'tool_function_find':
      case 'tool_dynamic_filter':
        return ok(this.searchTools(readString(input, 'query') ?? readString(input, 'prompt') ?? '', input));
      case 'tool_describe':
        return ok(this.describeTool(readString(input, 'name') ?? readString(input, 'tool')));
      case 'tool_categories':
        return ok(this.categories());
      case 'tool_aliases':
        return ok({ aliases: { read: 'read_file', search: 'search_text', tree: 'workspace_tree', logs: 'live_logs_query', tests: 'test_context', context: 'workspace_context', map: 'repo_map' }, primitiveToolsRemainAvailable: true });
      case 'capabilities':
        return ok({ categories: this.categories().categories, totalUpgradeTools: UPGRADE_TOOL_CATALOG.length, primitiveToolsRemainAvailable: true });
      case 'route_intent':
        return ok(routeIntent(readString(input, 'prompt') ?? readString(input, 'query') ?? ''));
      case 'recipe_list':
      case 'recipe_catalog':
        return ok({ recipes: recipeCatalog() });
      case 'recipe_describe':
        return ok(recipeCatalog().find((recipe) => recipe.name === (readString(input, 'name') ?? 'bugfix')) ?? recipeCatalog()[0]);
      case 'recipe_run': {
        const requested = readString(input, 'name');
        const recipe = recipeCatalog().find((candidate) => candidate.name === requested);
        return ok(recipe === undefined
          ? { ...planFor(readString(input, 'prompt') ?? requested ?? 'bugfix'), dryRun: input.dryRun !== false, sideEffectsStarted: false }
          : { recipe, route: recipe.route, operations: recipe.steps, permissions: recipe.permissions, dryRun: input.dryRun !== false, sideEffectsStarted: false });
      }
      case 'dry_run':
        return ok({ ...planFor(readString(input, 'prompt') ?? readString(input, 'query') ?? ''), sideEffects: { writes: [], shell: [], gitMutations: [], network: [] }, sideEffectsStarted: false });
      case 'response_mode':
        return ok({ mode: normalizeMode(readString(input, 'mode')), omittedDetailsRemainFetchable: true, continuationSupported: true });
      case 'permission_check':
        return ok(permissionDecision(readString(input, 'action') ?? readString(input, 'permission') ?? 'filesystem.read'));
      case 'permission_profile':
        return ok({ profile: 'full', contextReads: 'unrestricted-for-allowed-workspaces', dangerousActions: 'policy-gated', hardBlocksRemain: true });
      case 'cache_stats':
        return ok({ ...this.cache, hitRate: hitRate(this.cache), entries: 0, invalidation: 'mtime/content-hash/filesystem-event', contextEconomy: this.contextEconomy.snapshot() });
      case 'cache_clear':
      case 'cache_invalidate':
        this.cache.hits = 0;
        this.cache.misses = 0;
        this.cache.bytesSaved = 0;
        return ok({ cleared: true, scope: name === 'cache_clear' ? 'all' : readString(input, 'path') ?? 'workspace' });
      case 'hook_list':
        return ok({ hooks: [...this.hooks.values()], lifecycleEvents: lifecycleEvents() });
      case 'hook_register': {
        const hook = { name: readString(input, 'name') ?? `hook-${this.hooks.size + 1}`, event: readString(input, 'event') ?? 'beforeTool' };
        this.hooks.set(hook.name, hook);
        return ok({ registered: true, hook });
      }
      case 'hook_remove': {
        const hookName = readString(input, 'name');
        return ok({ removed: hookName === undefined ? false : this.hooks.delete(hookName), name: hookName ?? null });
      }
      case 'skill_match':
        return ok({ query: readString(input, 'query') ?? readString(input, 'prompt') ?? '', skills: [], loaded: false, deterministic: true });
      case 'skill_load':
        return ok({ skillId: readString(input, 'skillId') ?? null, loaded: false, source: 'local-workspace-or-configured-skill-provider' });
      case 'plugin_list':
        return ok({ plugins: [...this.plugins.values()] });
      case 'plugin_install':
      case 'plugin_enable':
      case 'plugin_disable':
      case 'plugin_remove':
        return ok(await this.changePlugin(name, readString(input, 'name') ?? readString(input, 'plugin')));
      case 'session_context':
        return ok({ session: Object.fromEntries(this.session), checkpoints: this.checkpoints });
      case 'session_resume':
        return ok(await this.resumeSession(input));
      case 'session_checkpoint': {
        const identity = await this.resolveProjectIdentity(input);
        const checkpoint = createSessionCheckpoint(input, identity.projectKey);
        await this.persistSessionCheckpoint(checkpoint);
        return ok(checkpoint);
      }
      case 'session_history':
        return ok({ checkpoints: this.checkpoints });
      case 'task_create':
      case 'delegate': {
        const task = await this.createTask(name === 'delegate' ? 'delegate' : 'task', input);
        return ok(task);
      }
      case 'task_status':
      case 'task_result':
      case 'delegate_status':
      case 'delegate_result':
        return ok(this.taskView(readString(input, 'taskId') ?? readString(input, 'delegateId') ?? readString(input, 'id')));
      case 'task_list':
        return ok({ tasks: [...this.tasks.values()].map(publicTask) });
      case 'task_cancel':
      case 'delegate_cancel':
        return ok(await this.cancelTask(readString(input, 'taskId') ?? readString(input, 'delegateId') ?? readString(input, 'id')));
      case 'parallel_delegate':
        return ok(parallelDelegatePlan(input));
      case 'repo_map':
        return this.repositoryMap(readString(input, 'workspaceId'));
      case 'context_expand':
      case 'dependency_context':
        return this.contextExpansion(readString(input, 'workspaceId'), readString(input, 'path') ?? readString(input, 'symbol'));
      case 'symbol_search':
      case 'find_definition':
      case 'find_references':
      case 'find_implementations':
      case 'call_hierarchy':
      case 'import_graph':
      case 'dependency_graph':
      case 'module_graph':
      case 'type_search':
      case 'trace_symbol':
      case 'changed_symbols':
        return this.indexQuery(name, readString(input, 'workspaceId'), readString(input, 'query') ?? readString(input, 'symbol') ?? readString(input, 'path') ?? '');
      case 'workspace_index':
        return ok({});
      case 'live_logs_status':
        return ok({ healthy: true, sources: ['mcp', 'tunnel', 'process'], correlationIds: true, redaction: 'secrets-not-retained', bounded: true, persistence: 'rotating-file-sink' });
      case 'live_logs_query': {
        const entries = activityEntries(this.activity, input);
        const limit = boundedInteger(input.limit, 100, 1, 200);
        return ok({ entries, source: 'mcp', continuation: null, queryApplied: true, bounded: true, truncated: entries.length >= limit });
      }
      case 'telemetry_dashboard':
        return ok({ ...activityMetrics(this.activity?.listRecent() ?? []), internalOperations: 0, cacheHitRate: hitRate(this.cache), contextBytes: this.contextEconomy.snapshot().contextSentBytes, streamedBytes: 0, filesScanned: this.contextEconomy.snapshot().filesDiscovered, filesDelivered: this.contextEconomy.snapshot().filesDelivered, retries: 0, contextEconomy: this.contextEconomy.snapshot() });
      case 'context_economy_stats':
        return ok({ ...this.contextEconomy.snapshot(), policy: { automaticDiscovery: 'filtered-and-progressive', explicitAccess: 'full-and-unrestricted-by-economy', ledger: 'bounded-in-memory' } });
      case 'wse_experience_capture':
        return this.captureExperiences(input);
      case 'wse_experience_list':
        return ok({ experiences: this.experiences.slice(-boundedInteger(input.limit, 100, 1, 256)), total: this.experiences.length, rawPayloadsRetained: false });
      case 'wse_evaluate':
        return ok(evaluateExperiences(this.experiences));
      case 'wse_strategy_score':
        return ok(scoreWseStrategies(this.experiences));
      case 'wse_strategy_status':
        return ok({ activeStrategy: this.activeStrategy, automaticPromotion: false, promotionHistory: this.promotionHistory.slice(-20), authorizationUnchanged: true });
      case 'wse_strategy_promote':
        return this.promoteWseStrategy(input);
      case 'execution_plan':
        return ok({ ...planFor(readString(input, 'prompt') ?? readString(input, 'query') ?? ''), reason: 'deterministic rule plan; telemetry can refine cost estimates' });
      case 'recovery_status':
        return ok({ reconnect: 'enabled-at-transport-boundary', safeReadRetry: true, destructiveRetry: false, staleContinuation: 'detected', indexRecovery: 'rebuildable', workerIsolation: true });
      case 'tool_schema_list':
        return ok({ manifestVersion: TOOL_MANIFEST_VERSION, essentialTools: ESSENTIAL_TOOL_NAMES, schemas: UPGRADE_TOOL_CATALOG.map((entry) => ({ id: entry.name, version: '1.0.0', permissions: [entry.permission], streamable: entry.streamable === true, parallelSafe: entry.parallelSafe === true })) });
      case 'tool_schema_register':
        return ok({ registered: true, backwardCompatible: true, id: readString(input, 'name') ?? null });
      case 'mcp_discover':
      case 'mcp_resources':
        return ok({ servers: this.services.extensions === undefined ? [] : 'available', nativeToolsRemainVisible: true, connectionPooling: true, timeoutIsolation: true });
      case 'mcp_health':
        return ok(this.mcpHealth());
      case 'workspace_authority':
        return this.workspaceAuthority(input);
      case 'mcp_hub':
        return ok({ tool: name, status: 'optional', available: this.services.extensions !== undefined, flattenChildTools: false, credentialsStoredInRepository: false, statelessTransport: true, tasksExtension: true, cacheMetadata: true, tracePropagation: true, authorizationUnchanged: true });
      case 'self_heal_plan':
        return this.selfHealPlan(input);
      case 'self_heal_apply':
        return this.selfHealApply(input);
      case 'git_worktree_spawn':
        return this.gitWorktreeSpawn(input);
      case 'event_watch':
      case 'crash_trace':
        return this.eventLogQuery(name, input, signal);
      case 'sandbox_exec':
        return this.sandbox.execute(input, signal);
      case 'db_inspect':
        return this.database.inspect(input);
      case 'db_query':
        return this.database.query(input);
      case 'lsp_diagnostics':
        return this.lsp.diagnostics(input);
      case 'lsp_rename':
        return this.lsp.renamePlan(input);
      case 'git_worktree_remove':
        return this.gitWorktreeRemove(input);
      case 'pdf_extract_tables':
        return this.documents.extractTables(input, signal);
      case 'inspect_pdf':
        return this.documents.inspectPdf(input, signal);
      case 'inspect_workbook':
        return this.documents.inspectWorkbook(input);
      case 'docx_merge':
        return this.documents.docxMerge(input);
      case 'office_ppt':
        return this.officePowerPoint(input);
      case 'office_outlook':
        return this.officeOutlook(input);
      case 'handoff_context':
        return ok({ goal: summarize(readString(input, 'prompt') ?? readString(input, 'goal') ?? ''), workspaceId: readString(input, 'workspaceId') ?? null, branch: null, filesChanged: [], filesInspected: [], tests: [], failures: [], decisions: [], openQuestions: [], recommendedNextActions: ['inspect current status', 'continue with primitive tools'] });
      case 'benchmark_run':
        return this.runWseBenchmark(input);
      case 'regression_report':
        return ok(wseRegressionReport(this.benchmarks));
      case 'project_profile_get':
        return ok({ profile: null, source: '.lnwjud/project.yaml', augmentsCapabilities: true });
      case 'project_profile_set':
        return ok({ saved: true, source: '.lnwjud/project.yaml', accessRestrictionsChanged: false });
      case 'debug_context':
      case 'review_context':
      case 'change_context':
      case 'symbol_context':
      case 'test_context':
      case 'git_context':
      case 'frontend_context':
      case 'backend_context':
        return this.compoundContext(name, input);
      case 'review_changes':
      case 'affected_modules':
      case 'git_history_context':
      case 'git_blame_context':
      case 'discover_tests':
      case 'test_failures':
      case 'coverage_context':
      case 'test_history':
      case 'inspect_web_app':
      case 'debug_ui':
      case 'capture_ui_state':
      case 'form_context':
      case 'network_context':
      case 'console_context':
      case 'browser_debug_context':
      case 'windows_environment':
      case 'service_context':
      case 'process_context':
      case 'port_context':
      case 'registry_context':
      case 'event_log_context':
      case 'installed_runtime_context':
      case 'path_context':
      case 'startup_context':
      case 'capture_screenshot':
      case 'compare_screenshot':
      case 'dom_snapshot':
      case 'layout_metadata':
      case 'visual_context':
        return ok({ tool: name, status: 'ready', executed: [], primitiveFallbacks: ['read_file', 'search_text', 'workspace_tree'], metadataOnly: true, inputKeys: Object.keys(input).sort() });
      case 'run_affected_tests':
        return ok({ tool: name, started: false, affectedTests: [], fullRunStillAvailable: true, command: null });
      case 'context_ranking':
        return ok({ signals: { exactSymbol: 100, exactFilename: 80, recentChange: 60, sameModule: 50, dependency: 40, test: 30, text: 20, proximity: 10 }, lowerRankedResultsRemainAvailable: true });
      case 'dev_context':
        return ok({ prompt: summarize(readString(input, 'prompt') ?? ''), route: routeIntent(readString(input, 'prompt') ?? '').route, executed: ['route_intent', 'workspace_context', 'git_context', 'test_context'], continuationPaths: true, primitiveToolsRemainAvailable: true });
      default:
        return ok(contractStatus(name, input));
    }
  }

  private searchTools(query: string, input: Record<string, unknown> = {}): Record<string, unknown> {
    const normalized = query.toLowerCase().trim();
    const limit = boundedInteger(input.limit ?? input.topK, 20, 1, 100);
    const requestedReranker = readString(input, 'reranker') ?? readString(input, 'model') ?? 'deterministic';
    const category = readString(input, 'category')?.toLowerCase();
    const route = routeIntent(query);
    const experienceStats = toolExperienceStats(this.experiences);
    const scored = SEARCH_CATALOG
      .filter((entry) => category === undefined || entry.tags.some((tag) => tag.toLowerCase() === category))
      .map((entry) => scoreToolEntry(entry, normalized, route, this.activeStrategy, experienceStats.get(entry.name)))
      .filter((entry) => normalized.length === 0 || entry.score > 0)
      .sort((left, right) => right.score - left.score || Number(right.entry.primitive === true) - Number(left.entry.primitive === true) || left.entry.name.localeCompare(right.entry.name));
    const rankedCandidates: readonly RankedToolCandidate[] = scored.slice(0, limit).map((candidate) => ({
      name: candidate.entry.name,
      score: Number(candidate.score.toFixed(4)),
      reasonCodes: candidate.reasonCodes,
      essential: isEssentialTool(candidate.entry.name),
      permission: candidate.entry.permission,
      permissionMetadata: {
        permission: candidate.entry.permission,
        authorization: 'not_granted_by_ranking',
        destructiveHint: candidate.entry.permission === 'DANGEROUS',
      },
      source: candidate.entry.primitive === true ? 'primitive' : 'upgrade',
      tags: candidate.entry.tags,
      phase: candidate.entry.phase,
    }));
    const selectedModel = requestedReranker === 'local' ? 'deterministic' : 'deterministic';
    return {
      query,
      matches: scored.slice(0, limit).map((candidate) => candidate.entry),
      totalMatches: scored.length,
      limit,
      rankedCandidates,
      selectedModel,
      ...(requestedReranker === 'local' ? { fallbackReason: 'local_model_not_configured' } : {}),
      primitiveToolsRemainAvailable: true,
      authorizationUnchanged: true,
      route: route.route,
      activeStrategy: this.activeStrategy,
      essentialTools: ESSENTIAL_TOOL_NAMES,
      manifestVersion: TOOL_MANIFEST_VERSION,
    };
  }

  private describeTool(name: string | undefined): unknown {
    const entry = SEARCH_CATALOG.find((candidate) => candidate.name === name);
    return entry === undefined ? { found: false, name: name ?? null } : { found: true, ...entry, schema: { type: 'object', additionalProperties: true }, authorizationUnchanged: true };
  }

  private categories(): { readonly categories: readonly { readonly category: string; readonly tools: number }[]; readonly essentialTools: readonly string[]; readonly manifestVersion: string } {
    const counts = new Map<string, number>();
    for (const entry of UPGRADE_TOOL_CATALOG) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return {
      categories: [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([category, tools]) => ({ category, tools })),
      essentialTools: ESSENTIAL_TOOL_NAMES,
      manifestVersion: TOOL_MANIFEST_VERSION,
    };
  }

  private mcpHealth(): Record<string, unknown> {
    return {
      status: 'local-mcp-only',
      servers: this.services.extensions === undefined ? [] : 'available',
      localMcp: { state: 'available', message: 'NAVA MCP application boundary is available' },
      controlPlane: { state: 'unknown', message: 'Remote tunnel control-plane health is not observable from the MCP child' },
      connectorSchema: { state: 'unknown', message: 'Connector schema freshness is not observable here; refresh the connector when tools are missing' },
      connectionPooling: true,
      timeoutIsolation: true,
      nativeToolsRemainVisible: true,
      verificationRequired: true,
      essentialTools: ESSENTIAL_TOOL_NAMES,
      manifestVersion: TOOL_MANIFEST_VERSION,
    };
  }

  private async workspaceAuthority(input: Record<string, unknown>): Promise<Result<unknown>> {
    if (this.services.workspaceInfo?.list === undefined) {
      return ok({ available: false, reason: 'workspace_registry_unavailable', workspaces: [], activeWriters: [], verificationRequired: true });
    }
    const listed = await this.services.workspaceInfo.list(this.actor);
    if (!listed.ok) return err(listed.error);
    const workspaces = workspaceAuthorityEntries(listed.value).slice(0, MAX_AUTHORITY_WORKSPACES);
    const requestedWorkspaceId = readString(input, 'workspaceId');
    const leaseResult = this.services.workspaceLeases === undefined
      ? undefined
      : await this.services.workspaceLeases.status(requestedWorkspaceId);
    const activeWriters = leaseResult === undefined || !leaseResult.ok
      ? []
      : leaseResult.value.slice(0, MAX_AUTHORITY_LEASES).map((lease) => ({
        workspaceId: lease.workspaceId,
        leaseId: lease.leaseId,
        owner: lease.owner,
        heartbeatAt: lease.heartbeatAt,
        expiresAt: lease.expiresAt,
      }));
    return ok({
      available: true,
      requestedWorkspaceId: requestedWorkspaceId ?? null,
      workspaceCount: workspaces.length,
      workspaces,
      activeWriters,
      activeWriterCount: activeWriters.length,
      leaseTracking: leaseResult === undefined ? 'unavailable' : leaseResult.ok ? 'available' : 'error',
      ...(leaseResult !== undefined && !leaseResult.ok ? { leaseError: leaseResult.error.message } : {}),
      writePolicy: 'Reads may run concurrently; mutations require the matching expiring writer lease for their workspace.',
      truncated: workspaces.length >= MAX_AUTHORITY_WORKSPACES,
      verificationRequired: true,
    });
  }

  private async changePlugin(operation: string, name: string | undefined): Promise<unknown> {
    if (name === undefined || name.trim().length === 0) return { changed: false, reason: 'plugin name is required' };
    if (operation === 'plugin_remove') {
      const changed = this.plugins.delete(name);
      await this.persistState();
      return { changed, name };
    }
    const plugin = { name, enabled: operation !== 'plugin_disable' };
    this.plugins.set(name, plugin);
    await this.persistState();
    return { changed: true, ...plugin };
  }

  private async createTask(kind: RuntimeTask['kind'], input: Record<string, unknown>): Promise<RuntimeTask> {
    const task: RuntimeTask = { id: randomUUID(), kind, createdAt: new Date().toISOString(), inputDigest: digest(input), state: 'queued' };
    this.tasks.set(task.id, task);
    await this.persistState();
    return task;
  }

  private taskView(id: string | undefined): unknown {
    const task = id === undefined ? undefined : this.tasks.get(id);
    return task === undefined ? { found: false, id: id ?? null } : publicTask(task);
  }

  private async cancelTask(id: string | undefined): Promise<unknown> {
    const task = id === undefined ? undefined : this.tasks.get(id);
    if (task === undefined) return { cancelled: false, id: id ?? null };
    task.state = 'cancelled';
    await this.persistState();
    return { cancelled: true, id };
  }

  private async selfHealPlan(input: Record<string, unknown>): Promise<Result<unknown>> {
    const workspaceId = readString(input, 'workspaceId');
    const evidence: Record<string, unknown> = {};
    const fixes: SelfHealFix[] = [];

    if (workspaceId !== undefined && this.services.workspaceIndex !== undefined) {
      const status = await this.services.workspaceIndex.status(workspaceId);
      if (status.ok) {
        evidence.index = { indexed: status.value.indexed, entries: status.value.snapshot?.entries?.length ?? 0 };
        if (status.value.indexed !== true) {
          fixes.push({
            id: 'reindex-workspace', kind: 'reindex_workspace', tool: 'workspace_index', args: { workspaceId },
            description: 'Rebuild the persistent workspace index (read-only re-scan)', reversible: true, requiresConfirmation: false,
          });
        }
      }
    }

    if (this.services.capabilities !== undefined) {
      const list = await this.services.capabilities.execute('shell', { operation: 'list' });
      if (list.ok && typeof list.value === 'object' && list.value !== null && Array.isArray((list.value as { tasks?: unknown }).tasks)) {
        const tasks = (list.value as { tasks: Record<string, unknown>[] }).tasks;
        const cutoff = Date.now() - 24 * 60 * 60 * 1_000;
        const stale = tasks.filter((task) => task.durable === true && task.state === 'running' && typeof task.started_at === 'string' && Date.parse(task.started_at) < cutoff);
        evidence.durableTasks = { total: tasks.length, staleOlderThan24h: stale.length };
        for (const task of stale.slice(0, 10)) {
          fixes.push({
            id: `cancel-stale-task-${String(task.task_id)}`, kind: 'cancel_stale_task', tool: 'shell',
            args: { operation: 'cancel', task_id: task.task_id },
            description: `Cancel durable task ${String(task.task_id)} that has been running for over 24 hours`, reversible: false, requiresConfirmation: true,
          });
        }
      }
    }

    const planId = digest({ workspaceId: workspaceId ?? null, evidence, fixes: fixes.map((fix) => ({ id: fix.id, kind: fix.kind, args: fix.args })) });
    return ok({
      tool: 'self_heal_plan', status: 'ready', available: true, applied: false,
      planId,
      mutationRequired: fixes.some((fix) => fix.requiresConfirmation),
      safeReversibleFixes: fixes,
      automaticDestructiveRetry: false,
      auditTarget: 'recovery-plan',
      evidence,
    });
  }

  private async selfHealApply(input: Record<string, unknown>): Promise<Result<unknown>> {
    const plan = await this.selfHealPlan(input);
    if (!plan.ok) return plan;
    const planValue = plan.value as { planId: string; safeReversibleFixes: SelfHealFix[] };
    const requested = Array.isArray(input.fixIds) ? input.fixIds.map(String) : undefined;
    const selected = planValue.safeReversibleFixes.filter((fix) => requested === undefined || requested.includes(fix.id));
    const preview = {
      tool: 'self_heal_apply',
      planId: planValue.planId,
      selected: selected.map((fix) => ({ id: fix.id, kind: fix.kind, description: fix.description, requiresConfirmation: fix.requiresConfirmation })),
      automaticDestructiveRetry: false,
      auditTarget: 'recovery-mutation',
    };
    if (input.dryRun !== false && input.dry_run !== false) return ok({ ...preview, dryRun: true, applied: [] });
    if (input.userConfirmed !== true) {
      return err(appError('PERMISSION_REQUIRED', 'Applying a recovery plan requires explicit chat confirmation. Review self_heal_plan first, then retry with userConfirmed: true'));
    }
    const approvedPlanId = readString(input, 'planId');
    if (approvedPlanId === undefined) {
      return err(appError('PERMISSION_REQUIRED', 'Applying a recovery plan requires the planId returned by self_heal_plan'));
    }
    if (approvedPlanId !== planValue.planId) {
      return err(appError('INVALID_INPUT', 'Recovery evidence changed after preview. Run self_heal_plan again and review the new plan before applying it'));
    }

    const applied: Record<string, unknown>[] = [];
    for (const fix of selected) {
      if (fix.kind === 'reindex_workspace' && this.services.workspaceIndex !== undefined) {
        const result = await this.services.workspaceIndex.indexWorkspace(String(fix.args.workspaceId));
        applied.push({ id: fix.id, kind: fix.kind, ok: result.ok, ...(result.ok ? {} : { error: result.error.message }) });
      } else if (fix.kind === 'cancel_stale_task' && this.services.capabilities !== undefined) {
        const result = await this.services.capabilities.execute('shell', fix.args);
        applied.push({ id: fix.id, kind: fix.kind, ok: result.ok, ...(result.ok ? {} : { error: result.error.message }) });
      } else {
        applied.push({ id: fix.id, kind: fix.kind, ok: false, error: 'unsupported-fix-kind' });
      }
    }
    return ok({ ...preview, dryRun: false, applied, automaticDestructiveRetry: false });
  }

  private async officePowerPoint(input: Record<string, unknown>): Promise<Result<unknown>> {
    const capabilities = this.services.capabilities;
    if (capabilities === undefined) return ok({ tool: 'office_ppt', status: 'optional', available: false, reason: 'Office capability is not configured' });
    const action = readString(input, 'action') ?? 'read';
    if (action !== 'read' && action !== 'save_as') return err(appError('INVALID_INPUT', 'office_ppt action must be read or save_as'));
    const filePath = readString(input, 'file_path') ?? readString(input, 'path');
    if (filePath === undefined) return err(appError('INVALID_INPUT', 'office_ppt requires file_path'));
    const targetPath = readString(input, 'target_path') ?? readString(input, 'target');
    if (action === 'save_as' && targetPath === undefined) return err(appError('INVALID_INPUT', 'office_ppt save_as requires target_path'));
    const plan = { tool: 'office_ppt', status: 'ready', available: true, app: 'powerpoint', action, file_path: filePath, ...(targetPath === undefined ? {} : { target_path: targetPath }) };
    if (action === 'save_as' && input.dryRun !== false && input.dry_run !== false) return ok({ ...plan, dryRun: true, executed: false });
    if (action === 'save_as' && input.userConfirmed !== true) return err(appError('PERMISSION_REQUIRED', 'PowerPoint save_as requires explicit user confirmation'));
    const result = await capabilities.execute('office', { app: 'powerpoint', action, file_path: filePath, ...(targetPath === undefined ? {} : { target_path: targetPath }) });
    return result.ok ? ok({ ...plan, dryRun: false, executed: true, result: result.value }) : result;
  }

  private async officeOutlook(input: Record<string, unknown>): Promise<Result<unknown>> {
    const capabilities = this.services.capabilities;
    if (capabilities === undefined) return ok({ tool: 'office_outlook', status: 'optional', available: false, reason: 'Office capability is not configured' });
    const action = readString(input, 'action') ?? 'list_messages';
    if (action !== 'list_folders' && action !== 'list_messages') return err(appError('INVALID_INPUT', 'office_outlook action must be list_folders or list_messages'));
    const folder = readString(input, 'folder');
    const maxMessages = typeof input.max_messages === 'number' ? Math.min(100, Math.max(1, Math.trunc(input.max_messages))) : undefined;
    const result = await capabilities.execute('office', { app: 'outlook', action, ...(folder === undefined ? {} : { folder }), ...(maxMessages === undefined ? {} : { max_messages: maxMessages }) });
    return result.ok ? ok({ tool: 'office_outlook', status: 'ready', available: true, action, result: result.value }) : result;
  }

  private async eventLogQuery(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<Result<unknown>> {
    const result = await this.eventLog.execute({
      operation: name === 'crash_trace' ? 'crashes' : 'query',
      ...(readString(input, 'log_name') === undefined && readString(input, 'logName') === undefined ? {} : { log_name: readString(input, 'log_name') ?? readString(input, 'logName') }),
      ...(readString(input, 'provider') === undefined ? {} : { provider: readString(input, 'provider') }),
      ...(readString(input, 'since') === undefined ? {} : { since: readString(input, 'since') }),
      ...(typeof input.hours === 'number' ? { hours: input.hours } : {}),
      ...(typeof input.max_events === 'number' ? { max_events: input.max_events } : {}),
    }, signal);
    if (!result.ok) return result;
    const payload = result.value as Record<string, unknown>;
    return ok({
      tool: name,
      status: payload.available === false ? 'optional' : 'ready',
      ...payload,
    });
  }

  private async gitWorktreeSpawn(input: Record<string, unknown>): Promise<Result<unknown>> {
    const workspaceId = readString(input, 'workspaceId');
    if (workspaceId === undefined) return err(appError('INVALID_INPUT', 'workspaceId is required for a Git worktree'));
    const worktreePath = readString(input, 'worktreePath') ?? `.worktrees/agent-${randomUUID().slice(0, 8)}`;
    const normalizedPath = worktreePath.replaceAll('\\', '/');
    if (normalizedPath.startsWith('/') || /^[A-Za-z]:/.test(normalizedPath) || normalizedPath.split('/').some((part) => part === '..') || !(normalizedPath.startsWith('.worktrees/') || normalizedPath.startsWith('.lnwjud/worktrees/'))) {
      return err(appError('PATH_OUTSIDE_WORKSPACE', 'Git worktree path must remain under .worktrees or .lnwjud/worktrees'));
    }
    const ref = readString(input, 'ref') ?? 'HEAD';
    if (ref.includes('\0') || ref.length > 256) return err(appError('INVALID_INPUT', 'Git worktree ref is invalid'));
    const plan = {
      tool: 'git_worktree_spawn',
      workspaceId,
      worktreePath: normalizedPath,
      ref,
      owner: this.actor.clientId,
      collisionPolicy: 'one-owner-per-worktree-path',
      mutationPolicy: 'explicit-confirmation-and-dry-run',
      sideEffectsStarted: false,
    };
    const dryRun = input.dryRun !== false && input.dry_run !== false;
    if (dryRun) return ok({ ...plan, dryRun: true });
    if (input.userConfirmed !== true) return err(appError('PERMISSION_REQUIRED', 'Creating a Git worktree requires explicit user confirmation'));
    if (this.services.git === undefined) return ok({ ...plan, dryRun: false, status: 'optional', available: false, reason: 'Git service is not configured' });
    const result = await this.services.git.run(this.actor, {
      workspaceId,
      args: ['worktree', 'add', '--detach', normalizedPath, ref],
      ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
    });
    if (!result.ok) return result;
    this.worktrees.push({ workspaceId, worktreePath: normalizedPath, ref, owner: this.actor.clientId, createdAt: new Date().toISOString() });
    await this.persistState();
    return ok({ ...plan, dryRun: false, sideEffectsStarted: true, status: 'completed', result: result.value, ownershipLedger: true });
  }

  private async gitWorktreeRemove(input: Record<string, unknown>): Promise<Result<unknown>> {
    const workspaceId = readString(input, 'workspaceId');
    const worktreePath = readString(input, 'worktreePath')?.replaceAll('\\', '/');
    if (workspaceId === undefined || worktreePath === undefined) return err(appError('INVALID_INPUT', 'workspaceId and worktreePath are required'));
    const entry = this.worktrees.find((candidate) => candidate.workspaceId === workspaceId && candidate.worktreePath === worktreePath);
    if (entry === undefined) return err(appError('PROCESS_NOT_FOUND', 'Worktree is not in the ownership ledger; refusing to remove unknown worktrees'));
    const plan = {
      tool: 'git_worktree_remove', workspaceId, worktreePath,
      owner: entry.owner,
      mutationPolicy: 'explicit-confirmation-and-dry-run',
    };
    if (input.dryRun !== false && input.dry_run !== false) return ok({ ...plan, dryRun: true });
    if (input.userConfirmed !== true) return err(appError('PERMISSION_REQUIRED', 'Removing a Git worktree requires explicit user confirmation'));
    if (this.services.git === undefined) return ok({ ...plan, dryRun: false, status: 'optional', available: false, reason: 'Git service is not configured' });
    const result = await this.services.git.run(this.actor, {
      workspaceId,
      args: ['worktree', 'remove', worktreePath],
      ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
    });
    if (!result.ok) return result;
    const index = this.worktrees.indexOf(entry);
    if (index !== -1) this.worktrees.splice(index, 1);
    await this.persistState();
    return ok({ ...plan, dryRun: false, sideEffectsStarted: true, status: 'completed', result: result.value });
  }

  private async repositoryMap(workspaceId: string | undefined): Promise<Result<unknown>> {
    if (workspaceId === undefined || this.services.workspaceIndex === undefined) return ok({ workspaceId: workspaceId ?? null, entries: [], indexed: false, traversable: true });
    const status = await this.services.workspaceIndex.status(workspaceId);
    if (!status.ok) return status;
    const entries = status.value.snapshot?.entries ?? [];
    return ok({ workspaceId, indexed: status.value.indexed, traversable: true, counts: countKinds(entries), entries: entries.map((entry) => ({ path: entry.relativePath, kind: entry.kind, language: entry.language, isTest: entry.isTest })) });
  }

  private async contextExpansion(workspaceId: string | undefined, query: string | undefined): Promise<Result<unknown>> {
    if (workspaceId === undefined || this.services.workspaceIndex === undefined) return ok({ workspaceId: workspaceId ?? null, query: query ?? '', references: [], optional: true });
    const status = await this.services.workspaceIndex.status(workspaceId);
    if (!status.ok) return status;
    const needle = (query ?? '').toLowerCase();
    const references = (status.value.snapshot?.entries ?? []).filter((entry) => needle.length === 0 || entry.relativePath.toLowerCase().includes(needle) || entry.symbols.some((symbol) => symbol.toLowerCase().includes(needle))).slice(0, 100).map((entry) => ({ path: entry.relativePath, imports: entry.imports, exports: entry.exports, tests: entry.isTest }));
    return ok({ workspaceId, query: query ?? '', references, optional: true, continuationAvailable: false });
  }

  private async indexQuery(name: string, workspaceId: string | undefined, query: string): Promise<Result<unknown>> {
    if (workspaceId === undefined || this.services.workspaceIndex === undefined) return ok({ tool: name, query, indexed: false, matches: [], primitiveFallback: 'search_text' });
    const status = await this.services.workspaceIndex.status(workspaceId);
    if (!status.ok) return status;
    const needle = query.toLowerCase();
    const entries = status.value.snapshot?.entries ?? [];
    const matches = entries.filter((entry) => entry.symbols.some((symbol) => symbol.toLowerCase().includes(needle)) || entry.relativePath.toLowerCase().includes(needle)).map((entry) => ({ path: entry.relativePath, symbols: entry.symbols, functions: entry.functions, classes: entry.classes, interfaces: entry.interfaces, imports: entry.imports, exports: entry.exports, isTest: entry.isTest }));
    return ok({ tool: name, query, indexed: status.value.indexed, matches, lowerRankedResultsRemainAvailable: true });
  }

  private async compoundContext(name: string, input: Record<string, unknown>): Promise<Result<unknown>> {
    const workspaceId = readString(input, 'workspaceId');
    const query = readString(input, 'query') ?? readString(input, 'prompt') ?? name;
    const context = await this.contextEngine.collect({
      query,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      intent: name.includes('review') ? 'review' : name.includes('test') ? 'explore' : name.includes('symbol') ? 'trace' : name.includes('debug') ? 'debug' : 'auto',
      mode: 'full',
    });
    const git = workspaceId === undefined || this.services.git === undefined
      ? ok(null)
      : await this.services.git.status(this.actorForOperation(), workspaceId);
    return ok({
      tool: name,
      query,
      context: context.ok ? context.value : { error: context.error },
      git: git.ok ? git.value : { error: git.error },
      internalOperations: ['workspace search', 'indexed symbol lookup', 'git status', 'test relevance'],
      rawToolsRemainAvailable: true,
    });
  }

  private actorForOperation(): FileActor {
    return this.actor;
  }

  private async resolveProjectIdentity(input: Record<string, unknown>): Promise<{ readonly requestedProjectKey: string; readonly projectKey: string; readonly workspaceId?: string; readonly aliases: ReadonlySet<string> }> {
    const requestedProjectKey = checkpointProjectKey(input);
    const inputWorkspaceId = checkpointString(input.workspaceId, 128);
    const aliases = new Set<string>(identityAliases(requestedProjectKey));
    if (inputWorkspaceId !== undefined) for (const alias of identityAliases(inputWorkspaceId)) aliases.add(alias);
    let workspaceId = inputWorkspaceId;
    let projectKey = requestedProjectKey;
    const listed = this.services.workspaceInfo?.list === undefined ? undefined : await this.services.workspaceInfo.list(this.actor);
    if (listed?.ok === true) {
      const entries = workspaceAuthorityEntries(listed.value);
      const match = entries.find((entry) => (
        (workspaceId !== undefined && entry.id === workspaceId)
        || identityAliases(entry.id).some((alias) => aliases.has(alias))
        || (entry.displayName !== null && identityAliases(entry.displayName).some((alias) => aliases.has(alias)))
        || (entry.rootPath !== null && identityAliases(entry.rootPath).some((alias) => aliases.has(alias)))
      ));
      if (match !== undefined) {
        workspaceId = match.id;
        projectKey = canonicalProjectKey(match.displayName ?? match.id);
        for (const value of [match.id, match.displayName, match.rootPath]) {
          if (value !== null && value !== undefined) for (const alias of identityAliases(value)) aliases.add(alias);
        }
      }
    }
    return { requestedProjectKey, projectKey, ...(workspaceId === undefined ? {} : { workspaceId }), aliases };
  }

  private async resumeSession(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const identity = await this.resolveProjectIdentity(input);
    const selected = this.checkpoints.filter((checkpoint) => {
      if (identity.workspaceId !== undefined && checkpoint.workspaceId === identity.workspaceId) return true;
      return [...checkpointAliases(checkpoint)].some((alias) => identity.aliases.has(alias));
    });
    const checkpoint = selected.at(-1) ?? null;
    const requestedWorkspaceId = checkpoint?.workspaceId ?? identity.workspaceId;
    const recentActivity = (this.activity?.listRecent(64) ?? [])
      .filter((event) => event.phase === 'completed')
      .filter((event) => requestedWorkspaceId === undefined || event.workspaceId === requestedWorkspaceId)
      .slice(-12)
      .map((event) => ({
        toolName: event.toolName,
        resultCode: event.resultCode,
        durationMs: event.durationMs,
        timestamp: event.timestamp,
        ...(event.workspaceId === undefined ? {} : { workspaceId: event.workspaceId }),
      }));
    return {
      projectKey: identity.requestedProjectKey,
      matchedProjectKey: checkpoint === null ? identity.projectKey : checkpointProjectKeyFromStored(checkpoint),
      matchedProjectKeys: [...new Set(selected.flatMap((entry) => [...checkpointAliases(entry)]))].slice(0, 16),
      ...(identity.workspaceId === undefined ? {} : { workspaceId: identity.workspaceId }),
      checkpoint,
      checkpointCount: selected.length,
      recentActivity,
      recovered: checkpoint !== null,
      verificationRequired: true,
    };
  }

  private async persistSessionCheckpoint(checkpoint: SessionCheckpoint): Promise<void> {
    const statePath = this.services.runtimeStatePath;
    if (statePath === undefined) {
      this.replaceContinuityState([...this.checkpoints, checkpoint], checkpoint);
      return;
    }
    const continuityPath = continuityStatePath(statePath);
    await withContinuityWriteLock(continuityPath, async () => {
      const persisted = await readContinuityState(continuityPath);
      const merged = dedupeCheckpoints([...(persisted.checkpoints ?? []), ...this.checkpoints, checkpoint])
        .slice(-MAX_SESSION_CHECKPOINTS);
      await writeJsonAtomic(continuityPath, {
        checkpoints: merged,
        lastCheckpointId: checkpoint.id,
        lastProjectKey: checkpoint.projectKey ?? 'global',
      });
      this.replaceContinuityState(merged, checkpoint);
    });
  }

  private replaceContinuityState(checkpoints: readonly SessionCheckpoint[], latest?: SessionCheckpoint): void {
    this.checkpoints.splice(0, this.checkpoints.length, ...checkpoints.slice(-MAX_SESSION_CHECKPOINTS));
    const selected = latest ?? this.checkpoints.at(-1);
    if (selected !== undefined) {
      this.session.set('lastCheckpointId', selected.id);
      this.session.set('lastProjectKey', selected.projectKey ?? 'global');
    }
  }

  private async loadState(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const statePath = this.services.runtimeStatePath;
    if (statePath === undefined) return;
    try {
      const parsed: unknown = JSON.parse(await readFile(statePath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) return;
      const state = parsed as PersistedRuntimeState;
      for (const task of state.tasks ?? []) if (isRuntimeTask(task)) this.tasks.set(task.id, { ...task });
      for (const checkpoint of state.checkpoints ?? []) if (isCheckpoint(checkpoint)) this.checkpoints.push(checkpoint);
      for (const plugin of state.plugins ?? []) if (isPlugin(plugin)) this.plugins.set(plugin.name, { ...plugin });
      for (const pair of state.session ?? []) if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string') this.session.set(pair[0], pair[1]);
      for (const worktree of state.worktrees ?? []) {
        if (typeof worktree.workspaceId === 'string' && typeof worktree.worktreePath === 'string' && typeof worktree.ref === 'string' && typeof worktree.owner === 'string' && typeof worktree.createdAt === 'string') {
          this.worktrees.push(worktree);
        }
      }
      for (const experience of state.experiences ?? []) if (isWseExperience(experience)) this.experiences.push(experience);
      if (this.experiences.length > MAX_WSE_EXPERIENCES) this.experiences.splice(0, this.experiences.length - MAX_WSE_EXPERIENCES);
      if (isWseStrategy(state.activeStrategy)) this.activeStrategy = state.activeStrategy;
      for (const promotion of state.promotionHistory ?? []) if (isWsePromotion(promotion)) this.promotionHistory.push(promotion);
      for (const benchmark of state.benchmarks ?? []) if (isWseBenchmarkSnapshot(benchmark)) this.benchmarks.push(benchmark);
    } catch {
      // A corrupt optional state file is recoverable; the next mutation writes a fresh state.
    }
    await this.loadContinuityState();
  }

  private async loadContinuityState(): Promise<void> {
    const statePath = this.services.runtimeStatePath;
    if (statePath === undefined) return;
    const state = await readContinuityState(continuityStatePath(statePath));
    const merged = dedupeCheckpoints([...this.checkpoints, ...(state.checkpoints ?? [])]).slice(-MAX_SESSION_CHECKPOINTS);
    this.replaceContinuityState(merged, merged.find((entry) => entry.id === state.lastCheckpointId) ?? merged.at(-1));
  }

  private async persistState(): Promise<void> {
    const statePath = this.services.runtimeStatePath;
    if (statePath === undefined) return;
    try {
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath, `${JSON.stringify({
        tasks: [...this.tasks.values()],
        checkpoints: this.checkpoints,
        plugins: [...this.plugins.values()],
        session: [...this.session.entries()],
        worktrees: this.worktrees,
        experiences: this.experiences,
        activeStrategy: this.activeStrategy,
        promotionHistory: this.promotionHistory,
        benchmarks: this.benchmarks,
      })}\n`, 'utf8');
    } catch {
      // State persistence must never break the MCP operation itself.
    }
  }

  private async captureExperiences(input: Record<string, unknown>): Promise<Result<unknown>> {
    const limit = boundedInteger(input.limit, 100, 1, 256);
    const existing = new Set(this.experiences.map((entry) => entry.callId));
    const completed = (this.activity?.listRecent(limit * 2) ?? [])
      .filter((event) => event.phase === 'completed' && !event.toolName.startsWith('wse_'))
      .slice(-limit);
    let captured = 0;
    for (const event of completed) {
      if (existing.has(event.callId)) continue;
      this.experiences.push(toWseExperience(event));
      existing.add(event.callId);
      captured += 1;
    }
    if (this.experiences.length > MAX_WSE_EXPERIENCES) this.experiences.splice(0, this.experiences.length - MAX_WSE_EXPERIENCES);
    if (captured > 0) await this.persistState();
    return ok({ captured, total: this.experiences.length, capacity: MAX_WSE_EXPERIENCES, rawPayloadsRetained: false, deduplicatedByCallId: true });
  }

  private async promoteWseStrategy(input: Record<string, unknown>): Promise<Result<unknown>> {
    if (input.userConfirmed !== true) return err(appError('PERMISSION_REQUIRED', 'WSE strategy changes require explicit human confirmation'));
    const action = readString(input, 'action') === 'rollback' ? 'rollback' : 'promote';
    const previousStrategy = this.activeStrategy;
    let nextStrategy: WseStrategy;
    if (action === 'rollback') {
      const previousPromotion = [...this.promotionHistory].reverse().find((entry) => entry.action === 'promote' && entry.activeStrategy === this.activeStrategy);
      nextStrategy = previousPromotion?.previousStrategy ?? 'baseline';
    } else {
      const requested = readString(input, 'strategy');
      if (!isWseStrategy(requested)) return err(appError('INVALID_INPUT', 'strategy must be baseline, reliability-first, or latency-first'));
      if (requested !== 'baseline' && this.experiences.length < MIN_WSE_PROMOTION_SAMPLES) {
        return ok({ promoted: false, reason: 'insufficient_evidence', sampleSize: this.experiences.length, requiredSamples: MIN_WSE_PROMOTION_SAMPLES, activeStrategy: this.activeStrategy, automaticPromotion: false });
      }
      nextStrategy = requested;
    }
    this.activeStrategy = nextStrategy;
    this.promotionHistory.push({ id: randomUUID(), action, previousStrategy, activeStrategy: nextStrategy, timestamp: new Date().toISOString(), evidenceDigest: digest(evaluateExperiences(this.experiences)) });
    if (this.promotionHistory.length > MAX_WSE_PROMOTIONS) this.promotionHistory.splice(0, this.promotionHistory.length - MAX_WSE_PROMOTIONS);
    await this.persistState();
    return ok(action === 'rollback'
      ? { rolledBack: true, previousStrategy, activeStrategy: nextStrategy, automaticPromotion: false }
      : { promoted: true, previousStrategy, activeStrategy: nextStrategy, automaticPromotion: false });
  }

  private async runWseBenchmark(input: Record<string, unknown>): Promise<Result<unknown>> {
    const evaluation = evaluateExperiences(this.experiences);
    const snapshot: WseBenchmarkSnapshot = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sampleSize: evaluation.sampleSize,
      successRate: evaluation.successRate,
      averageLatencyMs: evaluation.averageLatencyMs,
      p95LatencyMs: evaluation.p95LatencyMs,
      evidenceDigest: digest(evaluation),
    };
    const preview = input.dryRun !== false;
    if (!preview) {
      this.benchmarks.push(snapshot);
      if (this.benchmarks.length > 32) this.benchmarks.splice(0, this.benchmarks.length - 32);
      await this.persistState();
    }
    return ok({ started: true, preview, scenario: readString(input, 'scenario') ?? 'wse-experience', evaluation, snapshot: preview ? null : snapshot, snapshotCount: this.benchmarks.length, deterministic: true });
  }
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function digest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function summarize(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 240);
}

function createSessionCheckpoint(input: Record<string, unknown>, resolvedProjectKey = checkpointProjectKey(input)): SessionCheckpoint {
  const projectKey = resolvedProjectKey;
  const workspaceId = checkpointString(input.workspaceId, 128);
  const objective = checkpointString(input.objective);
  const phase = checkpointString(input.phase, 240);
  const completed = checkpointList(input.completed);
  const files = checkpointList(input.files);
  const verification = checkpointList(input.verification);
  const blockers = checkpointList(input.blockers);
  const boundaries = checkpointList(input.boundaries);
  const nextAction = checkpointString(input.nextAction);
  const summary = checkpointString(input.summary ?? input.prompt, 240)
    ?? summarize(objective ?? nextAction ?? phase ?? 'Checkpoint saved');
  const safePayload = {
    projectKey,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(objective === undefined ? {} : { objective }),
    ...(phase === undefined ? {} : { phase }),
    ...(completed.length === 0 ? {} : { completed }),
    ...(files.length === 0 ? {} : { files }),
    ...(verification.length === 0 ? {} : { verification }),
    ...(blockers.length === 0 ? {} : { blockers }),
    ...(boundaries.length === 0 ? {} : { boundaries }),
    ...(nextAction === undefined ? {} : { nextAction }),
    summary,
  };
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...safePayload,
    inputDigest: digest(safePayload),
  };
}

function checkpointProjectKey(input: Record<string, unknown>): string {
  return canonicalProjectKey(checkpointString(input.projectKey, 128) ?? checkpointString(input.workspaceId, 128) ?? 'global');
}

function checkpointProjectKeyFromStored(checkpoint: SessionCheckpoint): string {
  return canonicalProjectKey(checkpoint.projectKey ?? checkpoint.workspaceId ?? 'global');
}

function checkpointAliases(checkpoint: SessionCheckpoint): readonly string[] {
  return [checkpoint.projectKey, checkpoint.workspaceId]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .flatMap((value) => identityAliases(value));
}

function canonicalProjectKey(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.length === 0 ? 'global' : normalized;
}

function identityAliases(value: string): readonly string[] {
  const aliases = new Set<string>([canonicalProjectKey(value)]);
  if (path.win32.isAbsolute(value)) aliases.add(path.win32.normalize(value).toLowerCase());
  return [...aliases];
}

function isEssentialTool(name: string): boolean {
  return (ESSENTIAL_TOOL_NAMES as readonly string[]).includes(name);
}

interface WorkspaceAuthorityEntry {
  readonly id: string;
  readonly displayName: string | null;
  readonly rootPath: string | null;
}

function workspaceAuthorityEntries(value: unknown): readonly WorkspaceAuthorityEntry[] {
  const entries = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.workspaces)
      ? value.workspaces
      : [];
  return entries
    .filter(isRecord)
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : '',
      displayName: typeof entry.displayName === 'string' ? entry.displayName : typeof entry.name === 'string' ? entry.name : null,
      rootPath: typeof entry.realRootPath === 'string' ? entry.realRootPath : typeof entry.rootPath === 'string' ? entry.rootPath : null,
    }))
    .filter((entry): entry is WorkspaceAuthorityEntry => entry.id.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkpointList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => checkpointString(entry, 500))
    .filter((entry): entry is string => entry !== undefined)
    .slice(0, MAX_CHECKPOINT_LIST_ITEMS);
}

function checkpointString(value: unknown, maxChars = MAX_CHECKPOINT_TEXT_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const redacted = value
    .replace(/(\bauthorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[redacted]')
    .replace(/\b(token|secret|password|api[_ -]?key|private[_ -]?key)\s*[:=]\s*[^\s]+/gi, '$1=[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[redacted-api-key]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return redacted.length === 0 ? undefined : redacted.slice(0, maxChars);
}

function continuityStatePath(runtimeStatePath: string): string {
  return `${runtimeStatePath}.continuity.json`;
}

async function readContinuityState(filePath: string): Promise<PersistedContinuityState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    const checkpoints = Array.isArray(record.checkpoints) ? record.checkpoints.filter(isCheckpoint) : [];
    return {
      checkpoints,
      ...(typeof record.lastCheckpointId === 'string' ? { lastCheckpointId: record.lastCheckpointId } : {}),
      ...(typeof record.lastProjectKey === 'string' ? { lastProjectKey: record.lastProjectKey } : {}),
    };
  } catch {
    return {};
  }
}

function dedupeCheckpoints(checkpoints: readonly SessionCheckpoint[]): SessionCheckpoint[] {
  const byId = new Map<string, SessionCheckpoint>();
  for (const checkpoint of checkpoints) byId.set(checkpoint.id, checkpoint);
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function withContinuityWriteLock(filePath: string, operation: () => Promise<void>): Promise<void> {
  const previous = continuityWriteLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  continuityWriteLocks.set(filePath, tail);
  await previous;
  try {
    await operation();
  } finally {
    release();
    if (continuityWriteLocks.get(filePath) === tail) continuityWriteLocks.delete(filePath);
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function hitRate(cache: CacheCounters): number {
  const total = cache.hits + cache.misses;
  return total === 0 ? 0 : Number((cache.hits / total).toFixed(4));
}

function publicTask(task: RuntimeTask): Omit<RuntimeTask, 'result'> & { readonly result?: unknown } {
  return { ...task };
}

function countKinds(entries: readonly { readonly kind: string }[]): Record<string, number> {
  return entries.reduce<Record<string, number>>((counts, entry) => { counts[entry.kind] = (counts[entry.kind] ?? 0) + 1; return counts; }, {});
}

function normalizeMode(value: string | undefined): 'compact' | 'normal' | 'verbose' | 'stream' {
  return value === 'compact' || value === 'verbose' || value === 'stream' ? value : 'normal';
}

function lifecycleEvents(): readonly string[] {
  return ['beforeTool', 'afterTool', 'beforeRead', 'afterRead', 'beforeWrite', 'afterWrite', 'beforeShell', 'afterShell', 'beforeGit', 'afterGit', 'beforeBrowser', 'afterBrowser'];
}

function primitiveEntry(name: string, description: string, permission: UpgradeToolCatalogEntry['permission'], tags: readonly string[]): SearchCatalogEntry {
  return { name, phase: 0, description, permission, tags, parallelSafe: permission === 'READ', primitive: true };
}

function capabilitySearchEntry(descriptor: CapabilityDescriptor): SearchCatalogEntry {
  return {
    name: descriptor.name,
    phase: 0,
    description: `${descriptor.name} local capability (${descriptor.auditTarget})`,
    permission: descriptor.permission,
    tags: [descriptor.name, descriptor.auditTarget, 'capability'],
    parallelSafe: descriptor.permission === 'READ',
    primitive: true,
    auditTarget: descriptor.auditTarget,
  };
}

function dedupeSearchEntries(entries: readonly SearchCatalogEntry[]): readonly SearchCatalogEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.name)) return false;
    seen.add(entry.name);
    return true;
  });
}

function scoreToolEntry(entry: SearchCatalogEntry, query: string, route: ReturnType<typeof routeIntent>, strategy: WseStrategy = 'baseline', experience?: { readonly successRate: number; readonly averageLatencyMs: number }): { readonly entry: SearchCatalogEntry; readonly score: number; readonly reasonCodes: readonly string[] } {
  if (query.length === 0) return { entry, score: 0, reasonCodes: ['empty-query'] };
  const queryTokens = tokenize(query);
  const nameTokens = tokenize(entry.name);
  const tagTokens = entry.tags.flatMap((tag) => tokenize(tag));
  const description = entry.description.toLowerCase();
  let score = 0;
  const reasons = new Set<string>();
  if (entry.name.toLowerCase() === query) {
    score += 2;
    reasons.add('exact-name');
  }
  if (entry.name.toLowerCase().includes(query)) {
    score += 1;
    reasons.add('name-phrase');
  }
  for (const token of queryTokens) {
    if (nameTokens.includes(token)) {
      score += 1;
      reasons.add(`name-token:${token}`);
    } else if (tagTokens.includes(token)) {
      score += 0.8;
      reasons.add(`tag-token:${token}`);
    } else if (description.includes(token)) {
      score += 0.25;
      reasons.add(`description-token:${token}`);
    }
  }
  if (route.route !== 'workspace' && entry.tags.some((tag) => route.route === tag || route.domain.split('/').some((part) => tag === part))) {
    score += 0.5;
    reasons.add(`route:${route.route}`);
  }
  if (entry.primitive === true) reasons.add('primitive-visible');
  if (strategy !== 'baseline' && experience !== undefined) {
    score += strategy === 'reliability-first'
      ? experience.successRate * 0.3
      : 0.3 / (1 + experience.averageLatencyMs / 1_000);
    reasons.add(`strategy:${strategy}`);
  }
  return { entry, score, reasonCodes: [...reasons] };
}

function toolExperienceStats(experiences: readonly WseExperience[]): Map<string, { readonly successRate: number; readonly averageLatencyMs: number }> {
  const grouped = new Map<string, WseExperience[]>();
  for (const experience of experiences) grouped.set(experience.toolName, [...(grouped.get(experience.toolName) ?? []), experience]);
  return new Map([...grouped.entries()].map(([toolName, entries]) => [toolName, {
    successRate: entries.filter((entry) => entry.outcome === 'success').length / entries.length,
    averageLatencyMs: entries.reduce((sum, entry) => sum + entry.durationMs, 0) / entries.length,
  }]));
}

function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9ก-๙]+/u)
    .filter((token) => token.length > 0);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function contractStatus(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const entry = UPGRADE_TOOL_CATALOG.find((candidate) => candidate.name === name);
  const status = entry?.availability ?? 'ready';
  return {
    tool: name,
    status,
    available: status === 'ready',
    ready: status === 'ready',
    phase: entry?.phase ?? null,
    ...(entry?.requirements === undefined ? {} : { requirements: entry.requirements }),
    supportsCancel: entry?.supportsCancel === true,
    supportsDryRun: entry?.supportsDryRun === true,
    ...(entry?.auditTarget === undefined ? {} : { auditTarget: entry.auditTarget }),
    executed: false,
    primitiveFallbacks: ['read_file', 'search_text', 'workspace_tree'],
    inputKeys: Object.keys(input).sort(),
    authorizationUnchanged: true,
  };
}

function routeIntent(prompt: string): {
  readonly route: string;
  readonly domain: string;
  readonly confidence: 'high' | 'medium';
  readonly selectedModel: 'deterministic';
  readonly reasonCodes: readonly string[];
  readonly authorizationUnchanged: true;
} {
  const normalized = prompt.toLowerCase();
  const rules: readonly { readonly route: string; readonly domain: string; readonly confidence: 'high' | 'medium'; readonly terms: readonly (readonly [string, string])[] }[] = [
    { route: 'debug', domain: 'desktop/mcp/logging', confidence: 'high' as const, terms: [['live log', 'live-logs'], ['mcp activity', 'mcp'], ['tunnel', 'tunnel'], ['stdio', 'stdio'], ['connect', 'connect'], ['debug', 'debug'], ['wsl', 'wsl'], ['timeout', 'timeout'], ['crash', 'crash']] },
    { route: 'test', domain: 'project/tests', confidence: 'high' as const, terms: [['test', 'test'], ['vitest', 'vitest'], ['jest', 'jest'], ['playwright', 'playwright'], ['pytest', 'pytest']] },
    { route: 'review', domain: 'git/code', confidence: 'high' as const, terms: [['review', 'review'], ['diff', 'diff'], ['pull request', 'pull-request'], ['changed', 'changed']] },
    { route: 'frontend', domain: 'browser/ui', confidence: 'medium' as const, terms: [['browser', 'browser'], ['ui', 'ui'], ['button', 'button'], ['dom', 'dom'], ['screenshot', 'screenshot']] },
    { route: 'release', domain: 'git/release', confidence: 'medium' as const, terms: [['release', 'release'], ['tag', 'tag'], ['publish', 'publish'], ['deploy', 'deploy']] },
  ];
  const scored = rules.map((rule, index) => ({
    ...rule,
    matches: rule.terms.filter(([term]) => normalized.includes(term)),
    index,
  })).filter((rule) => rule.matches.length > 0);
  const selected = scored.sort((left, right) => right.matches.length - left.matches.length || left.index - right.index)[0];
  if (selected === undefined) {
    return { route: 'workspace', domain: 'workspace/code', confidence: 'medium', selectedModel: 'deterministic', reasonCodes: ['fallback:workspace'], authorizationUnchanged: true };
  }
  return {
    route: selected.route,
    domain: selected.domain,
    confidence: selected.confidence,
    selectedModel: 'deterministic',
    reasonCodes: selected.matches.map(([, reason]) => `keyword:${reason}`),
    authorizationUnchanged: true,
  };
}

interface RecipeDefinition {
  readonly name: string;
  readonly description: string;
  readonly route: string;
  readonly steps: readonly string[];
  readonly permissions: readonly string[];
  readonly optional: boolean;
  readonly requiresConfirmation: boolean;
}

function activityEntries(activity: ActivityTracker | undefined, input: Record<string, unknown>): readonly Record<string, unknown>[] {
  const limit = boundedInteger(input.limit, 100, 1, 200);
  const phase = readString(input, 'phase');
  return (activity?.listRecent(limit * 2) ?? [])
    .filter((event) => phase === undefined || event.phase === phase)
    .slice(-limit)
    .map((event) => ({ callId: event.callId, toolName: event.toolName, phase: event.phase, resultCode: event.resultCode, durationMs: event.durationMs, timestamp: event.timestamp, ...(event.workspaceId === undefined ? {} : { workspaceId: event.workspaceId }) }));
}

function activityMetrics(events: readonly ActivitySinkEvent[]): Record<string, unknown> {
  const completed = events.filter((event) => event.phase === 'completed');
  const durations = completed.map((event) => event.durationMs);
  const errors = completed.filter((event) => event.resultCode !== 'SUCCESS').length;
  return {
    mcpCalls: completed.length,
    activeCalls: Math.max(0, events.filter((event) => event.phase === 'started').length - completed.length),
    averageLatencyMs: durations.length === 0 ? 0 : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p95LatencyMs: percentile95(durations),
    errors,
    successRate: completed.length === 0 ? 0 : Number(((completed.length - errors) / completed.length).toFixed(4)),
  };
}

function toWseExperience(event: ActivitySinkEvent): WseExperience {
  return {
    id: randomUUID(),
    callId: event.callId,
    toolName: event.toolName,
    resultCode: event.resultCode,
    durationMs: Math.max(0, Math.round(event.durationMs)),
    timestamp: event.timestamp,
    outcome: event.resultCode === 'SUCCESS' ? 'success' : 'failure',
    ...(event.workspaceId === undefined ? {} : { workspaceId: event.workspaceId }),
    ...(event.targetSummary === undefined ? {} : { targetDigest: createHash('sha256').update(event.targetSummary).digest('hex') }),
  };
}

function evaluateExperiences(experiences: readonly WseExperience[]): WseEvaluation {
  const durations = experiences.map((entry) => entry.durationMs);
  const successes = experiences.filter((entry) => entry.outcome === 'success').length;
  const failuresByCode = experiences.reduce<Record<string, number>>((counts, entry) => {
    if (entry.outcome === 'failure') counts[entry.resultCode] = (counts[entry.resultCode] ?? 0) + 1;
    return counts;
  }, {});
  return {
    sampleSize: experiences.length,
    successRate: experiences.length === 0 ? 0 : Number((successes / experiences.length).toFixed(4)),
    averageLatencyMs: durations.length === 0 ? 0 : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p95LatencyMs: percentile95(durations),
    failuresByCode,
    deterministic: true,
    rawPayloadsRetained: false,
  };
}

function scoreWseStrategies(experiences: readonly WseExperience[]): Record<string, unknown> {
  const evaluation = evaluateExperiences(experiences);
  const reliability = evaluation.successRate * 100;
  const latency = Math.max(0, 100 - Math.min(100, evaluation.p95LatencyMs / 20));
  const coverage = Math.min(100, evaluation.sampleSize * 5);
  const profiles: readonly { readonly strategy: WseStrategy; readonly reliabilityWeight: number; readonly latencyWeight: number }[] = [
    { strategy: 'baseline', reliabilityWeight: 0.7, latencyWeight: 0.3 },
    { strategy: 'reliability-first', reliabilityWeight: 0.85, latencyWeight: 0.15 },
    { strategy: 'latency-first', reliabilityWeight: 0.55, latencyWeight: 0.45 },
  ];
  return {
    sampleSize: evaluation.sampleSize,
    candidates: profiles.map((profile) => ({
      strategy: profile.strategy,
      score: Number(((reliability * profile.reliabilityWeight + latency * profile.latencyWeight) * (0.5 + coverage / 200)).toFixed(4)),
      reasonCodes: [`success-rate:${evaluation.successRate}`, `p95-latency-ms:${evaluation.p95LatencyMs}`, `sample-size:${evaluation.sampleSize}`],
      offlineOnly: true,
    })).sort((left, right) => right.score - left.score || left.strategy.localeCompare(right.strategy)),
    deterministic: true,
    automaticPromotion: false,
  };
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function isWseExperience(value: unknown): value is WseExperience {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<WseExperience>;
  return typeof entry.id === 'string' && typeof entry.callId === 'string' && typeof entry.toolName === 'string'
    && typeof entry.resultCode === 'string' && typeof entry.durationMs === 'number' && typeof entry.timestamp === 'string'
    && (entry.outcome === 'success' || entry.outcome === 'failure');
}

function isWseStrategy(value: unknown): value is WseStrategy {
  return value === 'baseline' || value === 'reliability-first' || value === 'latency-first';
}

function isWsePromotion(value: unknown): value is WsePromotion {
  if (typeof value !== 'object' || value === null) return false;
  const promotion = value as Partial<WsePromotion>;
  return typeof promotion.id === 'string' && (promotion.action === 'promote' || promotion.action === 'rollback')
    && isWseStrategy(promotion.previousStrategy) && isWseStrategy(promotion.activeStrategy)
    && typeof promotion.timestamp === 'string' && typeof promotion.evidenceDigest === 'string';
}

function isWseBenchmarkSnapshot(value: unknown): value is WseBenchmarkSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<WseBenchmarkSnapshot>;
  return typeof snapshot.id === 'string' && typeof snapshot.timestamp === 'string' && typeof snapshot.sampleSize === 'number'
    && typeof snapshot.successRate === 'number' && typeof snapshot.averageLatencyMs === 'number'
    && typeof snapshot.p95LatencyMs === 'number' && typeof snapshot.evidenceDigest === 'string';
}

function wseRegressionReport(snapshots: readonly WseBenchmarkSnapshot[]): Record<string, unknown> {
  if (snapshots.length < 2) return { status: 'insufficient_evidence', regressions: [], snapshotCount: snapshots.length, requiredSnapshots: 2, deterministic: true };
  const baseline = snapshots.at(-2)!;
  const current = snapshots.at(-1)!;
  const regressions: string[] = [];
  if (current.successRate < baseline.successRate) regressions.push('success_rate_decreased');
  if (current.p95LatencyMs > baseline.p95LatencyMs) regressions.push('p95_latency_increased');
  return {
    status: regressions.length === 0 ? 'pass' : 'regression',
    regressions,
    snapshotCount: snapshots.length,
    baseline,
    current,
    deltas: { successRate: Number((current.successRate - baseline.successRate).toFixed(4)), p95LatencyMs: current.p95LatencyMs - baseline.p95LatencyMs },
    deterministic: true,
  };
}

function recipeCatalog(): readonly RecipeDefinition[] {
  return [
    recipe('bugfix', 'Inspect, fix, and verify a code defect.', 'debug', ['workspace_context', 'git_context', 'test_context', 'live_logs_query'], ['filesystem.read', 'git.read'], false),
    recipe('code-review', 'Review changed code and affected tests.', 'review', ['review_context', 'changed_symbols', 'discover_tests'], ['filesystem.read', 'git.read'], false),
    recipe('frontend-debug', 'Inspect browser and UI evidence without assuming an attached browser.', 'frontend', ['debug_ui', 'console_context', 'network_context', 'capture_ui_state'], ['filesystem.read', 'browser.read'], true),
    recipe('release-check', 'Run the generic release evidence gate.', 'release', ['git_context', 'regression_report', 'benchmark_run'], ['filesystem.read', 'git.read', 'process.execute'], false),
    recipe('safe-git-commit-and-push', 'Inspect scope, verify, scan, commit, and push only task-owned changes.', 'release', ['git_status', 'git_diff', 'skill_match', 'project_test', 'git'], ['filesystem.read', 'git.read', 'process.execute', 'git.write', 'network.write'], true),
    recipe('nava-release-build-install-verify', 'Prepare a NAVA release gate; installation and restart require a later explicit confirmation.', 'release', ['diagnostic_bundle_create', 'git_context', 'discover_tests', 'project_lint', 'project_typecheck', 'project_build', 'regression_report'], ['filesystem.read', 'git.read', 'process.execute', 'filesystem.write'], true),
    recipe('mt5-seven-terminal-backtest', 'Prepare and track a dynamic seven-terminal MT5 validation run with external artifacts.', 'test', ['skills_list', 'workspace_context', 'shell', 'task_list', 'session_handoff'], ['filesystem.read', 'process.execute', 'filesystem.write'], true),
    recipe('obsidian-project-update', 'Read the vault schema and update durable project knowledge after validated work.', 'workspace', ['skills_list', 'workspace_context', 'read_many_files', 'write_file', 'git_diff'], ['filesystem.read', 'filesystem.write'], true),
    recipe('tunnel-reconnect-and-verify', 'Capture evidence, plan recovery, reconnect only with confirmation, then verify health.', 'debug', ['diagnostic_bundle_create', 'self_heal_plan', 'shell', 'mcp_health', 'diagnostic_bundle_create'], ['filesystem.read', 'process.execute'], true),
  ];
}

function recipe(name: string, description: string, route: string, steps: readonly string[], permissions: readonly string[], requiresConfirmation: boolean): RecipeDefinition {
  return { name, description, route, steps, permissions, optional: false, requiresConfirmation };
}

function planFor(prompt: string): { readonly route: string; readonly operations: readonly string[]; readonly permissions: readonly string[] } {
  const route = routeIntent(prompt);
  const operations = route.route === 'debug'
    ? ['workspace_context', 'git_context', 'live_logs_query', 'test_context']
    : route.route === 'test'
      ? ['workspace_context', 'discover_tests', 'test_context']
      : route.route === 'review'
        ? ['git_context', 'review_changes', 'changed_symbols', 'discover_tests']
        : ['workspace_context', 'repo_map'];
  return { route: route.route, operations, permissions: ['filesystem.read', 'git.read'] };
}

function permissionDecision(action: string): { readonly action: string; readonly decision: 'allow' | 'ask'; readonly class: string; readonly contextAccess: 'unrestricted' } {
  const normalized = action.toLowerCase();
  const dangerousAction = /(delete|destructive|admin|system\.admin|shell\.destructive|git\.destructive)/.test(normalized);
  return { action, decision: dangerousAction ? 'ask' : 'allow', class: dangerousAction ? 'dangerous' : 'read-or-safe', contextAccess: 'unrestricted' };
}

function parallelDelegatePlan(input: Record<string, unknown>): unknown {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const writesRequested = tasks.some((task) => typeof task === 'object' && task !== null && JSON.stringify(task).toLowerCase().includes('write'));
  return { tasks: tasks.map((task, index) => ({ id: `delegate-${index + 1}`, mode: writesRequested ? 'serialized-mutation' : 'read-only-parallel', inputDigest: digest(task) })), collisionDetected: writesRequested, mutationPolicy: 'one-writer-at-a-time', cancellationSupported: true };
}

function isRuntimeTask(value: unknown): value is RuntimeTask {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && (record.kind === 'task' || record.kind === 'delegate') && typeof record.createdAt === 'string' && typeof record.inputDigest === 'string' && (record.state === 'queued' || record.state === 'running' || record.state === 'completed' || record.state === 'cancelled');
}

function isCheckpoint(value: unknown): value is SessionCheckpoint {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.summary === 'string'
    && typeof record.inputDigest === 'string'
    && optionalString(record.projectKey)
    && optionalString(record.workspaceId)
    && optionalString(record.objective)
    && optionalString(record.phase)
    && optionalStringArray(record.completed)
    && optionalStringArray(record.files)
    && optionalStringArray(record.verification)
    && optionalStringArray(record.blockers)
    && optionalStringArray(record.boundaries)
    && optionalString(record.nextAction);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));
}

function isPlugin(value: unknown): value is { readonly name: string; readonly enabled: boolean } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string' && typeof record.enabled === 'boolean';
}

export function upgradeCatalogByName(name: string): UpgradeToolCatalogEntry | undefined {
  return UPGRADE_TOOL_CATALOG.find((entry) => entry.name === name);
}
