"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DayHeader } from "./DayHeader";
import { MoodStatsCard } from "./MoodCard";
import { TradeRow } from "./TradeRow";
import { usePrefs } from "@/lib/prefs";
import { useAccounts } from "@/lib/accounts-store";
import { applyFilters, describeFilterParts, describeFilters, filtersToQuery, groupByDay, hasActiveFilters, parseFilters, withSamples } from "@/lib/selectors";
import type { FeedFilters, FilterLookup, StatusFilter } from "@/lib/selectors";
import { useJournal } from "@/lib/store";
import { openAddTrade, rememberList } from "@/lib/ui";

const STATUS_PILLS: Array<{ value: StatusFilter; label: string; icon?: string }> = [
  { value: "unreviewed", label: "Needs review" },
  { value: "flagged", label: "Flagged", icon: "⚑" },
];

export function FeedScreen() {
  const journal = useJournal();
  const prefs = usePrefs();
  const router = useRouter();
  const pathname = usePathname();
  const accounts = useAccounts();
  const filters = parseFilters(useSearchParams());

  // Filters live in the URL, so back, reload and a deep link all restore the same list (UX-10).
  const setFilters = (patch: Partial<FeedFilters>) => router.replace(`${pathname}${filtersToQuery({ ...filters, ...patch })}`, { scroll: false });
  const clearFilters = () => router.replace(pathname, { scroll: false });

  if (!journal.hydrated) {
    return <div className="page" role="status" aria-label="Loading your journal…"><div className="page-head"><div><span className="eyebrow">Feed</span><h1>Loading your journal…</h1></div></div>{[0, 1, 2].map((key) => <div key={key} className="skeleton skeleton-row" />)}</div>;
  }

  const all = withSamples(journal.trades, prefs.showSamples);
  const shown = applyFilters(all, filters);
  const groups = groupByDay(shown);
  const filtered = hasActiveFilters(filters);
  const lookup: FilterLookup = { accountName: (id) => accounts.accounts.find((account) => account.id === id)?.name ?? null };
  const chips = describeFilterParts(filters, lookup).filter((part) => part.key !== "status");
  const count = (patch: Partial<FeedFilters>) => applyFilters(all, { ...filters, ...patch }).length;
  const open = () => rememberList({ ids: shown.map((trade) => trade.id), label: describeFilters(filters, lookup), href: `/feed${filtersToQuery(filters)}` });

  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">Feed</span><h1>Every trading day</h1></div></div>

      <div className="filter-bar" role="group" aria-label="Filters">
        {STATUS_PILLS.map((pill) => (
          <button
            key={pill.value}
            type="button"
            className="pill"
            style={{ minHeight: 44, minWidth: 44 }}
            aria-pressed={filters.status === pill.value}
            onClick={() => setFilters({ status: filters.status === pill.value ? "all" : pill.value })}
          >
            {pill.icon && <span aria-hidden="true">{pill.icon} </span>}{pill.label}{journal.hydrated && <span className="count"><span className="visually-hidden"> (</span>{count({ status: pill.value })}<span className="visually-hidden">)</span></span>}
          </button>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="filter-bar" role="group" aria-label="Active filters">
          {chips.map((part) => (
            <button
              key={part.key}
              type="button"
              className="pill"
              style={{ minHeight: 44, minWidth: 44 }}
              aria-pressed="true"
              aria-label={`Remove filter ${part.label}`}
              onClick={() => setFilters({ [part.key]: null } as Partial<FeedFilters>)}
            >
              {part.label}<span aria-hidden="true"> ×</span>
            </button>
          ))}
          <button type="button" className="pill" style={{ minHeight: 44, minWidth: 44 }} onClick={clearFilters}>Clear filters</button>
        </div>
      )}

      {!journal.hydrated ? (
        <div role="status" aria-label="Loading trades…">{[0, 1, 2, 3].map((key) => <div key={key} className="skeleton skeleton-row" />)}</div>
      ) : groups.length === 0 ? (
        <div className="specular-card empty-state">
          {filtered ? (
            <>
              <h3>Nothing matches “{describeFilters(filters, lookup)}”</h3>
              <p>{filters.status === "unreviewed" ? "Every trade in this view is reviewed." : "No trades fit these filters yet."}</p>
              <div className="actions"><button className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={clearFilters}>Clear filters</button></div>
            </>
          ) : (
            <>
              <h3>No trades yet</h3>
              <p>Log your first trade to start the journal.</p>
              <div className="actions"><button className="btn-primary" style={{ minHeight: 44, minWidth: 44 }} onClick={openAddTrade}>＋ Add a trade</button></div>
            </>
          )}
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.date} className="day-group" aria-label={`Trading session ${group.date}`}>
            <DayHeader group={group} shield={prefs.shield} />
            <div className="trade-list grid">{group.trades.map((trade) => <TradeRow key={trade.id} trade={trade} zone={prefs.timeZone} shield={prefs.shield} onOpen={open} />)}</div>
          </section>
        ))
      )}

      {groups.length > 0 && <MoodStatsCard trades={journal.trades} />}
    </div>
  );
}
