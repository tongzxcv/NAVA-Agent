import { describe, expect, it, vi } from 'vitest';
import { appError, err, ok } from '@lnwjud/domain';
import type { FileActor } from '@lnwjud/application';
import type { ExtensionsService, SkillSummary } from '@lnwjud/extensions';
import { UpgradeRuntimeService } from './upgrade-runtime.js';
import { ToolRegistry } from './tool-registry.js';
import { matchLocalSkills, validLocalSkillId } from './skill-selection.js';
import type { McpApplicationServices } from './tools/tool-types.js';

const actor: FileActor = { clientId: 'skill-router-s3', clientName: 'Skill Router Test' };

const summaries: readonly SkillSummary[] = [
  { id: 'claude-skills/nava-workspace-isolation-auditor', name: 'nava-workspace-isolation-auditor', description: 'Audits physical workspace independence, shared mutable runtime dependencies and writer lease overlap before parallel development.', source: 'claude-skills', rootPath: '/lab', skillPath: '/lab/workspace/SKILL.md' },
  { id: 'agents-skills/nava-workspace-isolation-auditor', name: 'nava-workspace-isolation-auditor', description: 'Audits physical workspace independence, shared mutable runtime dependencies and writer lease overlap before parallel development.', source: 'agents-skills', rootPath: '/other', skillPath: '/other/workspace/SKILL.md' },
  { id: 'claude-skills/nava-native-security-verifier', name: 'nava-native-security-verifier', description: 'Reviews Windows NTFS rename and ABA races, restricted Rust native broker, file write containment and security checks.', source: 'claude-skills', rootPath: '/lab', skillPath: '/lab/native/SKILL.md' },
  { id: 'claude-skills/nava-project-acceptance-gate', name: 'nava-project-acceptance-gate', description: 'Checks project release readiness, test evidence and production acceptance before deploy.', source: 'claude-skills', rootPath: '/lab', skillPath: '/lab/acceptance/SKILL.md' },
  { id: 'claude-skills/lumivara-offline-simulation-qa', name: 'lumivara-offline-simulation-qa', description: 'Tests Lumivara offline synthetic game state with inert adapters for Advanced Dismantle.', source: 'claude-skills', rootPath: '/lab', skillPath: '/lab/lumi/SKILL.md' },
];

function provider(skills: readonly SkillSummary[] = summaries, override?: Partial<ExtensionsService>): ExtensionsService {
  return {
    listSkills: vi.fn(async () => ok({ skills })),
    readSkill: vi.fn(async ({ skillId }: { readonly skillId: string }) => {
      const summary = skills.find((skill) => skill.id === skillId);
      if (summary === undefined) return err(appError('INVALID_INPUT', 'unknown skill'));
      return ok({ id: summary.id, name: summary.name, description: summary.description, source: summary.source, path: summary.skillPath, content: '# Safe test skill' });
    }),
    ...override,
  } as unknown as ExtensionsService;
}

function runtime(extensions?: ExtensionsService): UpgradeRuntimeService {
  return new UpgradeRuntimeService(extensions === undefined ? {} : { extensions }, actor);
}

describe('S3 deterministic skill selection', () => {
  it.each([
    ['Audit physical workspace isolation and shared runtime overlap', 'nava-workspace-isolation-auditor'],
    ['Validate Windows NTFS rename ABA with native Rust broker security', 'nava-native-security-verifier'],
    ['Review project release readiness and production acceptance before deploy', 'nava-project-acceptance-gate'],
    ['Test Lumivara offline synthetic game state for Advanced Dismantle', 'lumivara-offline-simulation-qa'],
  ])('matches %s', async (query, expected) => {
    const found = await runtime(provider()).execute('skill_match', { query });
    expect(found).toMatchObject({ ok: true, value: { deterministic: true, authorizationUnchanged: true, skills: [expect.objectContaining({ name: expected })] } });
  });

  it.each([
    ['ช่วยแยกโปรเจกต์เพื่อทำงานพร้อมกัน', 'nava-workspace-isolation-auditor'],
    ['ตรวจความปลอดภัยเนทีฟ', 'nava-native-security-verifier'],
    ['ตรวจรับงานให้พร้อมปล่อยเวอร์ชัน', 'nava-project-acceptance-gate'],
    ['ทดสอบออฟไลน์ ระบบย่อยอัตโนมัติของเกม', 'lumivara-offline-simulation-qa'],
  ])('routes Thai workflow %s', async (query, expected) => {
    const found = await runtime(provider()).execute('skill_match', { query });
    expect(found).toMatchObject({
      ok: true,
      value: { skills: [expect.objectContaining({ name: expected })], authorizationUnchanged: true },
    });
  });

  it('rejects unrelated Thai requests instead of guessing a skill', async () => {
    const found = await runtime(provider()).execute('skill_match', { query: 'ช่วยสรุปอีเมลล่าสุด' });
    expect(found).toMatchObject({ ok: true, value: { skills: [], reason: 'no_unambiguous_match' } });
  });

  it('deduplicates deterministic source precedence independent of discovery order', () => {
    const match = matchLocalSkills('Audit physical workspace isolation shared runtime', summaries.slice().reverse());
    expect(match).toHaveLength(1);
    expect(match[0]?.id).toBe('claude-skills/nava-workspace-isolation-auditor');
  });

  it('rejects weak queries and near-ties without guessing', () => {
    expect(matchLocalSkills('help', summaries)).toEqual([]);
    expect(matchLocalSkills('workspace isolation and Windows NTFS rename', [
      { ...summaries[0]!, name: 'alpha-workspace-isolation' },
      { ...summaries[0]!, id: 'x/beta-workspace-isolation', name: 'beta-workspace-isolation' },
    ])).toEqual([]);
  });

  it('does not return matches when provider absent or query exceeds limit', async () => {
    expect(await runtime().execute('skill_match', { query: 'workspace isolation' })).toMatchObject({ ok: true, value: { skills: [], reason: 'provider_unavailable' } });
    expect(await runtime(provider()).execute('skill_match', { query: 'x'.repeat(2049) })).toMatchObject({ ok: false });
  });

  it('preserves catalog errors rather than returning a fake success', async () => {
    const result = await runtime(provider(summaries, { listSkills: vi.fn(async () => err(appError('INVALID_INPUT', 'catalog unavailable'))) })).execute('skill_match', { query: 'workspace isolation' });
    expect(result).toMatchObject({ ok: false });
  });

  it('requires exact discovered identifier and rejects traversal', async () => {
    const ext = provider();
    for (const skillId of ['../evil', 'claude-skills/../escape', 'missing/something', 'claude-skills\\bad']) {
      const result = await runtime(ext).execute('skill_load', { skillId });
      expect(result).toMatchObject({ ok: false });
    }
    expect(ext.readSkill).not.toHaveBeenCalled();
    expect(validLocalSkillId('claude-skills/nava-project-acceptance-gate')).toBe(true);
  });

  it('loads only a verified exact skill through existing provider and does not execute content', async () => {
    const ext = provider();
    const result = await runtime(ext).execute('skill_load', { skillId: 'claude-skills/nava-project-acceptance-gate' });
    expect(result).toMatchObject({ ok: true, value: { loaded: true, authorizationUnchanged: true, skill: { name: 'nava-project-acceptance-gate', content: '# Safe test skill' } } });
    expect(ext.readSkill).toHaveBeenCalledTimes(1);
  });

  it('fails closed on catalog identity change and oversized content', async () => {
    const changed = provider(summaries, {
      readSkill: vi.fn(async () => ok({ id: 'claude-skills/different', name: 'changed', description: '', source: 'claude-skills', path: '/lab', content: 'bad' })),
    });
    expect(await runtime(changed).execute('skill_load', { skillId: summaries[0]!.id })).toMatchObject({ ok: false });
    const oversized = provider(summaries, {
      readSkill: vi.fn(async () => ok({ id: summaries[0]!.id, name: summaries[0]!.name, description: summaries[0]!.description, source: summaries[0]!.source, path: '/lab', content: 'x'.repeat(131073) })),
    });
    expect(await runtime(oversized).execute('skill_load', { skillId: summaries[0]!.id })).toMatchObject({ ok: false });
  });

  it('passes through the MCP ToolRegistry boundary', async () => {
    const registry = new ToolRegistry({ extensions: provider() } as McpApplicationServices, actor);
    const matched = await registry.invoke('skill_match', { query: 'physical workspace isolation shared runtime' });
    expect(matched.structuredContent).toMatchObject({ skills: [expect.objectContaining({ name: 'nava-workspace-isolation-auditor' })] });
    const loaded = await registry.invoke('skill_load', { skillId: summaries[0]!.id });
    expect(loaded.structuredContent).toMatchObject({ loaded: true, skill: { id: summaries[0]!.id } });
  });
});
