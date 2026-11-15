import { formatMoney, formatPercent, formatR } from "@/lib/format";
import type { DayGroup } from "@/lib/selectors";
import { formatSessionDate } from "@/lib/session";
import { SAMPLE_CAPTION, SAMPLE_CHIP } from "@/lib/fixtures";

/** Date, gross result, trade count, win rate and the process score beside the result (UX-13). */
export function DayHeader({ group, shield, sticky = true }: { group: DayGroup; shield: boolean; sticky?: boolean }) {
  const { stats } = group;
  const gross = shield ? formatR(stats.netR) : formatMoney(stats.gross);
  const grossValue = shield ? stats.netR ?? 0 : stats.gross;
  const winText = stats.pricedCount
    ? `${formatPercent(stats.winRate)} won (${stats.wins} of ${stats.pricedCount})`
    : "— won";
  return (
    <div className="day-head" style={sticky ? undefined : { position: "static" }}>
      <h2>{formatSessionDate(group.date)}{group.sampleOnly && <span className="tag-chip" title={SAMPLE_CAPTION}>{SAMPLE_CHIP}</span>}</h2>
      <b className={`net num ${grossValue > 0 ? "positive" : grossValue < 0 ? "negative" : ""}`} title="Gross P&L, before fees and commissions">{gross}{!shield && <span className="gross-label"> gross</span>}</b>
      <p className="day-sub">
        {stats.count} {stats.count === 1 ? "trade" : "trades"}
        {stats.incomplete && <> · {stats.pricedCount} priced</>}
        {" · "}{winText}
        {stats.incomplete && <> · <span className="incomplete">incomplete</span></>}
        {stats.processGraded > 0 && <> · <span className="process">{stats.processFollowed}/{stats.processGraded} by the rules</span></>}
      </p>
    </div>
  );
}
