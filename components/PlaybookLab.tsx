"use client";

// Playbook Lab (docs/design-2026-11-24/01 §4.1–§4.3). Read-only: every count links to the Feed through the
// model's `feedHref`. Pure facts come from lib/playbook-lab.ts (PL-1); this file only formats and lays them out.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useAccounts } from "@/lib/accounts-store";
import { PLAYBOOK_CARD_MIN_TRADES } from "@/lib/playbook-card";
import { labView } from "@/lib/playbook-lab";
import type { HoldBand, LabExampleRef, LabView, PlaybookFacet, TagFacet, TagKind } from "@/lib/playbook-lab";
import { EXECUTION_TAGS, SETUP_TAGS } from "@/lib/playbooks";
import { usePlaybooks } from "@/lib/playbooks-store";
import { usePrefs } from "@/lib/prefs";
import { resolveRSize, resultR } from "@/lib/r-size";
import { useJournal } from "@/lib/store";
import type { TradeRecord, TradeExitReason } from "@/lib/trades";
import { PlaybookModeTabs } from "./PlaybookBinder";
import { PlaybookLabGaps } from "./PlaybookLabGaps";
import { PlaybookLabMap } from "./PlaybookLabMap";
import { Sparkline } from "./Sparkline";

const TABS = [
  ["playbooks", "Playbooks"],
  ["tags", "Tags"],
  ["map", "Map"],
  ["gaps", "Gaps"],
] as const;
type TabId = (typeof TABS)[number][0];

const EXIT_LABEL: Record<TradeExitReason | "unknown", string> = {
  target: "Target", stop: "Stop", trail: "Trailed", breakeven: "Breakeven", manual: "Manual", unknown: "Unknown",
};
const HOLD_LABEL: Record<HoldBand, string> = { under_5m: "under 5m", "5m_to_30m": "5–30m", "30m_to_2h": "30m–2h", over_2h: "over 2h" };
const EXAMPLE_LABEL: Record<LabExampleRef["reason"], string> = { latest: "Latest", best_rules: "Best rules followed", latest_loss: "Latest loss" };

// Formatting helpers. Rates and R are gated at PLAYBOOK_CARD_MIN_TRADES in the model (null below it).
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fmtR = (value: number) => `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}R`;
const fmtPct = (ratio: number) => `${Math.round(ratio * 100)}%`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const tagList = (rows: { tag?: string; name?: string; n: number }[], limit = 3) =>
  rows.slice(0, limit).map((row) => `${row.tag ?? row.name} ${row.n}`).join(" · ");
const hasRates = (avg: number | null, rules: number | null) => avg != null || rules != null;
function ratesText(avg: number | null, rules: number | null) {
  return [avg == null ? null : `Avg ${fmtR(avg)}`, rules == null ? null : `Rules followed ${fmtPct(rules)}`].filter(Boolean).join(" · ");
}
function exitLine(exitReasons: Record<TradeExitReason | "unknown", number>) {
  return (Object.entries(exitReasons) as [TradeExitReason | "unknown", number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `${EXIT_LABEL[key]} ${n}`)
    .join(" · ");
}

export function PlaybookLab() {
  const journal = useJournal();
  const playbooks = usePlaybooks();
  const accounts = useAccounts();
  const prefs = usePrefs();
  const params = useSearchParams();
  // Samples are excluded by default (01 §9). The switch includes them and every count line says so.
  const [includeSamples, setIncludeSamples] = useState(false);
  // Read once, like the binder, so the numbers do not shift while the Lab is open.
  const [now] = useState(() => Date.now());

  const view = useMemo(
    () =>
      labView(playbooks.playbooks, { setup: SETUP_TAGS, execution: EXECUTION_TAGS }, journal.trades, {
        includeSamples,
        now,
        rOf: (trade: TradeRecord) => resultR(trade, resolveRSize(trade, accounts.accounts, prefs)),
      }),
    [playbooks.playbooks, journal.trades, accounts.accounts, prefs, includeSamples, now],
  );
  const byId = useMemo(() => new Map(journal.trades.map((trade) => [trade.id, trade])), [journal.trades]);

  if (!journal.hydrated || !playbooks.hydrated) {
    return (
      <div className="page lab-page" role="status" aria-label="Loading playbook lab">
        <PlaybookModeTabs active="lab" />
        <div className="skeleton" style={{ height: 320 }} aria-hidden="true" />
      </div>
    );
  }

  const tab = (TABS.find(([id]) => id === params.get("tab"))?.[0] ?? "playbooks") as TabId;
  const playbookId = params.get("playbook");
  const detail = tab === "playbooks" && playbookId ? view.playbooks.find((facet) => facet.playbookId === playbookId) : undefined;
  const c = view.counts;

  return (
    <div className="page lab-page">
      <PlaybookModeTabs active="lab" />
      <div className="page-head">
        <div>
          <span className="eyebrow">Lab</span>
          <h1>Your vocabulary</h1>
          <p>What your playbooks and tags are, and where they show up in your trades.</p>
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={includeSamples}
        aria-label="Include samples"
        className="lab-switch"
        onClick={() => setIncludeSamples((on) => !on)}
      >
        <span>
          Include samples
          <small>{includeSamples ? "Sample trades are included and labelled in the counts" : "Samples are excluded by default"}</small>
        </span>
        <span className="switch" data-checked={includeSamples} aria-hidden="true" />
      </button>

      <div className="lab-counts">
        <span><b>{c.playbooks}</b> playbooks ({c.archived} archived) · <b>{c.setupTags}</b> setup tags · <b>{c.executionTags}</b> execution tags</span>
        <span>
          <b>{c.trades}</b> trades · <b>{c.withPlaybook}</b> with a playbook · <b>{c.withSetupTag}</b> with a setup tag
          {includeSamples ? " · samples included" : ""}
        </span>
      </div>

      <nav className="lab-tabs" aria-label="Lab sections">
        {TABS.map(([id, label]) => (
          <Link key={id} href={`/playbooks/lab?tab=${id}`} aria-current={tab === id ? "page" : undefined}>{label}</Link>
        ))}
      </nav>

      {c.trades === 0 && (
        <div className="specular-card empty-state">
          <h3>No trades in the lab yet</h3>
          <p>Log a trade and tag it to see your map.</p>
        </div>
      )}

      {tab === "playbooks" && (detail ? <PlaybookDetail facet={detail} byId={byId} /> : <PlaybookList view={view} />)}
      {tab === "tags" && <TagsPanel view={view} byId={byId} />}
      {tab === "map" && <PlaybookLabMap view={view} />}
      {tab === "gaps" && <PlaybookLabGaps view={view} />}
    </div>
  );
}

function PlaybookList({ view }: { view: LabView }) {
  const active = view.playbooks.filter((facet) => !facet.archived);
  const archived = view.playbooks.filter((facet) => facet.archived);
  if (!view.playbooks.length) {
    return (
      <div className="specular-card empty-state">
        <h3>No playbooks yet</h3>
        <p>Add a setup and its rules in Tune.</p>
      </div>
    );
  }
  return (
    <section className="lab-panel" aria-labelledby="lab-playbooks-title">
      <h2 id="lab-playbooks-title">Playbooks</h2>
      <ul className="lab-grid lab-list">
        {active.map((facet) => <PlaybookRow key={facet.playbookId} facet={facet} />)}
      </ul>
      {archived.length > 0 && (
        <details className="lab-archived">
          <summary>{plural(archived.length, "archived playbook")}</summary>
          <ul className="lab-grid lab-list">
            {archived.map((facet) => <PlaybookRow key={facet.playbookId} facet={facet} />)}
          </ul>
        </details>
      )}
    </section>
  );
}

function PlaybookRow({ facet }: { facet: PlaybookFacet }) {
  const rates = hasRates(facet.avgResultR, facet.rulesFollowedRatio)
    ? `${ratesText(facet.avgResultR, facet.rulesFollowedRatio)} (n ${facet.closedCount})`
    : `n ${facet.closedCount} · need ${PLAYBOOK_CARD_MIN_TRADES} closed for rates`;
  const ends = exitLine(facet.shape.exitReasons);
  return (
    <li>
      <Link className="lab-row" href={`/playbooks/lab?tab=playbooks&playbook=${encodeURIComponent(facet.playbookId)}`}>
        <span className="lab-row-head">
          <span>{facet.name}{facet.archived && <span className="lab-badge"> · archived</span>}</span>
          <span className="num lab-meta">{plural(facet.n, "trade")} · {facet.lastUsedAt ? `last ${fmtDate(facet.lastUsedAt)}` : "not used yet"}</span>
        </span>
        {facet.setupTags.length > 0 && <span className="lab-meta">Setup tags: {tagList(facet.setupTags)}</span>}
        {facet.executionTags.length > 0 && <span className="lab-meta">Execution: {tagList(facet.executionTags)}</span>}
        {ends && <span className="lab-meta">Ends by: {ends}</span>}
        <span className="num lab-meta">{rates}</span>
      </Link>
    </li>
  );
}

function PlaybookDetail({ facet, byId }: { facet: PlaybookFacet; byId: Map<string, TradeRecord> }) {
  const shape = facet.shape;
  const holds = (Object.keys(HOLD_LABEL) as HoldBand[]).filter((band) => shape.holdBands[band] > 0);
  const rates = hasRates(facet.avgResultR, facet.rulesFollowedRatio)
    ? `${ratesText(facet.avgResultR, facet.rulesFollowedRatio)} (n ${facet.closedCount})`
    : `n ${facet.closedCount} · need ${PLAYBOOK_CARD_MIN_TRADES} closed for rates`;
  const tagRows = [...facet.setupTags.map((row) => ({ ...row, kind: "Setup" })), ...facet.executionTags.map((row) => ({ ...row, kind: "Execution" }))];
  const max = Math.max(1, ...tagRows.map((row) => row.n));
  return (
    <section className="lab-panel" aria-labelledby="lab-detail-title">
      <div className="lab-actions">
        <Link href="/playbooks/lab?tab=playbooks" style={{ minHeight: 44 }}>All playbooks</Link>
      </div>
      <div className="lab-card">
        <h2 id="lab-detail-title">{facet.name}{facet.archived && <span className="lab-badge"> · archived</span>}</h2>
        <p className="num lab-meta">{plural(facet.n, "trade")} · {facet.openCount} open · {rates}</p>
        <ol className="lab-meta">
          {facet.rules.map((rule) => <li key={rule.id}>{rule.label}</li>)}
        </ol>
      </div>

      <div className="lab-card">
        <h3>Co-occurring tags</h3>
        {tagRows.length ? (
          <ul className="lab-bars" aria-label="Co-occurring tags">
            {tagRows.map((row) => (
              <li key={`${row.kind}-${row.tag}`}>
                <Link className="lab-bar" href={row.feedHref}>
                  <span>{row.tag} <span className="lab-meta">{row.kind.toLowerCase()}</span></span>
                  <b className="num">{row.n}</b>
                  <span className="lab-bar-track"><span className="lab-bar-fill" style={{ "--share": row.n / max } as CSSProperties} /></span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lab-note">No tags used with this playbook yet.</p>
        )}
      </div>

      <div className="lab-card">
        <h3>Shape</h3>
        <p className="num">Long {shape.longCount} · Short {shape.shortCount}</p>
        <p className="num lab-meta">Ends by: {exitLine(shape.exitReasons) || "no closed trades"}</p>
        <p className="num lab-meta">Hold: {holds.map((band) => `${HOLD_LABEL[band]} ${shape.holdBands[band]}`).join(" · ") || "no closed trades"}</p>
        <p className="num lab-meta">
          Stop moved {shape.stopMovedShare == null ? "—" : fmtPct(shape.stopMovedShare)} ({shape.stopMovedCount} of {facet.closedCount})
        </p>
        <p className="num lab-meta">{shape.wins} win · {shape.losses} loss · {shape.scratches} scratch</p>
      </div>

      <div className="lab-card">
        <h3>Examples</h3>
        <Examples refs={facet.examples} byId={byId} />
        {!facet.examples.length && <p className="lab-note">No closed trades yet.</p>}
      </div>

      <div className="lab-actions">
        <Link href="/playbooks" style={{ minHeight: 44 }}>Open card</Link>
        <Link href="/tune#playbooks" style={{ minHeight: 44 }}>Edit</Link>
        <Link href={facet.feedHref} style={{ minHeight: 44 }}>All {facet.n} trades</Link>
      </div>
    </section>
  );
}

function Examples({ refs, byId }: { refs: LabExampleRef[]; byId: Map<string, TradeRecord> }) {
  const rows = refs.flatMap((ref) => {
    const trade = byId.get(ref.tradeId);
    return trade ? [{ ref, trade }] : [];
  });
  if (!rows.length) return null;
  return (
    <div className="lab-examples">
      {rows.map(({ ref, trade }) => (
        <Link key={ref.tradeId} className="lab-example" href={`/trades/${encodeURIComponent(trade.id)}`}>
          <Sparkline points={trade.sparkline} />
          <span>{EXAMPLE_LABEL[ref.reason]} · {trade.symbol} {trade.direction === "LONG" ? "long" : "short"}</span>
        </Link>
      ))}
    </div>
  );
}

function TagsPanel({ view, byId }: { view: LabView; byId: Map<string, TradeRecord> }) {
  const used = view.tags.some((facet) => facet.n > 0) || view.unknownTags.length > 0;
  return (
    <div className="lab-panel">
      {!used && <p className="lab-note">No tags used yet. Tag a trade to see its setup and execution here.</p>}
      <TagGroup title="Setup" kind="setup" tags={view.tags} byId={byId} />
      <TagGroup title="Execution" kind="execution" tags={view.tags} byId={byId} />
      {view.unknownTags.length > 0 && (
        <section className="lab-card lab-unknown" aria-labelledby="lab-unknown-title">
          <h2 id="lab-unknown-title">Not in your vocabulary</h2>
          <p className="lab-meta">Tags on trades that are not in the current lists (older versions or the API).</p>
          <ul className="lab-examples">
            {view.unknownTags.map((row) => (
              <li key={row.label}>
                <Link className="lab-example" href={row.feedHref}>
                  <span className="num">{row.label}</span>
                  <span className="num lab-meta">{plural(row.n, "trade")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TagGroup({ title, kind, tags, byId }: { title: string; kind: TagKind; tags: TagFacet[]; byId: Map<string, TradeRecord> }) {
  const group = tags.filter((facet) => facet.kind === kind);
  if (!group.length) return null;
  return (
    <section className="lab-panel" aria-label={`${title} tags`}>
      <h2 className="lab-group-title"><span>{title} tags</span><span>{group.length}</span></h2>
      <div className="lab-grid">
        {group.map((facet) => <TagCard key={facet.tag} facet={facet} byId={byId} />)}
      </div>
    </section>
  );
}

function TagCard({ facet, byId }: { facet: TagFacet; byId: Map<string, TradeRecord> }) {
  return (
    <article className="lab-card">
      <h3>
        <Link className="lab-title" href={facet.feedHref} style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>{facet.tag}</Link>
        <span className="num lab-meta">{plural(facet.n, "trade")}</span>
      </h3>
      {facet.n === 0 ? (
        <p className="lab-note">Not used yet.</p>
      ) : (
        <>
          <p className="num lab-meta">With: {tagList(facet.playbooks.map((row) => ({ name: row.name, n: row.n })))}</p>
          <p className="num lab-meta">
            {hasRates(facet.avgResultR, facet.rulesFollowedRatio)
              ? `${ratesText(facet.avgResultR, facet.rulesFollowedRatio)} (n ${facet.closedCount})`
              : "not enough for rates yet"}
          </p>
          <Examples refs={facet.examples} byId={byId} />
        </>
      )}
    </article>
  );
}
