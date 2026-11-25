"use client";

import { useId, useState } from "react";
import { TAG_LIMITS, cleanTagLabel } from "@/lib/tag-registry";
import type { TagDef, TagKind, TagResult } from "@/lib/tag-registry";
import { addTag, renameTag, restoreTag, retireTag, setTagPlaybooks, updateTagDescription, useTagRegistry } from "@/lib/tag-registry-store";
import { usePlaybooks } from "@/lib/playbooks-store";
import { MOVED_STOP_TAG } from "@/lib/trades";
import { showToast } from "@/lib/toast";

const KINDS: TagKind[] = ["setup", "execution"];
const KIND_TITLE: Record<TagKind, string> = { setup: "Setup tags", execution: "Execution tags" };
const KIND_NEW: Record<TagKind, string> = { setup: "+ New setup tag", execution: "+ New execution tag" };

interface Draft { label: string; description: string; playbookIds: string[] }
/** `id` null is a new tag of `kind`. */
interface Editing { kind: TagKind; id: string | null; draft: Draft; error: string | null }

const draftOf = (def: TagDef): Draft => ({ label: def.label, description: def.description, playbookIds: [...def.playbook_ids] });
const blankDraft = (): Draft => ({ label: "", description: "", playbookIds: [] });
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** The steps that turn a saved tag into the draft. Each one is a store call; the first refusal stops the rest. */
function stepsFor(def: TagDef | undefined, id: string | null, kind: TagKind, draft: Draft): Array<() => TagResult> {
  if (!def || id === null) {
    return [() => addTag(kind, { label: draft.label, description: draft.description, playbook_ids: draft.playbookIds })];
  }
  const steps: Array<() => TagResult> = [];
  if (cleanTagLabel(draft.label) !== def.label) steps.push(() => renameTag(id, draft.label));
  if (draft.description.trim() !== def.description) steps.push(() => updateTagDescription(id, draft.description));
  if (!sameIds(draft.playbookIds, def.playbook_ids)) steps.push(() => setTagPlaybooks(id, draft.playbookIds));
  return steps;
}

/**
 * Tune → Tags (PL-3, docs/design-2026-11-24/01-playbook-lab.md §5). Setup and execution tags: add, rename, describe,
 * link to playbooks, retire and restore. Nothing is deleted: a renamed tag keeps its old name as an alias, and a retired
 * tag still resolves on old trades. `Moved Stop` cannot be retired.
 */
export function TagRegistryEditor() {
  const registry = useTagRegistry();
  const { playbooks } = usePlaybooks();
  const [editing, setEditing] = useState<Editing | null>(null);
  const activePlaybooks = playbooks.filter((playbook) => !playbook.archived);

  const start = (kind: TagKind, def: TagDef | null) => setEditing({ kind, id: def?.id ?? null, draft: def ? draftOf(def) : blankDraft(), error: null });

  const save = () => {
    if (!editing) return;
    const { kind, id, draft } = editing;
    const def = id ? registry[kind].find((item) => item.id === id) : undefined;
    for (const step of stepsFor(def, id, kind, draft)) {
      const result = step();
      if (!result.ok) { setEditing({ ...editing, error: result.error }); return; }
    }
    setEditing(null);
    showToast(def ? `Saved ${cleanTagLabel(draft.label)}` : `Added ${cleanTagLabel(draft.label)}`);
  };

  const retire = (def: TagDef) => {
    const result = retireTag(def.id);
    if (!result.ok) { showToast(result.error); return; }
    if (editing?.id === def.id) setEditing(null);
    showToast(`Retired ${def.label}`, { label: "Undo", run: () => { restoreTag(def.id); } });
  };

  const restore = (def: TagDef) => {
    const result = restoreTag(def.id);
    if (!result.ok) { showToast(result.error); return; }
    showToast(`Restored ${def.label}`);
  };

  const playbookNames = (def: TagDef) => def.playbook_ids
    .map((id) => playbooks.find((playbook) => playbook.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  const changeDraft = (draft: Draft) => { if (editing) setEditing({ ...editing, draft, error: null }); };

  return (
    <section className="specular-card card-pad tag-registry-editor" aria-label="Tags editor" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Tags</h2>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        Setup tags say what the trade was; execution tags say how you ran it. Renaming keeps the old name working on saved trades. A retired tag stops appearing for new trades and still shows on old ones.
      </p>

      {KINDS.map((kind) => {
        const active = registry[kind].filter((def) => !def.retired);
        const retired = registry[kind].filter((def) => def.retired);
        const formOpen = editing?.kind === kind;
        return (
          <div key={kind} className="tag-group" style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 15, margin: "0 0 6px" }}>{KIND_TITLE[kind]} <span className="num muted">{active.length}</span></h3>
            <ul className="playbook-list">
              {active.map((def) => (
                <li key={def.id}>
                  {formOpen && editing?.id === def.id ? (
                    <TagForm editing={editing} playbooks={activePlaybooks} onChange={changeDraft} onSave={save} onCancel={() => setEditing(null)} onRetire={def.label === MOVED_STOP_TAG ? undefined : () => retire(def)} />
                  ) : (
                    <div className="playbook-row">
                      <span>
                        <b>{def.label}</b>
                        <small>
                          {def.description || "No description"}
                          {" · "}
                          {playbookNames(def).length > 0 ? playbookNames(def).join(", ") : "Any playbook"}
                          {def.aliases.length > 0 ? ` · also matches ${def.aliases.join(", ")}` : ""}
                        </small>
                      </span>
                      <button type="button" className="btn-secondary" onClick={() => start(kind, def)} aria-label={`Edit tag ${def.label}`} style={{ minHeight: 44 }}>Edit</button>
                    </div>
                  )}
                </li>
              ))}
              {formOpen && editing?.id === null && (
                <li><TagForm editing={editing} playbooks={activePlaybooks} onChange={changeDraft} onSave={save} onCancel={() => setEditing(null)} /></li>
              )}
            </ul>
            {!editing && (
              <button type="button" className="btn-secondary" style={{ marginTop: 10, minHeight: 44 }} onClick={() => start(kind, null)} aria-label={`Add a ${kind} tag`}>
                {KIND_NEW[kind]}
              </button>
            )}
            {retired.length > 0 && (
              <details className="advanced" style={{ marginTop: 12 }}>
                <summary>Retired <span className="num">{retired.length}</span></summary>
                <ul className="playbook-list">
                  {retired.map((def) => (
                    <li key={def.id} className="playbook-row archived">
                      <span><b>{def.label}</b><small>Hidden from new trades. Old trades still show it.</small></span>
                      <button type="button" className="btn-secondary" onClick={() => restore(def)} aria-label={`Restore tag ${def.label}`} style={{ minHeight: 44 }}>Restore</button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}

function TagForm({ editing, playbooks, onChange, onSave, onCancel, onRetire }: {
  editing: Editing;
  playbooks: ReadonlyArray<{ id: string; name: string }>;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  onRetire?: () => void;
}) {
  const id = useId();
  const { draft, error } = editing;
  const togglePlaybook = (playbookId: string, on: boolean) => {
    const next = on ? [...draft.playbookIds, playbookId] : draft.playbookIds.filter((item) => item !== playbookId);
    onChange({ ...draft, playbookIds: next });
  };
  const field = { width: "100%", minHeight: 44, boxSizing: "border-box" as const };

  return (
    <form className="tag-form" onSubmit={(event) => { event.preventDefault(); onSave(); }} style={{ display: "grid", gap: 10, padding: "8px 0" }}>
      <label htmlFor={`${id}-label`}>Name</label>
      <input id={`${id}-label`} value={draft.label} maxLength={TAG_LIMITS.label} onChange={(event) => onChange({ ...draft, label: event.target.value })} style={field} autoComplete="off" />

      <label htmlFor={`${id}-description`}>Description <small className="muted">(optional)</small></label>
      <textarea id={`${id}-description`} value={draft.description} maxLength={TAG_LIMITS.description} rows={2} onChange={(event) => onChange({ ...draft, description: event.target.value })} style={{ ...field, minHeight: 64 }} />

      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 13, marginBottom: 4 }}>Playbooks <small className="muted">(none ticked means any playbook)</small></legend>
        {playbooks.map((playbook) => (
          <label key={playbook.id} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
            <input type="checkbox" checked={draft.playbookIds.includes(playbook.id)} onChange={(event) => togglePlaybook(playbook.id, event.target.checked)} style={{ width: 20, height: 20 }} />
            {playbook.name}
          </label>
        ))}
      </fieldset>

      {error && <p role="alert" style={{ color: "var(--danger, #f87171)", margin: 0, fontSize: 13 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="submit" className="btn-primary" style={{ minHeight: 44 }}>Save</button>
        <button type="button" className="btn-secondary" onClick={onCancel} style={{ minHeight: 44 }}>Cancel</button>
        {onRetire && <button type="button" className="btn-secondary" onClick={onRetire} style={{ minHeight: 44 }}>Retire</button>}
      </div>
    </form>
  );
}
