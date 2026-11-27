"use client";

import { useId, useRef, useState } from "react";
import { NO_SETUP_ID, PLAYBOOK_LIMITS } from "@/lib/playbooks";
import type { Playbook } from "@/lib/playbooks";
import {
  createPlaybook,
  newPlaybookItemId,
  setPlaybookArchived,
  updatePlaybook,
  usePlaybooks,
  validatePlaybookDraft,
  currentPlaybookVersion,
} from "@/lib/playbooks-store";
import type { PlaybookDraft } from "@/lib/playbooks-store";
import type { TradeStyle } from "@/lib/trades";
import { showToast } from "@/lib/toast";
import { keepDraft, readDraft } from "@/lib/ui";

const STYLE_LABEL: Record<TradeStyle, string> = { scalp: "Scalp", session_90m: "90m session", investment: "Investment" };
const STYLES = Object.keys(STYLE_LABEL) as TradeStyle[];

/** `null` id: a new playbook. Kept in memory so typing survives leaving Tune (docs/08, principle 6). */
interface Editing { id: string | null; draft: PlaybookDraft }
const DRAFT_KEY = "playbook-editor";

const toDraft = (playbook: Playbook): PlaybookDraft => ({
  name: playbook.name,
  default_style: playbook.default_style,
  checklist_rules: playbook.checklist_rules.map((rule) => ({ ...rule })),
});

/**
 * Tune → Playbooks (R-07b, docs/16 §R-07). Add, rename, restyle, reorder rules, archive.
 * There is no delete: past trades point at their playbook. A saved trade keeps the checklist
 * it was saved with, so nothing here rescores history (UX-50).
 */
export function PlaybookEditor() {
  const { playbooks, hydrated, saved } = usePlaybooks();
  const [editing, setEditingState] = useState<Editing | null>(() => readDraft<Editing>(DRAFT_KEY) ?? null);
  const [error, setError] = useState<string | null>(null);
  const setEditing = (next: Editing | null) => { setEditingState(keepDraft(DRAFT_KEY, next)); setError(null); };

  const active = playbooks.filter((item) => !item.archived);
  const archived = playbooks.filter((item) => item.archived);

  const changeDraft = (draft: PlaybookDraft) => {
    if (!editing) return;
    setEditingState(keepDraft(DRAFT_KEY, { ...editing, draft }));
    setError(null);
  };

  const save = (draft: PlaybookDraft) => {
    if (!editing) return;
    const result = editing.id ? updatePlaybook(editing.id, draft) : createPlaybook(draft);
    if (!result.ok) { setError(result.error); return; }
    setEditing(null);
    showToast(editing.id ? `Saved ${result.playbook.name}` : `Added ${result.playbook.name}`);
  };

  const archive = (playbook: Playbook, value: boolean) => {
    const result = setPlaybookArchived(playbook.id, value);
    if (!result.ok) { showToast(result.error); return; }
    if (editing?.id === playbook.id) setEditing(null);
    showToast(value ? `Archived ${playbook.name}` : `Restored ${playbook.name}`, value
      ? { label: "Undo", run: () => { setPlaybookArchived(playbook.id, false); } }
      : undefined);
  };

  return (
    <section className="specular-card card-pad playbook-editor" aria-label="Playbooks editor">
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        A playbook is a setup you trade and the rules you check for it. Trades you already saved keep the checklist they were saved with, so editing a rule here never changes your history.
      </p>
      {!saved && <div className="banner warn" role="status" style={{ margin: "12px 0 0" }}>Not saved — storage is blocked on this device. Changes last until you close the app.</div>}

      <ul className="playbook-list" aria-busy={!hydrated}>
        {active.map((playbook) => (
          <li key={playbook.id}>
            {editing?.id === playbook.id ? (
              <DraftForm editing={editing} onChange={changeDraft} error={error} onSave={save} onCancel={() => setEditing(null)} onArchive={playbook.id === NO_SETUP_ID ? undefined : () => archive(playbook, true)} />
            ) : (
              <div className="playbook-row">
                <span>
                  <b>{playbook.name}</b>
                  <small className="num">{STYLE_LABEL[playbook.default_style]} · v{currentPlaybookVersion(playbook.id) ?? 1} · {playbook.checklist_rules.length === 0 ? "no rules" : `${playbook.checklist_rules.length} ${playbook.checklist_rules.length === 1 ? "rule" : "rules"}`}</small>
                </span>
                <button type="button" className="btn-secondary" disabled={!hydrated} onClick={() => setEditing({ id: playbook.id, draft: toDraft(playbook) })} aria-label={`Edit playbook ${playbook.name}`} style={{ minHeight: 44 }}>Edit</button>
              </div>
            )}
          </li>
        ))}
        {editing && editing.id === null && (
          <li><DraftForm editing={editing} onChange={changeDraft} error={error} onSave={save} onCancel={() => setEditing(null)} /></li>
        )}
      </ul>

      {!editing && (
        <button type="button" className="btn-secondary" style={{ marginTop: 12, minHeight: 44 }} disabled={!hydrated} onClick={() => setEditing({ id: null, draft: { name: "", default_style: "scalp", checklist_rules: [] } })} aria-label="Create a new playbook">
          + New playbook
        </button>
      )}

      {archived.length > 0 && (
        <details className="advanced" style={{ marginTop: 14 }}>
          <summary>Archived <span className="num">{archived.length}</span></summary>
          <ul className="playbook-list">
            {archived.map((playbook) => (
              <li key={playbook.id} className="playbook-row archived">
                <span><b>{playbook.name}</b><small>Hidden from pickers. Past trades still show it.</small></span>
                <button type="button" className="btn-secondary" onClick={() => archive(playbook, false)} aria-label={`Restore playbook ${playbook.name}`} style={{ minHeight: 44 }}>Restore</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DraftForm({ editing, onChange, error, onSave, onCancel, onArchive }: {
  editing: Editing;
  onChange: (draft: PlaybookDraft) => void;
  error: string | null;
  onSave: (draft: PlaybookDraft) => void;
  onCancel: () => void;
  onArchive?: () => void;
}) {
  const id = useId();
  const { draft } = editing;
  const { playbooks } = usePlaybooks();
  const newRuleRef = useRef<HTMLInputElement>(null);
  const [newRule, setNewRule] = useState("");
  const noSetup = editing.id === NO_SETUP_ID;
  // Shown live so the Save button never surprises; the store checks again on save.
  const problem = error ?? (draft.name.trim() ? validatePlaybookDraft(draft, playbooks, editing.id) : null);
  const rules = draft.checklist_rules;
  const full = rules.length >= PLAYBOOK_LIMITS.rules;
  const nameProblem = Boolean(problem && /name|called/i.test(problem));

  const setRules = (next: PlaybookDraft["checklist_rules"]) => onChange({ ...draft, checklist_rules: next });
  const move = (index: number, by: -1 | 1) => {
    const next = [...rules];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setRules(next);
  };
  const addRule = () => {
    const label = newRule.trim();
    if (!label || full) return;
    setRules([...rules, { id: newPlaybookItemId(label, rules.map((rule) => rule.id)), label }]);
    setNewRule("");
    newRuleRef.current?.focus();
  };

  return (
    <form className="playbook-form" aria-label={editing.id ? `Edit ${draft.name || "playbook"}` : "New playbook"} onSubmit={(event) => {
      event.preventDefault();
      // A rule typed but not yet added is kept, never dropped on Save.
      const pendingRule = newRule.trim();
      onSave(pendingRule && !full ? { ...draft, checklist_rules: [...rules, { id: newPlaybookItemId(pendingRule, rules.map((rule) => rule.id)), label: pendingRule }] } : draft);
    }}>
      <label className="field" htmlFor={`playbook-name-${id}`}>
        <span>Name</span>
        <input
          id={`playbook-name-${id}`}
          value={draft.name}
          maxLength={PLAYBOOK_LIMITS.name}
          autoFocus={editing.id === null}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          aria-invalid={nameProblem || undefined}
          aria-label="Playbook name"
          placeholder="e.g. Gap Fill"
        />
      </label>

      <div className="field">
        <span id={`${id}-style`}>Default style</span>
        <div className="segmented" role="radiogroup" aria-labelledby={`${id}-style`}>
          {STYLES.map((style) => (
            <button
              key={style}
              type="button"
              role="radio"
              aria-checked={draft.default_style === style}
              onClick={() => onChange({ ...draft, default_style: style })}
              style={{ minHeight: 44 }}
            >
              {STYLE_LABEL[style]}
            </button>
          ))}
        </div>
      </div>

      {noSetup ? (
        <p className="hint muted" style={{ fontSize: 12, margin: 0 }}>No Setup / Impulse has no rules on purpose: Clean Run counts it as off-plan. Make a new playbook for a setup with rules.</p>
      ) : (
        <div className="field">
          <span>Rules <i className="num">{rules.length}/{PLAYBOOK_LIMITS.rules}</i></span>
          {rules.length === 0 && <span className="hint">No rules yet. A rule is one thing you check before you enter.</span>}
          <ol className="rule-list" aria-label="Playbook checklist rules">
            {rules.map((rule, index) => (
              <li key={rule.id}>
                <input
                  value={rule.label}
                  maxLength={PLAYBOOK_LIMITS.ruleLabel}
                  aria-label={`Rule ${index + 1} of ${rules.length}`}
                  aria-invalid={!rule.label.trim() || undefined}
                  onChange={(event) => setRules(rules.map((item) => (item.id === rule.id ? { ...item, label: event.target.value } : item)))}
                />
                <button type="button" className="icon-button small" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move rule ${index + 1} up`}>↑</button>
                <button type="button" className="icon-button small" disabled={index === rules.length - 1} onClick={() => move(index, 1)} aria-label={`Move rule ${index + 1} down`}>↓</button>
                <button type="button" className="icon-button small" onClick={() => setRules(rules.filter((item) => item.id !== rule.id))} aria-label={`Remove rule ${index + 1}: ${rule.label}`}>✕</button>
              </li>
            ))}
          </ol>
          <div className="rule-add">
            <input
              ref={newRuleRef}
              value={newRule}
              maxLength={PLAYBOOK_LIMITS.ruleLabel}
              disabled={full}
              placeholder={full ? `${PLAYBOOK_LIMITS.rules} rules is the limit` : "Add a rule"}
              aria-label="New rule text"
              onChange={(event) => setNewRule(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addRule(); } }}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={!newRule.trim() || full}
              onClick={addRule}
              aria-label="Add rule to checklist"
              style={{ minHeight: 44 }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {problem && <p className="error" role="alert" style={{ margin: 0, fontSize: 12 }}>{problem}</p>}
      {editing.id && !noSetup && <p className="hint muted" style={{ fontSize: 12, margin: 0 }}>New trades get these rules. Trades already saved keep theirs.</p>}

      <div className="playbook-actions">
        <button type="submit" className="btn-primary" disabled={!draft.name.trim() || Boolean(problem)} aria-label="Save playbook" style={{ minHeight: 44 }}>Save</button>
        <button type="button" className="btn-secondary" onClick={onCancel} aria-label="Cancel editing playbook" style={{ minHeight: 44 }}>Cancel</button>
        {onArchive && <button type="button" className="btn-ghost" onClick={onArchive} aria-label={`Archive playbook ${draft.name || ""}`} style={{ minHeight: 44 }}>Archive</button>}
      </div>
    </form>
  );
}
