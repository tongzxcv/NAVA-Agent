import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import os from 'node:os';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { LocalExtensionsService, DEFAULT_EXTENSIONS_SETTINGS } from '../packages/extensions/dist/index.js';
import { UpgradeRuntimeService } from '../packages/mcp-server/dist/upgrade-runtime.js';

const provider = new LocalExtensionsService({ settings: DEFAULT_EXTENSIONS_SETTINGS, homeDir: os.homedir() });
const runtime = new UpgradeRuntimeService({ extensions: provider }, { clientId: 's4-real-skills-readonly', clientName: 'S4 Offline Skill Probe' });
const listed = await provider.listSkills({});
assert.equal(listed.ok, true, 'real Skill Catalog must enumerate');
const skills = listed.value.skills;
const required = [
  'nava-workspace-isolation-auditor',
  'nava-native-security-verifier',
  'nava-project-acceptance-gate',
  'lumivara-offline-simulation-qa',
];
const observed = [];
const prompts = [
 ['ช่วยแยกโปรเจกต์เพื่อทำงานพร้อมกัน', 'nava-workspace-isolation-auditor'],
 ['ตรวจความปลอดภัยเนทีฟ', 'nava-native-security-verifier'],
 ['ตรวจรับงานให้พร้อมปล่อยเวอร์ชัน', 'nava-project-acceptance-gate'],
 ['ทดสอบออฟไลน์ ระบบย่อยอัตโนมัติของเกม', 'lumivara-offline-simulation-qa'],
 ['Audit physical workspace isolation shared runtime', 'nava-workspace-isolation-auditor'],
 ['Validate NTFS rename ABA restricted Rust native broker security', 'nava-native-security-verifier'],
 ['Review project release readiness and production acceptance', 'nava-project-acceptance-gate'],
 ['Test Lumivara offline synthetic game state for Advanced Dismantle', 'lumivara-offline-simulation-qa'],
 ['ช่วยสรุปอีเมลล่าสุด', null],
];
for(const [prompt, expected] of prompts) {
  const result = await runtime.execute('skill_match', { query: prompt });
  assert.equal(result.ok, true, 'skill_match must succeed');
  const selected = result.value.skills.map(x => ({ id:x.id,name:x.name,score:x.score }));
  observed.push({ prompt, expected, selected });
}
assert.ok(skills.length >= 100, 'Expected populated real skill roots');
for (const item of observed) {
  if (item.expected === null) {
    assert.equal(item.selected.length, 0, 'Unrelated prompt must fail closed');
  } else {
    assert.equal(item.selected[0]?.name, item.expected, 'Top-ranked real Skill mismatch for '+item.prompt);
    assert.equal(item.selected[0]?.id, 'claude-skills/'+item.expected, 'Source precedence changed');
  }
}
const loaded=[];
for(const name of required) {
  const entry=skills.find(x=>x.name===name && x.source==='claude-skills');
  assert.ok(entry, 'required claude root Skill present: '+name);
  const result=await runtime.execute('skill_load', { skillId: entry.id });
  assert.equal(result.ok,true,'skill_load should succeed '+name);
  assert.equal(result.value.skill.id,entry.id);
  assert.equal(result.value.skill.name,entry.name);
  loaded.push({id:entry.id,sha256:createHash('sha256').update(result.value.skill.content).digest('hex'),bytes:Buffer.byteLength(result.value.skill.content)});
}
const denied = await runtime.execute('skill_load', { skillId:'../outside' });
assert.equal(denied.ok,false);
const summary={source:'real-local-home',totalSkills:skills.length,rootCounts:Object.fromEntries([...new Set(skills.map(x=>x.source))].map(source=>[source,skills.filter(x=>x.source===source).length])),observed,loaded,invalidIdDenied:true};
process.stdout.write('S4_REAL_SKILLS_RESULT='+JSON.stringify(summary)+'\n');
await provider.close();
