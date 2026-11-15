"use client";

import Link from "next/link";
import { Sparkline } from "./Sparkline";
import { formatDuration, formatMoney, formatPoints, formatR } from "@/lib/format";
import { playbookName } from "@/lib/playbooks";
import { formatListTime } from "@/lib/time";
import { adherence, holdSeconds, rMultiple, tradePnl, tradePoints } from "@/lib/trades";
import type { TradeRecord } from "@/lib/trades";

interface Props {
  trade: TradeRecord;
  zone: string;
  shield: boolean;
  current?: boolean;
  onOpen?: () => void;
}

/** What the trader captured about this trade, or a nudge when nothing has been captured yet. */
function context(trade: TradeRecord) {
  const parts = [playbookName(trade.playbook_id), ...trade.quick_tags].filter(Boolean);
  if (parts.length) return { text: parts.join(" · "), todo: false };
  if (trade.note.trim()) return { text: trade.note.trim(), todo: false };
  return { text: "Needs tags", todo: true };
}

export function TradeRow({ trade, zone, shield, current, onOpen }: Props) {
  const pnl = tradePnl(trade);
  const r = rMultiple(trade);
  const tone = (pnl ?? 0) > 0 ? "positive" : (pnl ?? 0) < 0 ? "negative" : "";
  const info = context(trade);
  const score = adherence(trade);
  // Shield mode shows skill, not money: R when there is a stop, points otherwise (UX-64).
  const headline = shield ? (r != null ? formatR(r) : formatPoints(tradePoints(trade), trade.symbol)) : formatMoney(pnl);
  const secondary = shield ? (r != null ? formatPoints(tradePoints(trade), trade.symbol) : "") : formatR(r);
  return (
    <Link href={`/trades/${trade.id}`} className="trade-row" aria-current={current ? "true" : undefined} onClick={onOpen} scroll={!current}>
      <span className="row-main">
        <span className="row-title">
          <strong>{trade.symbol}</strong>
          <span className={`direction ${trade.direction === "LONG" ? "long" : "short"}`}><span aria-hidden="true">{trade.direction === "LONG" ? "▲ " : "▼ "}</span>{trade.direction}</span>
          {trade.is_sample && <span className="tag-chip">SAMPLE</span>}
          {score && <span className={`seal ${score.followed === score.total ? "full" : ""}`} title="Rules followed">{score.followed}/{score.total}<span className="visually-hidden"> rules followed</span></span>}
          {trade.flagged && <span className="status-mark reviewed" title="Flagged"><span aria-hidden="true">⚑</span><span className="visually-hidden">Flagged</span></span>}
          {trade.review_status === "reviewed" && <span className="status-mark reviewed" title="Reviewed"><span aria-hidden="true">✓</span><span className="visually-hidden">Reviewed</span></span>}
        </span>
        <span className="row-meta">{formatListTime(trade.entry_time, zone)} · {formatDuration(holdSeconds(trade))}</span>
        <span className={`row-context ${info.todo ? "todo" : ""}`}>{info.text}</span>
      </span>
      <Sparkline points={trade.sparkline} />
      <span className="row-result">
        <b className={tone}>{headline}</b>
        <span>{secondary}</span>
      </span>
    </Link>
  );
}
