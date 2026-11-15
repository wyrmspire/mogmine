"use client";

import Link from "next/link";
import { TradeRow } from "./TradeRow";
import { usePrefs } from "@/lib/prefs";
import { withSamples } from "@/lib/selectors";
import { useJournal } from "@/lib/store";
import { rememberList } from "@/lib/ui";

export function ReviewScreen() {
  const journal = useJournal();
  const prefs = usePrefs();
  const open = withSamples(journal.trades, prefs.showSamples).filter((trade) => trade.review_status !== "reviewed");
  const remember = () => rememberList({ ids: open.map((trade) => trade.id), label: "Review queue", href: "/review" });

  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">Review queue</span><h1>{journal.hydrated ? (open.length ? `${open.length} to review` : "All caught up") : "Loading…"}</h1><p>Trades that still need tags or a finished review.</p></div></div>
      {!journal.hydrated ? [0, 1, 2].map((key) => <div key={key} className="skeleton skeleton-row" />)
        : open.length === 0 ? <div className="specular-card empty-state"><h3>All caught up</h3><p>Every trade is reviewed.</p><div className="actions"><Link className="btn-secondary" href="/feed">Open the feed</Link></div></div>
          : <div className="trade-list grid">{open.map((trade) => <TradeRow key={trade.id} trade={trade} zone={prefs.timeZone} shield={prefs.shield} onOpen={remember} />)}</div>}
    </div>
  );
}
