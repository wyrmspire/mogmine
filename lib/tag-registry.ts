// PL-3: the setup and execution tag vocabulary as data (docs/design-2026-11-24/01-playbook-lab.md §5, Q-6).
// Pure: no React, no storage, no network. Seeds come from SETUP_TAGS and EXECUTION_TAGS in lib/playbooks.ts, so a
// device that never edited the list sees exactly today's tags. Trades keep storing labels in `quick_tags`; this
// registry maps a label, or an old alias of one, to its definition. Retired tags stay resolvable, never hard-deleted.
import { EXECUTION_TAGS, SETUP_TAGS } from "./playbooks.ts";
import { MOVED_STOP_TAG } from "./trades.ts";

export const TAG_LIMITS = { label: 40, description: 160, aliases: 10, playbookIds: 20 } as const;

export type TagKind = "setup" | "execution";

export interface TagDef {
  /** `seed:<kind>:<slug>` for the starting tags, `tag:<kind>:<slug>-<random>` for added ones. Never changes after creation. */
  id: string;
  /** Unique (case-insensitive) across active and retired tags of both kinds. */
  label: string;
  description: string;
  /** Retired tags stay resolvable so old trades still show their tags; they are never offered for new trades. */
  retired: boolean;
  /** Previous labels, kept when a tag is renamed so old `quick_tags` still resolve. */
  aliases: string[];
  /** Playbooks this tag belongs to. Empty means any playbook. */
  playbook_ids: string[];
}

export interface TagRegistry {
  setup: TagDef[];
  execution: TagDef[];
}

export type TagResult = { ok: true; registry: TagRegistry } | { ok: false; error: string };

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tag";

const seedTag = (kind: TagKind, label: string): TagDef => ({
  id: `seed:${kind}:${slug(label)}`, label, description: "", retired: false, aliases: [], playbook_ids: [],
});

/** The starting vocabulary: today's constants, active, with no descriptions or playbook links. */
export const DEFAULT_TAG_REGISTRY: TagRegistry = {
  setup: SETUP_TAGS.map((label) => seedTag("setup", label)),
  execution: EXECUTION_TAGS.map((label) => seedTag("execution", label)),
};

/** Collapse runs of whitespace, trim, and cap the length. */
function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A tag label as typed and matched: trimmed, single spaces. Length is checked by the callers, never cut silently. */
export function cleanTagLabel(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function cloneDef(def: TagDef): TagDef {
  return { ...def, aliases: [...def.aliases], playbook_ids: [...def.playbook_ids] };
}

function readDef(raw: unknown, kind: TagKind): TagDef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const label = cleanTagLabel(item.label).slice(0, TAG_LIMITS.label);
  if (!label) return null;
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 120) : `tag:${kind}:${slug(label)}`;
  const aliases = Array.isArray(item.aliases) ? item.aliases.map((alias) => cleanTagLabel(alias).slice(0, TAG_LIMITS.label)).filter(Boolean) : [];
  const playbookIds = Array.isArray(item.playbook_ids)
    ? item.playbook_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim().slice(0, 200))
    : [];
  return {
    id,
    label,
    description: cleanText(item.description, TAG_LIMITS.description),
    retired: item.retired === true,
    aliases,
    playbook_ids: [...new Set(playbookIds)].slice(0, TAG_LIMITS.playbookIds),
  };
}

/**
 * Makes any stored value safe to use. A missing or junk group falls back to its seeds; a junk item is dropped.
 * Labels are unique across both kinds (first one wins), and an alias never shadows another tag's label.
 * `Moved Stop` always exists and is active: the stop-move suggestion and the violation check depend on it.
 */
export function sanitizeTagRegistry(raw: unknown): TagRegistry {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const readGroup = (kind: TagKind): TagDef[] => {
    const list = source?.[kind];
    if (!Array.isArray(list)) return DEFAULT_TAG_REGISTRY[kind].map(cloneDef);
    return list.map((item) => readDef(item, kind)).filter((def): def is TagDef => def !== null);
  };

  let execution = readGroup("execution");
  const movedStop = execution.find((def) => sameLabel(def.label, MOVED_STOP_TAG));
  if (movedStop) {
    movedStop.retired = false;
  } else {
    execution = [...execution, seedTag("execution", MOVED_STOP_TAG)];
  }

  // Labels first (execution before setup, so Moved Stop wins a clash), then aliases against every label.
  const taken = new Set<string>();
  const kept: Array<{ def: TagDef; kind: TagKind }> = [];
  for (const [kind, group] of [["execution", execution], ["setup", readGroup("setup")]] as const) {
    for (const def of group) {
      const key = def.label.toLowerCase();
      if (taken.has(key)) continue;
      taken.add(key);
      kept.push({ def, kind });
    }
  }
  for (const { def } of kept) {
    const aliases: string[] = [];
    for (const alias of def.aliases) {
      const key = alias.toLowerCase();
      if (taken.has(key) || aliases.some((seen) => sameLabel(seen, alias))) continue;
      aliases.push(alias);
      taken.add(key);
    }
    def.aliases = aliases.slice(0, TAG_LIMITS.aliases);
  }

  return {
    setup: kept.filter((item) => item.kind === "setup").map((item) => item.def),
    execution: kept.filter((item) => item.kind === "execution").map((item) => item.def),
  };
}

/** True when a registry holds anything beyond the starting tags (so a backup with only custom tags still restores). */
export function tagRegistryDiffersFromSeeds(reg: TagRegistry): boolean {
  return JSON.stringify(sanitizeTagRegistry(reg)) !== JSON.stringify(sanitizeTagRegistry(DEFAULT_TAG_REGISTRY));
}

export function activeSetupTagLabels(reg: TagRegistry): string[] {
  return reg.setup.filter((def) => !def.retired).map((def) => def.label);
}

export function activeExecutionTagLabels(reg: TagRegistry): string[] {
  return reg.execution.filter((def) => !def.retired).map((def) => def.label);
}

/** The definition a stored label names: its current label first, then any alias. Retired tags resolve too. */
export function resolveTagLabel(reg: TagRegistry, rawLabel: string): { def: TagDef; kind: TagKind } | null {
  const wanted = cleanTagLabel(rawLabel);
  if (!wanted) return null;
  for (const kind of ["setup", "execution"] as const) {
    const def = reg[kind].find((item) => sameLabel(item.label, wanted));
    if (def) return { def, kind };
  }
  for (const kind of ["setup", "execution"] as const) {
    const def = reg[kind].find((item) => item.aliases.some((alias) => sameLabel(alias, wanted)));
    if (def) return { def, kind };
  }
  return null;
}

/** Every label and alias in use, across both kinds. A new label may not collide with any of them. */
function labelsInUse(reg: TagRegistry, exceptId: string | null): string[] {
  return (["setup", "execution"] as const).flatMap((kind) =>
    reg[kind].filter((def) => def.id !== exceptId).flatMap((def) => [def.label, ...def.aliases]));
}

function findDef(reg: TagRegistry, id: string): { kind: TagKind; def: TagDef } | null {
  for (const kind of ["setup", "execution"] as const) {
    const def = reg[kind].find((item) => item.id === id);
    if (def) return { kind, def };
  }
  return null;
}

/** Replaces one definition by id. Only the touched kind's array is rebuilt. */
function replaceDef(reg: TagRegistry, kind: TagKind, next: TagDef): TagRegistry {
  return { ...reg, [kind]: reg[kind].map((def) => (def.id === next.id ? next : def)) };
}

function newTagId(kind: TagKind, label: string, reg: TagRegistry): string {
  const taken = new Set([...reg.setup, ...reg.execution].map((def) => def.id));
  let id = "";
  do {
    id = `tag:${kind}:${slug(label)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (taken.has(id));
  return id;
}

function labelClash(reg: TagRegistry, label: string, exceptId: string | null): string | null {
  const hit = labelsInUse(reg, exceptId).find((name) => sameLabel(name, label));
  if (!hit) return null;
  const owner = resolveTagLabel(reg, hit);
  const retired = owner?.def.retired ? " It is retired: restore it or pick another name." : " Pick another name.";
  return `A tag called “${hit}” already exists.${retired}`;
}

export interface TagDraft {
  label: string;
  description?: string;
  playbook_ids?: string[];
}

/** Adds an active tag at the end of its group. The label must be new across both kinds, retired ones included. */
export function addTag(reg: TagRegistry, kind: TagKind, draft: TagDraft): TagResult {
  const label = cleanTagLabel(draft.label);
  if (!label) return { ok: false, error: "Give the tag a name." };
  if (label.length > TAG_LIMITS.label) return { ok: false, error: `Keep the name to ${TAG_LIMITS.label} characters.` };
  const clash = labelClash(reg, label, null);
  if (clash) return { ok: false, error: clash };
  const def: TagDef = {
    id: newTagId(kind, label, reg),
    label,
    description: cleanText(draft.description, TAG_LIMITS.description),
    retired: false,
    aliases: [],
    playbook_ids: [...new Set(draft.playbook_ids ?? [])].slice(0, TAG_LIMITS.playbookIds),
  };
  return { ok: true, registry: { ...reg, [kind]: [...reg[kind], def] } };
}

/**
 * Renames a tag. The old label moves into `aliases`, so trades saved with it still resolve. A new name that matches
 * another tag's label or alias (case-insensitive) is refused.
 */
export function renameTag(reg: TagRegistry, id: string, rawLabel: string): TagResult {
  const found = findDef(reg, id);
  if (!found) return { ok: false, error: "That tag no longer exists." };
  const label = cleanTagLabel(rawLabel);
  if (!label) return { ok: false, error: "Give the tag a name." };
  if (label.length > TAG_LIMITS.label) return { ok: false, error: `Keep the name to ${TAG_LIMITS.label} characters.` };
  const clash = labelClash(reg, label, id);
  if (clash) return { ok: false, error: clash };
  const { def, kind } = found;
  const aliases = sameLabel(def.label, label) ? def.aliases : [...def.aliases, def.label];
  const unique = aliases.filter((alias, index) => !sameLabel(alias, label) && aliases.findIndex((other) => sameLabel(other, alias)) === index);
  return { ok: true, registry: replaceDef(reg, kind, { ...def, label, aliases: unique.slice(-TAG_LIMITS.aliases) }) };
}

export function updateTagDescription(reg: TagRegistry, id: string, description: string): TagResult {
  const found = findDef(reg, id);
  if (!found) return { ok: false, error: "That tag no longer exists." };
  return { ok: true, registry: replaceDef(reg, found.kind, { ...found.def, description: cleanText(description, TAG_LIMITS.description) }) };
}

export function setTagPlaybooks(reg: TagRegistry, id: string, playbookIds: string[]): TagResult {
  const found = findDef(reg, id);
  if (!found) return { ok: false, error: "That tag no longer exists." };
  const clean = [...new Set(playbookIds.filter((item) => typeof item === "string" && item.trim().length > 0))].slice(0, TAG_LIMITS.playbookIds);
  return { ok: true, registry: replaceDef(reg, found.kind, { ...found.def, playbook_ids: clean }) };
}

/** Retiring hides a tag from new trades. It never deletes one, and `Moved Stop` cannot be retired at all. */
export function retireTag(reg: TagRegistry, id: string): TagResult {
  const found = findDef(reg, id);
  if (!found) return { ok: false, error: "That tag no longer exists." };
  if (found.kind === "execution" && sameLabel(found.def.label, MOVED_STOP_TAG)) {
    return { ok: false, error: `${MOVED_STOP_TAG} stays active: stop-move warnings depend on it.` };
  }
  return { ok: true, registry: replaceDef(reg, found.kind, { ...found.def, retired: true }) };
}

export function restoreTag(reg: TagRegistry, id: string): TagResult {
  const found = findDef(reg, id);
  if (!found) return { ok: false, error: "That tag no longer exists." };
  return { ok: true, registry: replaceDef(reg, found.kind, { ...found.def, retired: false }) };
}
