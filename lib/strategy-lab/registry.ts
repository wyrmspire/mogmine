import { sessionClockSkill } from "./skills/clock.ts";
import { CONTEXT_SKILLS } from "./skills/context.ts";
import { levelMap, structureStop } from "./skills/levels.ts";
import { MEASURE_SKILLS } from "./skills/measure.ts";
import { MTF_SKILLS } from "./skills/mtf.ts";
import { VOLUME_SKILLS } from "./skills/volume-flow.ts";
import type { Skill, SkillMeta } from "./types.ts";

export type SkillRegistry = Readonly<Record<string, Skill>>;

function majorOf(version: string): number | null {
  const match = /^(0|[1-9]\d*)\.\d+\.\d+(?:[-+].+)?$/.exec(version);
  return match ? Number(match[1]) : null;
}

/** Create the immutable id@major registry used by runners, UI pickers and the agent API. */
export function createSkillRegistry(skills: readonly Skill[]): SkillRegistry {
  const entries: Record<string, Skill> = {};
  for (const skill of skills) {
    const major = majorOf(skill.meta.version);
    if (!skill.meta.id || major === null) throw new Error(`Invalid skill id/version: ${skill.meta.id}@${skill.meta.version}`);
    if (skill.meta.kind === "measure" !== (skill.meta.knownAt === "after-entry")) {
      throw new Error(`Invalid knownAt for ${skill.meta.id}: measures alone are after-entry`);
    }
    const key = `${skill.meta.id}@${major}`;
    if (entries[key]) throw new Error(`Duplicate Strategy Lab skill: ${key}`);
    entries[key] = skill;
  }
  return Object.freeze(entries);
}

/** Canonical MVP skill registry: S1–S9 (clock/mtf/levels/context), V1–V5 (volume), and M1–M3 (measures). */
export const SKILLS: SkillRegistry = createSkillRegistry([
  sessionClockSkill,
  ...MTF_SKILLS,
  levelMap,
  structureStop,
  ...CONTEXT_SKILLS,
  ...VOLUME_SKILLS,
  ...MEASURE_SKILLS,
]);

export function getSkill(ref: string, registry: SkillRegistry = SKILLS): Skill | undefined {
  if (ref.includes("@")) return registry[ref];
  let latest: { major: number; skill: Skill } | undefined;
  for (const [key, skill] of Object.entries(registry)) {
    const split = key.lastIndexOf("@");
    if (key.slice(0, split) !== ref) continue;
    const major = Number(key.slice(split + 1));
    if (!latest || major > latest.major) latest = { major, skill };
  }
  return latest?.skill;
}

export function listSkills(registry: SkillRegistry = SKILLS): SkillMeta[] {
  return Object.entries(registry)
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([, skill]) => skill.meta);
}
