"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DayHeader } from "./DayHeader";
import { TradeRow } from "./TradeRow";
import { usePrefs } from "@/lib/prefs";
import { applyFilters, describeFilters, filtersToQuery, groupByDay, parseFilters, withSamples } from "@/lib/selectors";
import type { FeedFilters, StatusFilter, StyleFilter } from "@/lib/selectors";
import { useJournal } from "@/lib/store";
import { openAddTrade, rememberList } from "@/lib/ui";

const STYLE_PILLS: Array<{ value: StyleFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "scalp", label: "Scalps" },
  { value: "session_90m", label: "90m" },
  { value: "investment", label: "Extended" },
];
const STATUS_PILLS: Array<{ value: StatusFilter; label: string; icon?: string }> = [
  { value: "unreviewed", label: "Needs review" },
  { value: "flagged", label: "Flagged", icon: "⚑" },
];

export function FeedScreen() {
  const journal = useJournal();
  const prefs = usePrefs();
  const router = useRouter();
  const pathname = usePathname();
  const filters = parseFilters(useSearchParams());

  // Filters live in the URL, so back, reload and a deep link all restore the same list (UX-10).
  const setFilters = (patch: Partial<FeedFilters>) => router.replace(`${pathname}${filtersToQuery({ ...filters, ...patch })}`, { scroll: false });

  const all = withSamples(journal.trades, prefs.showSamples);
  const shown = applyFilters(all, filters);
  const groups = groupByDay(shown);
  const filtered = filters.style !== "all" || filters.status !== "all";
  const count = (patch: Partial<FeedFilters>) => applyFilters(all, { ...filters, ...patch }).length;
  const open = () => rememberList({ ids: shown.map((trade) => trade.id), label: describeFilters(filters), href: `/feed${filtersToQuery(filters)}` });

  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">Feed</span><h1>Every trading day</h1></div></div>

      <div className="filter-bar" role="group" aria-label="Filters">
        {STYLE_PILLS.map((pill) => (
          <button key={pill.value} type="button" className="pill" aria-pressed={filters.style === pill.value} onClick={() => setFilters({ style: pill.value })}>
            {pill.label}{journal.hydrated && <span className="count"><span className="visually-hidden"> (</span>{count({ style: pill.value })}<span className="visually-hidden">)</span></span>}
          </button>
        ))}
        <span className="filter-sep" aria-hidden="true" />
        {STATUS_PILLS.map((pill) => (
          <button key={pill.value} type="button" className="pill" aria-pressed={filters.status === pill.value} onClick={() => setFilters({ status: filters.status === pill.value ? "all" : pill.value })}>
            {pill.icon && <span aria-hidden="true">{pill.icon} </span>}{pill.label}{journal.hydrated && <span className="count"><span className="visually-hidden"> (</span>{count({ status: pill.value })}<span className="visually-hidden">)</span></span>}
          </button>
        ))}
      </div>

      {!journal.hydrated ? (
        <div role="status" aria-label="Loading trades…">{[0, 1, 2, 3].map((key) => <div key={key} className="skeleton skeleton-row" />)}</div>
      ) : groups.length === 0 ? (
        <div className="specular-card empty-state">
          {filtered ? (
            <>
              <h3>Nothing matches “{describeFilters(filters)}”</h3>
              <p>{filters.status === "unreviewed" ? "Every trade in this view is reviewed." : "No trades fit these filters yet."}</p>
              <div className="actions"><button className="btn-secondary" onClick={() => setFilters({ style: "all", status: "all" })}>Clear filters</button></div>
            </>
          ) : (
            <>
              <h3>No trades yet</h3>
              <p>Log your first trade to start the journal.</p>
              <div className="actions"><button className="btn-primary" onClick={openAddTrade}>＋ Add a trade</button></div>
            </>
          )}
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.date} className="day-group">
            <DayHeader group={group} shield={prefs.shield} />
            <div className="trade-list grid">{group.trades.map((trade) => <TradeRow key={trade.id} trade={trade} zone={prefs.timeZone} shield={prefs.shield} onOpen={open} />)}</div>
          </section>
        ))
      )}
    </div>
  );
}
