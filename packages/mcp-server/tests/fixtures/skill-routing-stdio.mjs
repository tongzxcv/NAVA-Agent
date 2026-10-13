import { startMcpStdio } from '../../dist/stdio.js';
const summaries = [
  { id: 'fixture-skills/nava-workspace-isolation-auditor', name: 'nava-workspace-isolation-auditor', description: 'Audit physical workspace isolation shared mutable runtime and writer lease overlap', source: 'fixture-skills', rootPath: 'synthetic', skillPath: 'synthetic/workspace/SKILL.md' },
  { id: 'fixture-skills/nava-native-security-verifier', name: 'nava-native-security-verifier', description: 'Validate Windows NTFS rename ABA restricted Rust native broker security', source: 'fixture-skills', rootPath: 'synthetic', skillPath: 'synthetic/security/SKILL.md' },
];
startMcpStdio({
  services: {
    extensions: {
      async listSkills() { return { ok: true, value: { skills: summaries } }; },
      async readSkill({ skillId }) {
        const item = summaries.find((entry) => entry.id === skillId);
        if (!item) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Unknown fixture Skill', recoverable: false } };
        return { ok: true, value: { id: item.id, name: item.name, description: item.description, source: item.source, path: item.skillPath, content: '# Inert fixture Skill\nThis test never performs OS work.' } };
      },
    },
  },
  actor: { clientId: 's3-stdio-fixture', clientName: 's3-stdio-fixture' },
});
