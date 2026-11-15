"use client";

import { useMemo } from "react";
import { EXECUTION_TAGS, PLAYBOOKS, SETUP_TAGS, checklistFor, playbookName } from "@/lib/playbooks";
import { getTrade, updateTrade, useJournal } from "@/lib/store";
import { showToast } from "@/lib/toast";
import { adherence } from "@/lib/trades";
import type { TradeRecord } from "@/lib/trades";

/** Most used first, so the chip a trader reaches for is where the thumb already is (UX-32). */
function byUsage<T extends string>(items: T[], counts: Map<string, number>) {
  return [...items].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
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

  const { playbooks, setupTags, executionTags, last } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of journal.trades) {
      if (item.is_sample !== trade.is_sample) continue; // samples do not shape a real journal's order
      if (item.playbook_id) counts.set(item.playbook_id, (counts.get(item.playbook_id) ?? 0) + 1);
      for (const tag of item.quick_tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const ordered = [...PLAYBOOKS].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
    const previous = journal.trades.find((item) => item.id !== trade.id && item.is_sample === trade.is_sample && Date.parse(item.entry_time) < Date.parse(trade.entry_time) && (item.playbook_id || item.quick_tags.length));
    return { playbooks: ordered, setupTags: byUsage(SETUP_TAGS, counts), executionTags: byUsage(EXECUTION_TAGS, counts), last: previous };
  }, [journal.trades, trade.id, trade.is_sample, trade.entry_time]);

  const setPlaybook = (id: string) => {
    if (trade.playbook_id === id) {
      const before = { playbook_id: trade.playbook_id, checklist_state: trade.checklist_state };
      updateTrade(trade.id, { playbook_id: null, checklist_state: [] });
      showToast(`Removed ${playbookName(id)}`, { label: "Undo", run: () => updateTrade(trade.id, before) });
    } else {
      // The rules are frozen on the trade now; editing a playbook later never rescores old trades (UX-50).
      updateTrade(trade.id, { playbook_id: id, checklist_state: checklistFor(id) });
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
    const before = { playbook_id: trade.playbook_id, checklist_state: trade.checklist_state, quick_tags: trade.quick_tags };
    updateTrade(trade.id, { playbook_id: last.playbook_id, checklist_state: checklistFor(last.playbook_id), quick_tags: [...last.quick_tags] });
    showToast("Copied from the last trade", { label: "Undo", run: () => updateTrade(trade.id, before) });
  };

  const toggleRule = (id: string) => updateTrade(trade.id, { checklist_state: trade.checklist_state.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)) });

  const score = adherence(trade);
  const untouched = !trade.playbook_id && trade.quick_tags.length === 0;
  const saveText = journal.saveState === "saving" ? "Saving…" : journal.saveState === "error" ? "Not saved — storage is blocked on this device" : "✓ Saved on this device";

  return (
    <div className="pitstop">
      <div className="chip-group" role="group" aria-label="Playbook">
        <h4>Playbook</h4>
        <div className="chip-row">
          {untouched && last && <button className="chip outlined" onClick={sameAsLast}>↺ Same as last trade</button>}
          {playbooks.map((playbook) => <button key={playbook.id} className="chip" aria-pressed={trade.playbook_id === playbook.id} onClick={() => setPlaybook(playbook.id)}>{playbook.name}</button>)}
        </div>
      </div>
      <div className="chip-group" role="group" aria-label="Setup drivers">
        <h4>Setup</h4>
        <div className="chip-row">{setupTags.map((tag) => <button key={tag} className="chip" aria-pressed={trade.quick_tags.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</button>)}</div>
      </div>
      <div className="chip-group" role="group" aria-label="Execution and mindset">
        <h4>Execution</h4>
        <div className="chip-row">{executionTags.map((tag) => <button key={tag} className="chip" aria-pressed={trade.quick_tags.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</button>)}</div>
      </div>

      {!compact && trade.checklist_state.length > 0 && score && (
        <div className="chip-group">
          <h4>Rules <span className={`seal ${score.followed === score.total ? "full" : ""}`}>{score.followed}/{score.total} followed</span></h4>
          <ul className="checklist">
            {trade.checklist_state.map((rule) => (
              <li key={rule.id}><label><input type="checkbox" checked={rule.checked} onChange={() => toggleRule(rule.id)} /><span>{rule.label}</span></label></li>
            ))}
          </ul>
        </div>
      )}

      <div className="chip-group">
        <h4><label htmlFor={compact ? undefined : "review-note"}>Note</label></h4>
        <textarea id={compact ? undefined : "review-note"} className="note-input" rows={compact ? 2 : 3} value={trade.note} onChange={(event) => updateTrade(trade.id, { note: event.target.value })} placeholder="Why did you take it? What would you do differently?" aria-label="Review note" />
      </div>

      {!compact && (
        <details className="advanced">
          <summary>Deeper review <span>thesis, management, what happened next</span></summary>
          <p className="advanced-label">What you knew then</p>
          <label className="field"><span>Thesis and invalidation</span><textarea rows={2} value={trade.pre_trade_thesis} onChange={(event) => updateTrade(trade.id, { pre_trade_thesis: event.target.value })} placeholder="Bias, the level you were trading, where you were wrong" /></label>
          <label className="field"><span>Management</span><textarea rows={2} value={trade.management_notes} onChange={(event) => updateTrade(trade.id, { management_notes: event.target.value })} placeholder="Why you added, trimmed, moved the stop or exited" /></label>
          <p className="advanced-label hindsight">What happened next <i>hindsight — not part of judging the decision</i></p>
          <label className="field"><span>After the exit</span><textarea rows={2} value={trade.post_exit_notes} onChange={(event) => updateTrade(trade.id, { post_exit_notes: event.target.value })} placeholder="What price did in the 15–60 minutes after you were out" /></label>
        </details>
      )}

      <p className="note-state" role="status">{saveText}</p>
    </div>
  );
}
