"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, type KeyboardEvent } from "react";
import { DayHeader } from "./DayHeader";
import { MoodStatsCard } from "./MoodCard";
import { TradeRow } from "./TradeRow";
import { usePrefs } from "@/lib/prefs";
import { useAccounts } from "@/lib/accounts-store";
import { applyFilters, describeFilterParts, describeFilters, filterByAccountScope, filtersToQuery, groupByDay, hasActiveFilters, isReplayTrade, parseFilters } from "@/lib/selectors";
import type { AccountScopeFilter, FeedFilters, FilterLookup, StatusFilter } from "@/lib/selectors";
import { useJournal } from "@/lib/store";
import { openAddTrade, rememberList } from "@/lib/ui";

const SCOPE_TABS: Array<{ value: AccountScopeFilter; label: string }> = [
  { value: "real", label: "Real" },
  { value: "replay", label: "Replay" },
  { value: "all", label: "All" },
];

const STATUS_PILLS: Array<{ value: StatusFilter; label: string; icon?: string }> = [
  { value: "unreviewed", label: "Needs review" },
  { value: "flagged", label: "Flagged", icon: "⚑" },
];

function buildFeedUrl(pathname: string, nextFilters: Partial<FeedFilters>, nextScope: AccountScopeFilter) {
  const query = filtersToQuery(nextFilters);
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  if (nextScope === "real") params.delete("scope");
  else params.set("scope", nextScope);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function FeedScreen() {
  const journal = useJournal();
  const prefs = usePrefs();
  const router = useRouter();
  const pathname = usePathname();
  const accounts = useAccounts();
  const searchParams = useSearchParams();
  const filters = parseFilters(searchParams);
  const rawScope = searchParams.get("scope");
  const scope: AccountScopeFilter = rawScope === "replay" || rawScope === "all" ? rawScope : "real";

  // Filters live in the URL, so back, reload and a deep link all restore the same list (UX-10).
  const setFilters = (patch: Partial<FeedFilters>) => router.replace(buildFeedUrl(pathname, { ...filters, ...patch }, scope), { scroll: false });
  const setScope = (nextScope: AccountScopeFilter) => router.replace(buildFeedUrl(pathname, filters, nextScope), { scroll: false });
  const clearFilters = () => router.replace(buildFeedUrl(pathname, { status: "all" }, scope), { scroll: false });
  const tradeListRef = useRef<HTMLDivElement>(null);
  const handleTradeListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    const list = tradeListRef.current;
    if (!list || !list.contains(document.activeElement)) return;
    const rows = Array.from(list.querySelectorAll<HTMLAnchorElement>("a.trade-row"));
    const focusedRow = document.activeElement?.closest<HTMLAnchorElement>("a.trade-row");
    const focusedIndex = focusedRow ? rows.indexOf(focusedRow) : -1;
    if (event.key === "j" || event.key === "k") {
      event.preventDefault();
      const nextIndex = focusedIndex < 0 ? 0 : focusedIndex + (event.key === "j" ? 1 : -1);
      rows[Math.max(0, Math.min(nextIndex, rows.length - 1))]?.focus();
    } else if (event.key === "Enter" && focusedRow) {
      event.preventDefault();
      focusedRow.click();
    } else if (event.key === "Escape" && focusedRow) {
      event.preventDefault();
      focusedRow.blur();
    }
  };

  if (!journal.hydrated) {
    return <div className="page" role="status" aria-label="Loading your journal…"><div className="page-head"><div><span className="eyebrow">Feed</span><h1>Loading your journal…</h1></div></div>{[0, 1, 2].map((key) => <div key={key} className="skeleton skeleton-row" />)}</div>;
  }

  const nonSamples = journal.trades.filter((trade) => !trade.is_sample);
  const realNonReplay = filterByAccountScope(nonSamples, accounts.accounts, "real");
  const hasRealTrades = realNonReplay.length > 0;
  const all = scope === "replay"
    ? filterByAccountScope(nonSamples, accounts.accounts, "replay")
    : scope === "real"
      ? (hasRealTrades ? realNonReplay : prefs.showSamples ? filterByAccountScope(journal.trades, accounts.accounts, "real") : [])
      : (nonSamples.length > 0 ? filterByAccountScope(nonSamples, accounts.accounts, "all") : prefs.showSamples ? filterByAccountScope(journal.trades, accounts.accounts, "all") : []);
  const shown = applyFilters(all, filters);
  const groups = groupByDay(shown, { accounts: accounts.accounts, prefs });
  const filtered = hasActiveFilters(filters);
  const lookup: FilterLookup = { accountName: (id) => accounts.accounts.find((account) => account.id === id)?.name ?? null };
  const chips = describeFilterParts(filters, lookup).filter((part) => part.key !== "status");
  const count = (patch: Partial<FeedFilters>) => applyFilters(all, { ...filters, ...patch }).length;
  const open = () => rememberList({ ids: shown.map((trade) => trade.id), label: describeFilters(filters, lookup), href: buildFeedUrl("/feed", filters, scope) });

  return (
    <div className="page">
      <div className="page-head"><div><span className="eyebrow">Feed</span><h1>Every trading day</h1></div></div>

      <div className="seg-tabs" role="tablist" aria-label="Account scope" style={{ marginBottom: 12 }}>
        {SCOPE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            className={`seg-tab${scope === tab.value ? " active" : ""}`}
            style={{ minHeight: 44 }}
            aria-selected={scope === tab.value}
            onClick={() => setScope(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
            {pill.icon && <span aria-hidden="true">{pill.icon} </span>}{pill.label}<span className="count"><span className="visually-hidden"> (</span>{count({ status: pill.value })}<span className="visually-hidden">)</span></span>
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

      {groups.length === 0 ? (
        <div className="specular-card empty-state">
          {filtered ? (
            <>
              <h3>Nothing matches “{describeFilters(filters, lookup)}”</h3>
              <p>{filters.status === "unreviewed" ? "Every trade in this view is reviewed." : "No trades fit these filters yet."}</p>
              <div className="actions"><button type="button" className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} onClick={clearFilters}>Clear filters</button></div>
            </>
          ) : scope === "replay" ? (
            <>
              <h3>No replay sessions yet</h3>
              <p>Log pretend/bar-replay sessions to a Replay account (via + or your agent) so they stay out of your live stats.</p>
              <div className="actions"><button type="button" className="btn-primary" style={{ minHeight: 44, minWidth: 44 }} onClick={openAddTrade}>＋ Add a trade</button></div>
            </>
          ) : (
            <>
              <h3>No trades yet</h3>
              <p>Log your first trade to start the journal.</p>
              <div className="actions"><button type="button" className="btn-primary" style={{ minHeight: 44, minWidth: 44 }} onClick={openAddTrade}>＋ Add a trade</button></div>
            </>
          )}
        </div>
      ) : (
        <div ref={tradeListRef} onKeyDown={handleTradeListKeyDown} aria-describedby="feed-keyboard-hint">
          <p className="eyebrow" id="feed-keyboard-hint">J/K navigate · Enter open · Esc clear focus</p>
          <p className="visually-hidden">Keyboard: J moves to the next trade, K to the previous trade, Enter opens the focused trade, and Escape clears focus.</p>
        {groups.map((group) => (
          <section key={group.date} className="day-group" aria-label={`Trading session ${group.date}`}>
            <DayHeader group={group} shield={prefs.shield} />
            <div className="trade-list grid">{group.trades.map((trade) => <TradeRow key={trade.id} trade={trade} zone={prefs.timeZone} shield={prefs.shield} isReplay={isReplayTrade(trade, accounts.accounts)} onOpen={open} />)}</div>
          </section>
        ))}
        </div>
      )}

      {groups.length > 0 && <MoodStatsCard trades={all} />}
    </div>
  );
}
