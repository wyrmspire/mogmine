import { formatMoney, formatPercent, formatR } from "@/lib/format";
import type { DayGroup } from "@/lib/selectors";
import { formatSessionDate } from "@/lib/session";

/** Date, net result, trade count, win rate and the process score beside the result (UX-13). */
export function DayHeader({ group, shield, sticky = true }: { group: DayGroup; shield: boolean; sticky?: boolean }) {
  const { stats } = group;
  const net = shield ? formatR(stats.netR) : formatMoney(stats.net);
  const netValue = shield ? stats.netR ?? 0 : stats.net;
  return (
    <div className="day-head" style={sticky ? undefined : { position: "static" }}>
      <h2>{formatSessionDate(group.date)}{group.sampleOnly && <span className="tag-chip">SAMPLE</span>}</h2>
      <b className={`net num ${netValue > 0 ? "positive" : netValue < 0 ? "negative" : ""}`}>{net}</b>
      <p className="day-sub">
        {stats.count} {stats.count === 1 ? "trade" : "trades"} · {formatPercent(stats.winRate)} won
        {stats.processGraded > 0 && <> · <span className="process">{stats.processFollowed}/{stats.processGraded} by the rules</span></>}
      </p>
    </div>
  );
}
