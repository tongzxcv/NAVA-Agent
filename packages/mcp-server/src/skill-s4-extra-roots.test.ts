import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_EXTENSIONS_SETTINGS, LocalExtensionsService } from '@lnwjud/extensions';
import type { FileActor } from '@lnwjud/application';
import { UpgradeRuntimeService } from './upgrade-runtime.js';
import { validLocalSkillId } from './skill-selection.js';

const actor: FileActor = { clientId: 's4-extra-roots', clientName: 'S4 Extra Root Test' };
const scratch: string[] = [];
afterAll(async () => { await Promise.all(scratch.map((name) => rm(name, { recursive: true, force: true }))); });

describe('S4 catalog source IDs and real extension integration', () => {
  it('accepts opaque discovered IDs from extra roots without weakening identity checks', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nava-s4-extra-roots-'));
    scratch.push(dir);
    const homeDir = path.join(dir, 'empty-home');
    const root = path.join(dir, 'S4 extra skills');
    const skillDir = path.join(root, 'thai-skill');
    await mkdir(homeDir, { recursive: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: ไทย-แยกโปรเจกต์',
      'description: Audits workspace isolation and writer lease overlap across parallel projects.',
      '---',
      '# Fixture',
      'Read-only content and no shell commands.',
    ].join('\n'), 'utf8');

    const extensions = new LocalExtensionsService({
      settings: { ...DEFAULT_EXTENSIONS_SETTINGS, extraSkillRoots: [root] },
      homeDir,
    });
    const listed = await extensions.listSkills({});
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('Catalog not available');
    expect(listed.value.skills).toHaveLength(1);
    const discovered = listed.value.skills[0]!;
    expect(discovered.id).toBe('extra:S4 extra skills/ไทย-แยกโปรเจกต์');
    expect(validLocalSkillId(discovered.id)).toBe(true);

    const runtime = new UpgradeRuntimeService({ extensions }, actor);
    const matched = await runtime.execute('skill_match', { query: 'แยกโปรเจกต์ เขียนพร้อมกัน' });
    expect(matched).toMatchObject({ ok: true, value: { skills: [expect.objectContaining({ id: discovered.id })] } });

    const loaded = await runtime.execute('skill_load', { skillId: discovered.id });
    expect(loaded).toMatchObject({
      ok: true,
      value: { loaded: true, skill: { id: discovered.id, name: discovered.name } },
    });

    for (const bad of ['../secret', 'extra:root/../escape', 'extra:root\\escape', 'extra:root/\u0000bad', 'extra:root/..', 'extra:root/.']) {
      expect(validLocalSkillId(bad)).toBe(false);
      expect(await runtime.execute('skill_load', { skillId: bad })).toMatchObject({ ok: false });
    }
    await extensions.close();
  });
});
