"use client";

// CD-3b: the binder (docs/23 §5.4): a grid of every active playbook. Tiles are text only, so the grid
// never mounts a chart per playbook; tapping one opens its full card with the example chart.
import Link from "next/link";
import { useMemo, useState } from "react";
import { PlaybookCard } from "./PlaybookCard";
import { useDrills } from "@/lib/drills-store";
import { binderView, playbookSampleLine, playbookTileStats } from "@/lib/playbook-binder";
import { usePlaybooks } from "@/lib/playbooks-store";
import { usePrefs } from "@/lib/prefs";
import { useJournal } from "@/lib/store";

export function PlaybookBinder() {
  const journal = useJournal();
  const playbooks = usePlaybooks();
  const { records } = useDrills();
  const prefs = usePrefs();
  const [openId, setOpenId] = useState<string | null>(null);
  // Read once, like the drill screen, so the numbers do not shift while the binder is open.
  const [now] = useState(() => Date.now());

  const view = useMemo(() => binderView(playbooks.playbooks, journal.trades, records, now), [playbooks.playbooks, journal.trades, records, now]);
  const byId = useMemo(() => new Map(journal.trades.map((trade) => [trade.id, trade])), [journal.trades]);

  if (!journal.hydrated || !playbooks.hydrated) {
    return (
      <div className="page binder-page" role="status" aria-label="Loading playbooks…">
        <div className="page-head"><div><span className="eyebrow">Binder</span><h1>Loading…</h1></div></div>
        <div className="skeleton" style={{ height: 320 }} aria-hidden="true" />
      </div>
    );
  }

  const open = openId ? view.cards.find((card) => card.playbook_id === openId) : undefined;
  if (open) {
    return (
      <div className="page binder-page">
        <div className="page-head">
          <div><span className="eyebrow">Binder</span><h1>{open.name}</h1></div>
          <button type="button" className="btn-secondary" onClick={() => setOpenId(null)} aria-label="Back to all playbooks in binder" style={{ minHeight: 44 }}>All playbooks</button>
        </div>
        <PlaybookCard data={open} example={open.example ? byId.get(open.example.trade_id) : undefined} shield={prefs.shield} zone={prefs.timeZone} />
      </div>
    );
  }

  return (
    <div className="page binder-page">
      <div className="page-head">
        <div><span className="eyebrow">Binder</span><h1>Playbooks</h1><p>Each setup, its best example and how it has gone.</p></div>
        <Link className="btn-secondary" href="/tune#playbooks" aria-label="Edit playbooks in Tune" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>Edit playbooks</Link>
      </div>
      {view.cards.length ? (
        <ul className="binder-grid">
          {view.cards.map((card) => (
            <li key={card.playbook_id}>
              <button
                type="button"
                className="specular-card binder-tile"
                onClick={() => setOpenId(card.playbook_id)}
                aria-label={`View ${card.name} playbook: ${card.rules.length} ${card.rules.length === 1 ? "rule" : "rules"}, ${playbookTileStats(card, prefs.shield)}, ${playbookSampleLine(card)}`}
              >
                <span className="eyebrow" aria-hidden="true">Playbook</span>
                <b>{card.name}</b>
                <span className="num muted">{card.rules.length} {card.rules.length === 1 ? "rule" : "rules"}</span>
                <span className={`num binder-tile-stats${prefs.shield ? " muted" : ""}`}>{playbookTileStats(card, prefs.shield)}</span>
                <span className="num muted binder-tile-foot">{playbookSampleLine(card)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="specular-card empty-state">
          <h3>No active playbooks</h3>
          <p>Add a setup and its rules in Tune.</p>
          <div className="actions"><Link className="btn-secondary" href="/tune#playbooks" aria-label="Open Tune to add playbooks" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>Open Tune</Link></div>
        </div>
      )}
      {view.archived > 0 && <p className="muted binder-archived num">{view.archived} archived {view.archived === 1 ? "playbook" : "playbooks"} not shown.</p>}
    </div>
  );
}
