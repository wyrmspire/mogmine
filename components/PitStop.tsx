"use client";

import { useMemo } from "react";
import { EXECUTION_TAGS, SETUP_TAGS, checklistFor, playbookName } from "@/lib/playbooks";
import { activePlaybooks, currentPlaybookVersion, usePlaybooks } from "@/lib/playbooks-store";
import { getTrade, updateTrade, useJournal } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { useInlineSaveText } from "./useSaveLabel";
import { adherence } from "@/lib/trades";
import type { TradeRecord } from "@/lib/trades";

/** Most used first, so the chip a trader reaches for is where the thumb already is (UX-32). */
function byUsage<T extends string>(items: T[], counts: Map<string, number>) {
  return [...items].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
}

/** Placeholders steer each notes field away from restating structured numbers (02 §2.5, UX-18). */
export const NOTE_PLACEHOLDERS = {
  pre_trade_thesis: "Why this trade? What did you see?",
  management_notes: "What did you decide during the trade, and why?",
  post_exit_notes: "What would you do differently?",
  note: "Anything else worth remembering",
} as const;

export const NOTES_COMMENTARY_HINT = "Prices, stop, risk and R are saved above. Notes are for your thinking.";
export const NO_SETUP_PICKED_LABEL = "No setup picked";

/** A trade with `playbook_id` null was never filed under a playbook (02 §2.4, UX-14). "No Setup / Impulse" is a real choice, so it does not count. */
export function showsNoSetupPicked(trade: { playbook_id: string | null }): boolean {
  return trade.playbook_id == null;
}

interface Props {
  trade: TradeRecord;
  /** Review queue: playbook, tags and one line only. */
  compact?: boolean;
}

/**
 * The Pit Stop (docs/03 §2A, docs/08 §7). There is no Save button: every tap saves on the device at
 * once (UX-30, UX-31). Removing something offers Undo instead of asking first (UX-34).
 */
export function PitStop({ trade, compact = false }: Props) {
  const journal = useJournal();
  const { playbooks: allPlaybooks } = usePlaybooks();

  const { playbooks, setupTags, executionTags, last } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of journal.trades) {
      if (item.is_sample !== trade.is_sample) continue; // samples do not shape a real journal's order
      if (item.playbook_id) counts.set(item.playbook_id, (counts.get(item.playbook_id) ?? 0) + 1);
      for (const tag of item.quick_tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    // Archived playbooks leave the picker, except the one this trade is already filed under.
    const ordered = activePlaybooks(allPlaybooks, trade.playbook_id).slice().sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
    const previous = journal.trades.find((item) => item.id !== trade.id && item.is_sample === trade.is_sample && Date.parse(item.entry_time) < Date.parse(trade.entry_time) && (item.playbook_id || item.quick_tags.length));
    return { playbooks: ordered, setupTags: byUsage(SETUP_TAGS, counts), executionTags: byUsage(EXECUTION_TAGS, counts), last: previous };
  }, [journal.trades, allPlaybooks, trade.id, trade.is_sample, trade.entry_time, trade.playbook_id]);

  const setPlaybook = (id: string) => {
    if (trade.playbook_id === id) {
      const before = { playbook_id: trade.playbook_id, playbook_version: trade.playbook_version, checklist_state: trade.checklist_state };
      updateTrade(trade.id, { playbook_id: null, playbook_version: null, checklist_state: [] });
      showToast(`Removed ${playbookName(id, allPlaybooks)}`, { label: "Undo", run: () => updateTrade(trade.id, before) });
    } else {
      // The rules are frozen on the trade now; editing a playbook later never rescores old trades (UX-50).
      updateTrade(trade.id, { playbook_id: id, playbook_version: currentPlaybookVersion(id) ?? 1, checklist_state: checklistFor(id, allPlaybooks) });
    }
  };

  const toggleTag = (tag: string) => {
    if (trade.quick_tags.includes(tag)) {
      updateTrade(trade.id, { quick_tags: trade.quick_tags.filter((item) => item !== tag) });
      showToast(`Removed “${tag}”`, { label: "Undo", run: () => { const now = getTrade(trade.id); if (now && !now.quick_tags.includes(tag)) updateTrade(trade.id, { quick_tags: [...now.quick_tags, tag] }); } });
    } else updateTrade(trade.id, { quick_tags: [...trade.quick_tags, tag] });
  };

  const sameAsLast = () => {
    if (!last) return;
    const before = { playbook_id: trade.playbook_id, playbook_version: trade.playbook_version, checklist_state: trade.checklist_state, quick_tags: trade.quick_tags };
    updateTrade(trade.id, { playbook_id: last.playbook_id, playbook_version: last.playbook_id ? currentPlaybookVersion(last.playbook_id) ?? 1 : null, checklist_state: checklistFor(last.playbook_id, allPlaybooks), quick_tags: [...last.quick_tags] });
    showToast("Copied from the last trade", { label: "Undo", run: () => updateTrade(trade.id, before) });
  };

  const toggleRule = (id: string) => updateTrade(trade.id, { checklist_state: trade.checklist_state.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)) });

  const score = adherence(trade);
  const untouched = !trade.playbook_id && trade.quick_tags.length === 0;
  // Sample trades never leave the device, so they keep the device copy with sync on.
  const saveText = useInlineSaveText(journal.saveState, { deviceOnly: trade.is_sample });

  return (
    <div className="pitstop">
      <div className="chip-group" role="group" aria-label="Playbook">
        <h4>Playbook</h4>
        <div className="chip-row">
          {showsNoSetupPicked(trade) && <span className="chip outlined" style={{ minHeight: 44 }}>{NO_SETUP_PICKED_LABEL}</span>}
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

      {!compact && trade.checklist_state.length > 0 && score && (
        <div className="chip-group" role="group" aria-label="Rules checklist">
          <h4>Rules <span className={`seal ${score.followed === score.total ? "full" : ""}`}>{score.followed}/{score.total} followed</span></h4>
          <ul className="checklist">
            {trade.checklist_state.map((rule) => (
              <li key={rule.id}><label><span>{rule.label}</span><input type="checkbox" checked={rule.checked} onChange={() => toggleRule(rule.id)} /></label></li>
            ))}
          </ul>
        </div>
      )}

      <div className="chip-group">
        <h4><label htmlFor="review-note">Note</label></h4>
        <textarea id="review-note" className="note-input" rows={compact ? 2 : 3} value={trade.note} onChange={(event) => updateTrade(trade.id, { note: event.target.value })} placeholder={NOTE_PLACEHOLDERS.note} aria-label="Review note" />
      </div>

      {!compact && (
        <details className="advanced">
          <summary>Deeper review <span>thesis, management, what happened next</span></summary>
          <p className="advanced-label">What you knew then</p>
          <label className="field"><span>Thesis and invalidation</span><textarea rows={2} value={trade.pre_trade_thesis} onChange={(event) => updateTrade(trade.id, { pre_trade_thesis: event.target.value })} placeholder={NOTE_PLACEHOLDERS.pre_trade_thesis} aria-label="Thesis and invalidation" /></label>
          <label className="field"><span>Management</span><textarea rows={2} value={trade.management_notes} onChange={(event) => updateTrade(trade.id, { management_notes: event.target.value })} placeholder={NOTE_PLACEHOLDERS.management_notes} aria-label="Management" /></label>
          <p className="advanced-label hindsight">What happened next <i>hindsight — not part of judging the decision</i></p>
          <label className="field"><span>After the exit</span><textarea rows={2} value={trade.post_exit_notes} onChange={(event) => updateTrade(trade.id, { post_exit_notes: event.target.value })} placeholder={NOTE_PLACEHOLDERS.post_exit_notes} aria-label="After the exit" /></label>
        </details>
      )}
      <p className="muted" style={{ fontSize: 12, margin: "6px 2px 0" }}>{NOTES_COMMENTARY_HINT}</p>

      <p className="note-state" role="status">{saveText}</p>
    </div>
  );
}
