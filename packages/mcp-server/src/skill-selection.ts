import type { SkillSummary } from '@lnwjud/extensions';

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'agent', 'also', 'and', 'are', 'before', 'can', 'check',
  'does', 'for', 'from', 'have', 'help', 'how', 'into', 'its', 'need', 'nava',
  'our', 'please', 'should', 'skill', 'skills', 'some', 'that', 'the', 'their',
  'then', 'this', 'use', 'using', 'when', 'with', 'work', 'works', 'would',
]);
const THAI_QUERY_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['แยกโปรเจกต์', ['workspace', 'isolation']],
  ['แยกเวิร์กสเปซ', ['workspace', 'isolation']],
  ['เขียนพร้อมกัน', ['writer', 'lease', 'parallel']],
  ['ทำงานพร้อมกัน', ['parallel', 'workspace']],
  ['ความปลอดภัยเนทีฟ', ['native', 'security']],
  ['เนทีฟ', ['native', 'security']],
  ['เนทิฟ', ['native', 'security']],
  ['ตรวจรับ', ['project', 'acceptance']],
  ['พร้อมปล่อย', ['release', 'readiness']],
  ['พร้อมใช้งานจริง', ['production', 'readiness']],
  ['ย่อยอัตโนมัติ', ['dismantle', 'offline']],
  ['จำลองเกม', ['simulation', 'game']],
  ['ทดสอบออฟไลน์', ['offline', 'synthetic']],
] as const;

const MAX_QUERY_LENGTH = 2048;
const MAX_CANDIDATES = 5;

function tokens(value: string, thaiQuery = false): readonly string[] {
  const lower = value.toLocaleLowerCase('en-US');
  const words = (lower.match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((part) => part.length >= 3 && part.length <= 48 && !STOP_WORDS.has(part));
  if (thaiQuery) {
    for (const [phrase, aliases] of THAI_QUERY_ALIASES) {
      if (lower.includes(phrase)) words.push(...aliases);
    }
  }
  return [...new Set(words)].slice(0, 96);
}

function sourceRank(source: string): number {
  if (source === 'claude-skills') return 0;
  if (source === 'agents-skills') return 1;
  return 2;
}

function scoreSkill(queryTokens: readonly string[], skill: SkillSummary): number {
  const name = new Set(tokens(skill.name));
  const description = new Set(tokens(skill.description));
  let score = 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (name.has(token)) {
      score += 6;
      hits++;
    } else if (description.has(token)) {
      score += 2;
      hits++;
    }
  }
  return hits >= 2 ? score : 0;
}

export interface SkillMatchCandidate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly score: number;
}

export function matchLocalSkills(query: string, available: readonly SkillSummary[]): readonly SkillMatchCandidate[] {
  if (query.length === 0 || query.length > MAX_QUERY_LENGTH) return [];
  const queryTokens = tokens(query, true);
  if (queryTokens.length < 2) return [];
  // An exact source takes precedence; duplicate labels must never load two instructions.
  const byName = new Map<string, SkillSummary>();
  const deterministic = [...available].sort((a, b) =>
    sourceRank(a.source) - sourceRank(b.source)
    || a.source.localeCompare(b.source)
    || a.id.localeCompare(b.id),
  );
  for (const skill of deterministic) {
    const key = skill.name.toLocaleLowerCase('en-US');
    if (key.length > 0 && !byName.has(key)) byName.set(key, skill);
  }
  const ranked = [...byName.values()]
    .map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, source: skill.source, score: scoreSkill(queryTokens, skill) }))
    .filter((skill) => skill.score >= 8)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  // Insufficient evidence or ambiguous top-ranked candidates: fail closed.
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0]!.score - ranked[1]!.score < 3)) return [];
  return ranked.slice(0, MAX_CANDIDATES);
}

export function validLocalSkillId(value: string): boolean {
  // The catalog has IDs from `extra:<root-name>` as well as built-in sources.
  // Treat the discovered ID as an opaque identifier, not as a filesystem path.
  if (value.length < 3 || value.length > 512 || !/^[^\\/\p{C}]{1,256}\/[^\\/\p{C}]{1,256}$/u.test(value)) return false;
  return value.split('/').every((segment) => segment.trim() !== '.' && segment.trim() !== '..');
}
