"use client";

import { useMemo, useState } from "react";
import { ONE_TAP_MOOD_SCORE, dominantSpoke, spokeChipLabel } from "@/lib/mood";
import type { MoodVector } from "@/lib/mood";
import { recordUserMood, setSpokeScore, undoMoodRecord, useMood } from "@/lib/mood-store";
import { EXECUTION_TAGS, SETUP_TAGS, checklistFor, playbookName } from "@/lib/playbooks";
import { activePlaybooks, usePlaybooks } from "@/lib/playbooks-store";
import { getTrade, updateTrade, useJournal } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { adherence } from "@/lib/trades";
import type { TradeRecord } from "@/lib/trades";
import { MoodShape } from "./MoodShape";
import { useInlineSaveText } from "./useSaveLabel";

export const QUICK_TAKEAWAY_HINT = "One-line takeaway for cards & feed — reasoning/lesson only, no prices or R";

type StageId = "before" | "during" | "after";
type StageField = "pre_trade_thesis" | "management_notes" | "post_exit_notes";

interface JournalStage {
  id: StageId;
  field: StageField;
  label: string;
  prompt: string;
  ariaLabel: string;
  hindsight?: boolean;
}

export const JOURNAL_STAGES: readonly JournalStage[] = [
  {
    id: "before",
    field: "pre_trade_thesis",
    label: "Before Entry",
    prompt: "Why was this setup worth taking?",
    ariaLabel: "Before Entry: Thesis and invalidation",
  },
  {
    id: "during",
    field: "management_notes",
    label: "During Trade",
    prompt: "How did you manage the hold, trail, or hesitation?",
    ariaLabel: "During Trade: Management notes",
  },
  {
    id: "after",
    field: "post_exit_notes",
    label: "After Exit",
    prompt: "Lesson to repeat or change next time (skip exit reason/prices).",
    ariaLabel: "After Exit: Lesson and hindsight",
    hindsight: true,
  },
];

function byUsage<T extends string>(items: T[], counts: Map<string, number>) {
  return [...items].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
}

function initialStage(trade: Pick<TradeRecord, StageField>, open: boolean): StageId {
  if (trade.pre_trade_thesis.trim()) return "before";
  if (trade.management_notes.trim()) return "during";
  if (trade.post_exit_notes.trim()) return "after";
  return open ? "during" : "before";
}

interface TradeNotesPanelProps {
  trade: TradeRecord;
  open?: boolean;
  shield?: boolean;
  /** Keep "review-note" on the visible primary mount so the N shortcut focuses cleanly. */
  noteInputId?: string;
}

/**
 * Trade Detail journaling panel: separates the 1-line Quick Takeaway (`note`) shown on Feed &
 * Trade Cards from the 3-Stage Journal (`pre_trade_thesis`, `management_notes`, `post_exit_notes`),
 * paired with Pit Stop playbooks, quick tags, rules, and instant device autosave.
 */
export function TradeNotesPanel({ trade, open = false, shield = false, noteInputId = "review-note" }: TradeNotesPanelProps) {
  const journal = useJournal();
  const { playbooks: allPlaybooks } = usePlaybooks();
  const [stageId, setStageId] = useState<StageId>(() => initialStage(trade, open));

  const { playbooks, setupTags, executionTags, last } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of journal.trades) {
      if (item.is_sample !== trade.is_sample) continue;
      if (item.playbook_id) counts.set(item.playbook_id, (counts.get(item.playbook_id) ?? 0) + 1);
      for (const tag of item.quick_tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const ordered = activePlaybooks(allPlaybooks, trade.playbook_id).slice().sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
    const previous = journal.trades.find((item) => item.id !== trade.id && item.is_sample === trade.is_sample && Date.parse(item.entry_time) < Date.parse(trade.entry_time) && (item.playbook_id || item.quick_tags.length));
    return { playbooks: ordered, setupTags: byUsage(SETUP_TAGS, counts), executionTags: byUsage(EXECUTION_TAGS, counts), last: previous };
  }, [journal.trades, allPlaybooks, trade.id, trade.is_sample, trade.entry_time, trade.playbook_id]);

  const setPlaybook = (id: string) => {
    if (trade.playbook_id === id) {
      const before = { playbook_id: trade.playbook_id, checklist_state: trade.checklist_state };
      updateTrade(trade.id, { playbook_id: null, checklist_state: [] });
      showToast(`Removed ${playbookName(id, allPlaybooks)}`, { label: "Undo", run: () => updateTrade(trade.id, before) });
    } else {
      updateTrade(trade.id, { playbook_id: id, checklist_state: checklistFor(id, allPlaybooks) });
    }
  };

  const toggleTag = (tag: string) => {
    if (trade.quick_tags.includes(tag)) {
      updateTrade(trade.id, { quick_tags: trade.quick_tags.filter((item) => item !== tag) });
      showToast(`Removed “${tag}”`, {
        label: "Undo",
        run: () => {
          const now = getTrade(trade.id);
          if (now && !now.quick_tags.includes(tag)) updateTrade(trade.id, { quick_tags: [...now.quick_tags, tag] });
        },
      });
    } else {
      updateTrade(trade.id, { quick_tags: [...trade.quick_tags, tag] });
    }
  };

  const sameAsLast = () => {
    if (!last) return;
    const before = { playbook_id: trade.playbook_id, checklist_state: trade.checklist_state, quick_tags: trade.quick_tags };
    updateTrade(trade.id, { playbook_id: last.playbook_id, checklist_state: checklistFor(last.playbook_id, allPlaybooks), quick_tags: [...last.quick_tags] });
    showToast("Copied from the last trade", { label: "Undo", run: () => updateTrade(trade.id, before) });
  };

  const toggleRule = (id: string) => updateTrade(trade.id, { checklist_state: trade.checklist_state.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)) });

  const score = adherence(trade);
  const untouched = !trade.playbook_id && trade.quick_tags.length === 0;
  const saveText = useInlineSaveText(journal.saveState, { deviceOnly: trade.is_sample });
  const activeStage = JOURNAL_STAGES.find((stage) => stage.id === stageId) ?? JOURNAL_STAGES[0];
  const filledStages = JOURNAL_STAGES.filter((stage) => trade[stage.field].trim().length > 0).length;
  const statusLabel = trade.review_status === "reviewed" ? "Reviewed ✓" : trade.review_status === "tagged" ? "Tagged" : "Needs tags";

  return (
    <section className="specular-card card-pad" aria-label="Pit Stop and trade notes">
      <div className="card-head">
        <h3>Pit Stop</h3>
        <span>{statusLabel} · {shield ? "private · Shield on" : "private"}</span>
      </div>

      <div className="notes-panel">
        <div className="notes-block">
          <div className="notes-block-head">
            <label htmlFor={noteInputId}>Quick Takeaway</label>
            <span className="notes-badge">Feed &amp; Trade Cards</span>
          </div>
          <textarea
            id={noteInputId}
            data-trade-note-input=""
            className="takeaway-input"
            rows={1}
            value={trade.note}
            onChange={(event) => updateTrade(trade.id, { note: event.target.value })}
            placeholder="Key reasoning or lesson for feed & cards"
            aria-label="Quick Takeaway (Review note)"
            aria-describedby={`${noteInputId}-hint`}
            autoCapitalize="sentences"
            enterKeyHint="done"
            spellCheck
          />
          <p id={`${noteInputId}-hint`} className="notes-hint">{QUICK_TAKEAWAY_HINT}</p>
        </div>

        <div className="notes-block">
          <div className="notes-block-head">
            <span className="notes-block-title">3-Stage Journal</span>
            <span className="notes-badge num">{filledStages}/3 filled</span>
          </div>
          <div className="stage-tabs" role="tablist" aria-label="3-Stage Journal">
            {JOURNAL_STAGES.map((stage) => {
              const selected = stage.id === activeStage.id;
              const filled = trade[stage.field].trim().length > 0;
              return (
                <button
                  key={stage.id}
                  type="button"
                  role="tab"
                  id={`${noteInputId}-tab-${stage.id}`}
                  aria-selected={selected}
                  aria-controls={`${noteInputId}-panel-${stage.id}`}
                  className="stage-tab"
                  onClick={() => setStageId(stage.id)}
                >
                  <span className={`stage-dot ${filled ? "filled" : ""}`} aria-hidden="true" />
                  <span className="stage-tab-label">{stage.label}</span>
                  {filled && <span className="visually-hidden"> (has notes)</span>}
                </button>
              );
            })}
          </div>
          <div
            className="stage-panel"
            role="tabpanel"
            id={`${noteInputId}-panel-${activeStage.id}`}
            aria-labelledby={`${noteInputId}-tab-${activeStage.id}`}
          >
            <div className="stage-panel-head">
              <label htmlFor={`${noteInputId}-${activeStage.id}`} className={`stage-panel-prompt ${activeStage.hindsight ? "hindsight" : ""}`}>
                {activeStage.prompt}
              </label>
              {activeStage.hindsight && <span className="stage-hindsight-tag">Hindsight</span>}
            </div>
            <textarea
              id={`${noteInputId}-${activeStage.id}`}
              rows={3}
              value={trade[activeStage.field]}
              onChange={(event) => updateTrade(trade.id, { [activeStage.field]: event.target.value })}
              placeholder={activeStage.prompt}
              aria-label={activeStage.ariaLabel}
              autoCapitalize="sentences"
              spellCheck
            />
          </div>
        </div>

        <div className="notes-tags-divider">
          <div className="chip-group" role="group" aria-label="Playbook">
            <h4>Playbook</h4>
            <div className="chip-row">
              {trade.playbook_id == null && <span className="chip outlined" style={{ minHeight: 44 }}>No setup picked</span>}
              {untouched && last && <button type="button" className="chip outlined" onClick={sameAsLast}><span aria-hidden="true">↺ </span>Same as last trade</button>}
              {playbooks.map((playbook) => <button key={playbook.id} type="button" className="chip" aria-pressed={trade.playbook_id === playbook.id} onClick={() => setPlaybook(playbook.id)}>{playbook.name}</button>)}
            </div>
          </div>
          <div className="chip-group" role="group" aria-label="Setup drivers">
            <h4>Setup</h4>
            <div className="chip-row">{setupTags.map((tag) => <button key={tag} type="button" className="chip" aria-pressed={trade.quick_tags.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</button>)}</div>
          </div>
          <div className="chip-group" role="group" aria-label="Execution and mindset">
            <h4>Execution</h4>
            <div className="chip-row">{executionTags.map((tag) => <button key={tag} type="button" className="chip" aria-pressed={trade.quick_tags.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</button>)}</div>
          </div>
          {trade.checklist_state.length > 0 && score && (
            <div className="chip-group" role="group" aria-label="Rules checklist">
              <h4>Rules <span className={`seal ${score.followed === score.total ? "full" : ""}`}>{score.followed}/{score.total} followed</span></h4>
              <ul className="checklist">
                {trade.checklist_state.map((rule) => (
                  <li key={rule.id}><label><span>{rule.label}</span><input type="checkbox" checked={rule.checked} onChange={() => toggleRule(rule.id)} /></label></li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <p className="note-state" role="status">{saveText}</p>
      </div>
    </section>
  );
}

/** One-tap pre-exit feeling logger for open trades (docs/19 §4, OD-39 c). */
export function OpenTradeFeeling({ trade, mood, onOpenEditor }: { trade: TradeRecord; mood: MoodVector; onOpenEditor: () => void }) {
  const moodState = useMood();

  return (
    <section className="open-mood-section specular-card card-pad" aria-label="Pre-exit feeling">
      <div className="open-mood-head">
        <div>
          <span className="eyebrow">Pre-exit feeling</span>
          <p className="open-mood-sub">How do you feel in this trade? <i>optional</i></p>
        </div>
        <button type="button" className="mood-mini" onClick={onOpenEditor} aria-label="Mood Shape. Tap to open editor.">
          <MoodShape vector={mood} size={40} />
        </button>
      </div>
      <div className="chip-row" role="group" aria-label="Pre-exit feeling">
        {moodState.registry.spokes.map((spoke) => {
          const selected = dominantSpoke(mood) === spoke.id;
          return (
            <button
              key={spoke.id}
              type="button"
              className="chip"
              aria-pressed={selected}
              aria-label={`${spoke.label} pre-exit feeling`}
              onClick={() => {
                if (selected) {
                  const rec = setSpokeScore(trade.id, spoke.id, null);
                  showToast(`${spokeChipLabel(spoke)} cleared`, { label: "Undo", run: () => undoMoodRecord(rec.id) });
                } else {
                  const previousDominant = dominantSpoke(mood);
                  const scores: Record<string, number | null> = { [spoke.id]: ONE_TAP_MOOD_SCORE };
                  if (previousDominant && previousDominant !== spoke.id) scores[previousDominant] = null;
                  const now = new Date().toISOString();
                  const rec = recordUserMood(trade.id, scores, now, now);
                  showToast(`Feeling recorded: ${spokeChipLabel(spoke)}`, { label: "Undo", run: () => undoMoodRecord(rec.id) });
                }
              }}
            >
              {spokeChipLabel(spoke)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
