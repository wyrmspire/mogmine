# MogMine playbook design v2

**Status** — Review proposal for wyrmspire. The implementation baseline is worktree revision `0eb7515`. The source proposals are [Tappy's brief](00-brainstorm-tappy.md), [Data Architecture (A)](01-data-architecture.md) and [UX Dynamics (B)](02-ux-dynamics.md).

A playbook defines a setup. A saved example preserves the market evidence and the trader's explanation of a particular instance. Tagged journal trades supply performance stats. Practice scores measure how often the trader recognizes the curator's criteria. Each answers a different question.

Ship the first loop from Trade Detail to the playbook's Examples list and into an interactive chart that can be reopened from device storage. A user can save an A+ loss or a profitable trap. The classification comes from the setup and its execution, with the trader's explanation. The actual result comes from the trade record.

## What the worktree supports

| Checked | Evidence and design consequence |
| --- | --- |
| Playbook and editor | The current record has `id`, `user_id`, `name`, `default_style`, ordered `checklist_rules` and `archived`. `currentPlaybooks()` includes archived entries. The normal picker deliberately keeps a trade's archived selection visible, and the store treats `no-setup` as a reserved, rule-free impulse bucket. Capture needs a stricter destination filter. Adding a thesis needs an update to the draft, sanitizer and backup path, which currently enumerate the surviving fields. [Types and registry](../../lib/playbooks.ts#L8) · [Store](../../lib/playbooks-store.ts#L73) · [Draft and picker](../../lib/playbooks-store.ts#L144) |
| Checklist freeze | `checklistFor()` makes a fresh unchecked copy. Pit Stop writes that copy when the trade's assignment changes. Subsequent playbook edits cannot change the rule text on that trade, but explicit reassignments and checklist edits can. An unchecked boolean also starts out unassessed. An example freezes the text currently recorded and takes its teaching assessments from the curator. [Checklist copy](../../lib/playbooks.ts#L72) · [Pit Stop assignment](../../components/PitStop.tsx#L40) · [Trade record](../../lib/trades.ts#L45) |
| Available candle history | Real trade bars come from a signature-matching device cache or the Yahoo market-data route, with a single returned base resolution. The route currently attempts `1m`, `5m`, then `1h`. An anchored closed-trade payload can still have missing bars inside the hold. Detail retries fresh or incomplete data, so a ready chart is evidence of available bars, rather than whole-window coverage. The checked-in route has no archive read path. PR #71's status is outside this worktree review. [Trade loader](../../lib/candles.ts#L202) · [Retry behavior](../../lib/candles.ts#L278) · [Route and coverage](../../app/api/market-data/route.ts#L12) |
| Samples and study | Sample Trade Detail uses an offline fixture branch. Its adapter sets `volume: 1` as a placeholder. The level-set JSON holds markup, with no candle window in it. There is a useful day-window loader for the entry form and a `from`/`to` API bounded to 26 hours. Flow B needs its own study UI and coverage checks over that input. [Sample adapter](../../lib/candles.ts#L56) · [Day loader](../../lib/candles.ts#L339) · [Day route](../../app/api/market-data/route.ts#L27) · [Level-set fixture](../../fixtures/levelsets/MES-2026-11-12.json) |
| Chart and capture hooks | `TradeDetail` passes the entire ready candle entry to `TradeChart`. The `‹30` and `30›` controls extend the visible logical range within the loaded bars. The chart requires a complete `TradeRecord` and can include exit, stop and target in autoscale, plus continuation and later touches from hindsight. It clears leftover price lines. Reuse the candle rendering, gestures, formatters, theme and screenshot path. Feed examples their own chart inputs with a window and marks selected for the mode. [Detail inputs](../../components/TradeDetail.tsx#L93) · [Chart props](../../components/TradeChart.tsx#L43) · [Extension and screenshot](../../components/TradeChart.tsx#L175) · [Autoscale and hindsight](../../components/TradeChart.tsx#L228) |
| Time, aggregation and risk | `Candle.time` is a UTC millisecond **open**. `aggregateCandles()` buckets the bars present, even for an incomplete bucket. A nearby fill alignment is approximate. `TradeDetail` currently uses `rMultiple()` with the working stop. Example results labeled **Initial R** must use `initialRMultiple()`, including null for older trades with an unknown initial stop. Excursions use fully-inside bars and can be partial or unavailable. [Candle type](../../lib/trades.ts#L7) · [Aggregation and alignment](../../lib/trades.ts#L319) · [Initial stop and R](../../lib/trades.ts#L246) · [Excursions](../../lib/trades.ts#L512) · [Detail metrics](../../components/TradeDetail.tsx#L221) |
| Storage and review | The current IndexedDB helper is a best-effort candle cache. It can resolve a blocked read as absent or a failed write as `false`. The journal backup carries playbook definitions and omits candles. Review snapshots a queue of trade IDs and writes the existing `take_again` answer and review status on the trade. Both patterns require a deliberate boundary for examples. [Cache helper](../../lib/idb.ts#L1) · [Journal backup](../../lib/store.ts#L137) · [Backup builder](../../lib/store.ts#L242) · [Review queue](../../components/ReviewScreen.tsx#L29) |

## Resolutions across the designs

| Divergence | Unified choice and rationale |
| --- | --- |
| Setup fields and example names | Add one optional `thesis` text field to the existing playbook for its entry model. A's rule-tagged annotations and B's rule chips point to frozen rule IDs and labels. Use A's `exemplar`, `near-miss`, `anti-example` literals throughout, including filters and exports. Display **A+ Exemplar**, **Near-Miss** and **Anti-Example**. Give each example one parent playbook. A filtered deck can read across parents when needed, with one source of truth for the teaching label. |
| Redundant title, summary, good/bad fields and tags | Capture one required verdict and optional rule assessments and anchored callouts. Cards derive their heading from kind, symbol and decision date. Current and historical rule text have explicit origins. This makes capture short and leaves space for a precise reason, such as “The reclaim held, but price had already traveled too far from the stop.” |
| Two storage writes and optimistic success | Put the list header and frozen detail in two stores of **one IndexedDB database** and commit both in one transaction. A sequential localStorage write can strand candles or publish a broken card. Show **Saving…**, then **Saved on this device** after transaction completion. Keep the draft on failure. |
| Key-based deduplication and permanence | Use one payload per example. Identical window coordinates can contain corrected prices or different coverage, so they are insufficient for deduplication. Use a hash of the actual captured bars for integrity. Device storage survives source edits and Yahoo expiry while the origin's storage exists. A private backup supplies recovery from eviction or device loss. |
| Hard-coded 1m/5m, two captured series and live indicators | Save the actual source base series once, even when it is coarse. The first viewer uses that resolution. Add coarser views only from verified complete buckets. Freeze indicator values or points with their data-availability times and provenance. Changing a formula or re-running it from a cropped window could change historical values or import hindsight. Absent volume and a mislabeled daily close supply insufficient evidence for volume or settlement levels. The example snapshot serves the teaching library. Daily and per-trade candle archival retain their separate duties. [Archive guardrails](../../AGENTS.md#3b-additional-guardrails-2026-11-14-review) |
| Capture range, resolution and source | Use one normalized window and one exact decision cutoff. For a trade, keep the logged exit in the frozen execution fields. For study, use a bounded follow-through window and the curator's verdict. Requiring a closed session would delay captures with valid evidence. Use coverage labels and an explicit partial-save path when follow-through is missing. |
| A's revealed gallery vs B's sealed viewer | Recommend revealed study on ordinary gallery open, with **Decision view** available in one tap. The gallery already identifies the example's kind. Start blind drills on a fresh route state with the answer and result withheld. The owner can choose a decision-first gallery without changing the snapshot format. |
| Long/Short/Pass vs Take/Borderline/Trap vs existing Take Again | Ask **How well did this meet the setup?** and grade exact match to the curator's decision-time classification. Direction, size, realized R and trade outcome would answer different questions. Mark retrospective execution lessons as study-only for this drill. Keep example attempts out of `take_again` and the existing trade-drill store. [Existing blind review](../../components/ReviewScreen.tsx#L57) · [CD-2](../23-card-system.md#4-drill-cards--practice-on-your-own-trades-cd-2) |
| Mixed review queue vs separate entry | Use a dedicated Playbook **Drill** action. An optional link from **All caught up** can reuse the existing Review entry point without changing trade queue count, order or completion. Example drills can reuse card layout and browser controls from CD-2 while retaining their own eligibility and score. |
| Outcome-led suggestions and comparisons | Offer a neutral **Find a closed trade** entry, filtered to the playbook where useful. Remove the winner-based first-example recommendation. Show near-misses alongside exemplars and traps. Compare two curator-selected examples with the reason visible in each, since automatic pairing by winning/losing or aligning unrelated price scales can teach the wrong difference. |
| Shield, cards and packages | Keep technical prices, ticks/points and valid R on the revealed private viewer under Shield. Use a safe-field projection for share and sealed modes. The CD-3 **playbook** card hides results under Shield. A standalone **example** PNG can reuse the frame, subject to the export rules below. Treat editable package sharing as an owner decision and private backup as recovery. [Shield (UX-64)](../08-ux-notes-viewing-and-journaling.md#9-emotional-design) · [Card system](../23-card-system.md) |

## Proposed data contract

These are TypeScript contracts for implementation. The playbook upgrade is additive under `mogmine-playbooks-v1`. Keep the existing seed fallback and field limits. Omit blank thesis text, cap it at 180 characters, and round-trip it through the current sanitizer, draft, update and backup paths. Keep examples as a child collection indexed by `user_id` and `playbook_id`. Compute live metrics at read time through the existing selectors.

```typescript
import type { Playbook, PlaybookRule } from "./playbooks.ts"
import type { Candle, CandleSource, Timeframe, TradeDirection } from "./trades.ts"

export interface PlaybookV2 extends Playbook {
  thesis?: string
}

export type ExampleKind = "exemplar" | "near-miss" | "anti-example"
export type ExampleBasis = "decision" | "retrospective"

export interface ExampleExecution {
  direction: TradeDirection
  entry_time: number
  entry_price: number
  exit_time: number
  exit_price: number
  /** A check against the continuous candle and the existing price tolerance. */
  fill_price_mismatch: { entry: boolean; exit: boolean }
  realized_points: number | null
  initial_r: number | null
  excursion: {
    mae_points: number
    mfe_points: number
    coverage: "complete" | "partial"
  } | null
}

export type ExampleSource =
  | { kind: "own-trade"; trade_id: string; execution: ExampleExecution }
  | { kind: "historical-capture" }
  | { kind: "sample"; fixture_id: string }

export interface ExampleWindow {
  /** Requested half-open interval, aligned to the base grid. All times are UTC ms. */
  start_time: number
  end_time: number
  /** Last instant of information allowed on the decision side. Can be inside a bar. */
  decision_time: number
}

export interface ExampleCoverage {
  decision: "complete" | "partial" | "unknown"
  outcome: "complete" | "partial" | "unknown" | "unavailable"
  /** Expected base-bar opens absent under the capture-time schedule check. */
  missing_bar_times: number[]
}

export interface ExampleRule extends PlaybookRule {
  assessment: "met" | "missed" | "unassessed"
}

export interface ExampleRubric {
  name_at_capture: string
  thesis_at_capture: string | null
  rules_from: "trade-checklist" | "playbook"
  rules: ExampleRule[]
}

export type ExampleLevelSource =
  | { kind: "authored" }
  | { kind: "computed"; calc_version: string }
  | { kind: "fixture"; fixture_id: string; calc_version: string | null }

export type ExampleLevel = {
  id: string
  /** Key from the verified level source, or a user-generated key. */
  key: string
  label: string
  session_date: string
  source: ExampleLevelSource
  source_revision: number | null
} & (
  | { shape: "line"; price: number; available_at: number | null }
  | { shape: "zone"; price_low: number; price_high: number; available_at: number | null }
  | { shape: "series"; points: { time: number; price: number; available_at: number | null }[] }
)

export type ExampleAnnotation = {
  id: string
  time: number
  price: number
  label: string
  rule_id: string | null
} & (
  | { shape: "callout" | "arrow" | "marker" }
  | { shape: "zone"; end_time: number; end_price: number }
)

export interface PlaybookExampleHeader {
  schema: "mogmine.playbook_example.v1"
  id: string
  user_id: string
  playbook_id: string
  kind: ExampleKind
  source_kind: ExampleSource["kind"]
  symbol: string
  base_timeframe: Timeframe
  decision_session_date: string
  captured_at: string
  archived: boolean
  bar_count: number
  bars_sha256: string
}

export interface PlaybookExampleSnapshot {
  /** Same ID as the header, also scoped to the owner. */
  id: string
  user_id: string
  source: ExampleSource
  provider_symbol: string
  candle_source: CandleSource
  /** Demo fixture volume is a placeholder. Unknown disables volume-dependent teaching marks. */
  volume_quality: "verified" | "unknown"
  window: ExampleWindow
  coverage: ExampleCoverage
  rubric: ExampleRubric
  basis: ExampleBasis
  verdict: string
  levels: ExampleLevel[]
  annotations: ExampleAnnotation[]
  bars: Candle[]
}

export interface ExampleDrillAttempt {
  id: string
  user_id: string
  playbook_id: string
  example_id: string
  answer: ExampleKind
  expected_kind: ExampleKind
  answered_at: string
  scored: boolean
}

export interface ExampleBackupV1 {
  schema: "mogmine.playbook_examples_backup.v1"
  exported_at: string
  examples: { header: PlaybookExampleHeader; snapshot: PlaybookExampleSnapshot }[]
}
```

### Capture-time validation and storage

- Use the trade's actual candle entry after checking its signature against the displayed trade. Freeze the draft's selected window and source contents when previewing. If the source trade's execution fields or candle signature change before Save, ask the user to reopen the preview. A background arrival of extra bars for the same signature does not replace the previewed evidence. Use `canonicalSymbol()` and `specFor().yahooTicker` to validate against the candle source. Keep instrument identity and provider ticker distinct and retain cash-independent metrics only. The `Demo fixture` source belongs to explicit sample snapshots. Mark volume as `unknown` whenever the existing candle path cannot establish whether values are measured. [Ticker and specs](../../lib/trades.ts#L113) · [Cache signature](../../lib/trades.ts#L683) · [Yahoo volume mapping](../../lib/market-data/yahoo.ts#L55)
- Require a stable owner, an active owned destination other than `no-setup`, a kind, a trimmed verdict of up to 180 characters, and one or more valid completed bars ending at or before the cutoff. Validate input again on Save and recheck the destination immediately before committing. Capture uses a half-open range `[start_time, end_time)`; require `start_time < decision_time < end_time` and include only bars with `time >= start_time` and `time + interval <= end_time`. Cap the initial requested window at 1,500 base intervals to bound validation and payloads. A logged trade's actual entry and exit must have containing bars inside the snapshot. Accept only elapsed base bars with valid grid timestamps, sorted unique times, finite OHLCV, nonnegative volume and valid OHLC ranges. Keep provider prices as returned. Tick-snap user-authored prices explicitly. Derive the decision session with `sessionDate()`, and use the user's chart display timezone for labels. [Types and snapping](../../lib/trades.ts#L20) · [Session handling](../../lib/session.ts#L103)
- Run `expectedInsideBarTimes()` on each requested segment. For the symbols with a modeled session schedule, mark missing expected opens as `partial` and show “Missing bars against regular hours.” Label the cause as unknown. Current calendar checks cover regular MES/MNQ hours and omit holiday and early-close exceptions. Where the symbol has only generic clock-time expectations, use `unknown` coverage. For the decision segment count fully closed pre-cutoff bars. For the outcome segment count fully post-cutoff bars and retain any straddling bar for the full reveal. `unavailable` means zero fully post-cutoff bars captured, even if the straddling bar or a logged exit is available. Determine completeness against the requested range. Otherwise trimming to the last returned bar could make missing follow-through look complete. [Schedule](../../lib/session.ts#L38) · [Trade coverage](../../lib/market-data/coverage.ts#L16) · [Missing-data rules](../08-ux-notes-viewing-and-journaling.md#4-state-matrix)
- When capturing into the trade's assigned playbook, freeze the trade's recorded checklist, including an empty list. For another destination or study capture, freeze the destination's current rule labels. The setup name and thesis always reflect what the destination said on capture day. Start every example rule as `unassessed` and change it only from explicit curator input. Stamp the current capture's verdict, basis, levels and marks with the candle snapshot. Logged execution metrics come from existing trade helpers at capture time. Use `tradePoints()` and `initialRMultiple()`, and use `excursions()` on the captured base bars with its coverage semantics. The result remains the trader's logged result even when the chart exhibits a fill-price mismatch. Keep the annotation off the disputed bar and show a data note. [Trade metrics](../../lib/trades.ts#L196) · [Initial R and excursions](../../lib/trades.ts#L268) · [Detail fill checks](../../components/TradeDetail.tsx#L237)
- Create a dedicated IndexedDB database `mogmine-playbook-examples-v1` with a header store indexed by `[user_id, playbook_id]` and a snapshot store, both keyed by `[user_id, id]`. Use one read/write transaction for the pair, await completion and distinguish a blocked/open/read error, absent payload and invalid payload. A request's success callback is earlier than the transaction commit. A stable draft UUID makes retry idempotent. Repeating Save with the same ID and identical frozen content returns the existing record. Conflicting content under that ID surfaces a conflict. Disable duplicate submission while saving. Re-read metadata on route entry and tab foreground, and invalidate the list on local commit. Lists read headers only. Display newest first, with a stable ID tie-break. Open one snapshot on demand. Soft archive an example through its header and restore it from the archive list. Archive of the parent makes examples read-only and ineligible for drills. If a journal restore removes the parent, retain the evidence in a read-only **Unfiled examples** list using the frozen setup name and recover the original association through the private backup flow.
- Hash the normalized UTF-8 JSON array of `[symbol, provider_symbol, base_timeframe, [[time, open, high, low, close, volume], ...]]` with SHA-256. Recheck the hash, the header identity and count, all discriminators and payload invariants on open/import before rendering or drilling. The digest detects changed candle contents. It offers integrity checking and makes no claim about external authenticity. Save and browse carry no remote dependency. An eventual shared implementation can move the same pair into owner-scoped `playbook_examples` and `playbook_example_candles` records, with owner-scoped parent links, RLS and a single transaction for publishing. Keep list queries off the bar payload. Cross-device persistence deserves its own slice under [the backend boundary](../22-development-mode-and-backend-boundary.md).

## Capture and study

### A. Save from Trade Detail

1. Add **Save as Playbook Example** near the existing Trade Card action, reachable by thumb and away from Remove. Offer it for a real closed trade with a usable entry and exit timestamp and supported market data. While barred by a fresh/missing data state, surface the reason beside the existing Retry action. A closed trade with an undated exit needs the existing date correction before capture. Open trades can be captured after close. Exclude fixture and test trades from this entry point.
2. Start from the finest actually loaded series. Frame up to 30 base slots before the entry bar, the entire hold, and 30 slots after the exit bar, with the standard session schedule determining the initial requested context and follow-through bounds. Show the observed span and any missing/truncated span. This is a **capture** window, independent of the trade chart's zoom. The smallest sheet uses the default crop and exact entry timestamp, with a preview summary showing timeframe, cutoff, end and any coverage warning. A later slice adds a visual preview with accessible start/end and decision controls that preserve both execution anchors.
3. Preselect the trade's owned, active playbook if eligible, otherwise require a destination. If there is no eligible playbook, link to create one in the existing Tune editor and keep the draft in the current session. Require one kind and a verdict. A+ means a textbook instance by the documented criteria. Near-miss means close to the model with a specific deficiency or execution error. Anti-example means a look-alike that fails a defining criterion. Let the curator mark whether the rationale was knowable **At the decision** or is a **Retrospective lesson**, defaulting to retrospective. A lack of later bars can be saved explicitly with the coverage label if required entry/exit anchors and decision context exist. Show **Retry** first if the data is still expected. A missing anchor, mismatched instrument or absent sealed context blocks Save and preserves the worksheet.
4. On commit, show **Saved on this device** and a **View examples** link. Reopen the slice in the viewer from the committed snapshot. Playback and source labels reflect the exact saved data even if the parent rules, trade, chart settings or source cache change. Recordings of later context require an explicit new capture. Archive the earlier snapshot if it has been superseded.

### B. Capture an untraded chart

1. Add a **Study** entry from Playbooks with symbol and session/date selection and a chart built over `loadDayCandles()`. Request a bounded day window through the existing provider-backed route. Show the actual interval and available span, including coarse fallback. Handle weekends, unavailable history, provider errors and stale cached day data. For windows exceeding the route bound, ask the user to choose a narrower range. The fixture preview, if shipped, needs matching validated bars and permanently visible sample labeling. The markup JSON alone supplies levels.
2. Choose a completed candle with a tap or keyboard control, then use **Capture Example**. Set the decision cutoff to that candle's close. Default to 45 base slots leading up to and 45 following the cutoff within the selected source interval. Frame and classify in the same sheet as Flow A. Add authorship and time anchors for selected levels and callouts when that tooling ships. A playbook can be assembled entirely from genuine historical observations without writing any trades.
3. Commit with `historical-capture` provenance. The reveal shows subsequent bars and the authored explanation. The instrument's price move alone supplies no entry, exit, realized R, P&L, MAE/MFE or actual position box. For fixture snapshots show **Sample** in the gallery, viewer and any derived presentation. Use a labeled sample preview for people with an empty library.

### Playbook detail, Examples list and viewer

- Enter through **Tune → Playbooks → View examples** first. Promote to a playbook hub when thesis and tagged-trade stats ship. Put name, style, thesis and rules above the gallery and keep **Examples** reachable without scrolling through a long checklist. Use **All / A+ Exemplars / Near-Misses / Anti-Examples**. List rows show kind, source, symbol and decision session from the header. Use a neutral **Find a closed trade** link for an empty gallery, plus **Study** when Flow B ships. Load the chart only on opening an item. Add thumbnails only if a measured need justifies generating and caching them at capture. [Lists and bars](../../AGENTS.md#3b-additional-guardrails-2026-11-14-review)
- Show **Tagged trades** from `runningStats().byPlaybook` by playbook ID. Counts may show immediately. For rates/averages use the interim minimum of ten observations per relevant denominator, with count shown. Win rate uses `pricedCount`, average R uses `withR` and discloses skipped R, and recorded checklist adherence shows `followed / total` alongside `gradedTrades`. Show the label **Avg R (journal)** because the selector currently uses `rMultiple()` on the journal record. The viewer's per-example **Initial R** is a different denominator definition. Gross is the journal's result basis. Tag or rule edits can affect live stats without revising frozen examples. [Stats selector](../../lib/selectors.ts#L175) · [Stats grouping](../../lib/selectors.ts#L256) · [OD-46 and OD-47](../../DECISIONS.md#2-open)
- Ordinary viewer opens the frozen window, with kind, source, timeframe and coverage, verdict, recorded trade outcome when present, and frozen rule evidence. Provide **Decision view** and **Reveal** once the cutoff logic ships. When start/end clamp panning, show the capture boundary with a concise label. Pan and pinch stay inside the chart. Display real gaps as gaps without synthetic candles. Use the theme-driven Canvas primitives for anchors and any matching actual fills. Match existing fill-only semantics if a position band is added later. When only the renderer fails, keep the validated outcome and verdict readable. [Trade Chart](../../components/TradeChart.tsx#L228) · [Render grammar](../15-trade-document-and-render-grammar.md) · [D-010](../../DECISIONS.md#1-accepted)
- On a missing or invalid snapshot, show a chartless detail with its known metadata, a reason and **Restore from example backup** once available. Offer **Retry device read** only for a blocked or failed read. When a valid snapshot is partial, show its bars with the coverage note. If full post-cutoff bars are absent, label **No follow-through bars captured**. A logged result can still appear with its own source label. A temporary read failure and a missing or corrupt snapshot all exclude the example from scored practice and export.
- For comparison, let the trader pick two saved examples of the same playbook. Start with A+ vs Anti-Example as a shortcut and show the decisive frozen rule plus each rationale if available. Use side-by-side on desktop and labeled **Example A / Example B** tabs on phone so chart gestures remain reserved for charting. Each chart uses its own timeframe and scale, with the cutoff as the shared reference for reading the charts. Render separate rule labels if the source rubrics differ, even if rule IDs match.

### Decision cutoff and frozen context

- Feed a **sealed projection** to the chart. For base duration `d`, it contains only bars with `bar.time + d <= decision_time`. For a 1m trade entry at 09:42:23, show the 09:41 bar and earlier. The completed 09:42 OHLC includes prices from after the decision. A study decision at the close of the 09:42 bar has cutoff 09:43:00 and can use that bar. Pin the guide to the edge of the last eligible bar and show the exact cutoff in text. Store canonical UTC times and convert milliseconds to seconds only at the chart boundary.
- A revealed view uses all captured bars. Mark a cutoff-straddling bar as spanning the decision when relevant. A candle supplies its OHLC, so an entry and exit inside one bar cannot establish the order of the other prices. A coarser toggle appears only where each shown bucket has every expected constituent and lies wholly within the relevant projection, with any omitted boundary buckets or gaps labeled. Slice by the cutoff **before** aggregation and reject any bucket ending after the cutoff. If the resulting coarser view obscures the last completed base context, keep the decision view at the base resolution. Document the actual interval if only coarse bars are available. [Bar-time and aggregation code](../../lib/trades.ts#L319) · [OHLC chronology](../../lib/trades.ts#L527)
- Use a candle-only rendering surface sharing `TradeChart`'s underlying setup and formatting. Trim bars before `setData`, and rebuild the marks, price range, time scale, crosshair and readout entirely from the visible projection. Keep the keyed render state tied to the snapshot and mode. The current time/length-only series key could reuse data for a different example with the same range. Use a snapshot ID or content hash in the source key. Before an answer in a drill, withhold execution overlays, annotations, verdict, rule assessments, results, answer colors and share actions from chart inputs, the DOM and the accessibility tree. The front may show the canonical symbol, clock time, base timeframe, plain frozen rule labels when safe, and neutral verified indicators. After answering, keep the decision chart sealed while showing the classification and rationale. Pass outcome data to the renderer only on **Reveal outcome**. Reveal can initially be instant. Optional playback honors reduced-motion settings. [Series data key and overlays](../../components/TradeChart.tsx#L233)
- Levels enter the snapshot only with matching instrument, session and source. Use a projection of the upstream level model and retain semantic keys, zones and source revision/calc version where supplied. A static decision-side level needs a known `available_at` and a canonical label, and the rendered segment begins no earlier than the first eligible chart point at or after its availability. Apply that check to each dynamic point, using inputs observed by its availability time. Authored or unverified lines stay on the revealed side with their source label. Session VWAP and POC need the appropriate anchor and verified volume, and OR/overnight extremes qualify only for the window actually observed as of the cutoff. Use docs/12's separate settlement and RTH definitions. Keep optional levels empty until the math inputs and timing are verifiable. A written observation about an uncaptured companion such as NQ is a curator note, with no companion trace or independently validated drill criterion in this slice. [Level definitions](../12-levels-zones-and-daily-markup.md) · [Level-set fixture](../../fixtures/levelsets/MES-2026-11-12.json)

## Train

1. **Start a playbook drill.** Choose up to five distinct examples from the active playbook. In the scored deck require a readable and valid snapshot, clean decision coverage under the capture-time schedule check, genuine market bars, a decision-time basis and at least one explicitly assessed frozen rule that the verdict explains using captured evidence. Require a mix of at least two kinds for a scored deck. A smaller or single-kind collection can start unscored practice and show how many other examples are eligible. Archived, retrospective and sample examples can remain in labeled study views. Missing post-cutoff bars allow decision practice when pre-cutoff evidence is complete. The card then reveals the curator's reasoning and a coverage note for the absent aftermath. Warm-up across active playbooks may come later, naming the criterion playbook on each card since the task is classification.
2. **Answer once before the first reveal.** Present the sealed projection and the question with the three canonical choices. On submit freeze an attempt with the expected kind and timestamp. Show **Matches saved classification** or **Saved classification: Near-Miss** and the frozen evidence, then allow **Reveal outcome**. This lets the trader read the rule before seeing the market result. **Skip** advances without creating an attempt. Give unscored practice attempts `scored: false` and keep repeat attempts available for practice history. The playbook's recognition summary uses the first scored answer per example and prints matches / attempts with the sample size. Use an example attempt store scoped by owner and example, with an attempt ID unique per submission. If persistence fails, show the answer as unsaved and allow retry without counting it.
3. **Revisit misses.** Start with an optional deck of examples whose latest scored answer missed. CD-2 offers 1/3/7-day intervals if timed spacing later earns a place in the workflow. Keep the batch and progress outside the trade queue. Revealing or answering a drill affects neither trade assignment nor review status.

## Shield, recovery and portability

- Use Shield's **R and points** treatment on the private viewer for legitimate logged results, hiding dollar values, size and account details. The example snapshot stores no dollar result, quantity, account ID or copied journal notes. Free text can still contain private details. With Shield on, omit custom verdicts, callout text, rule labels, thesis and playbook name unless the mechanism explicitly verifies safe copy. Render safe technical labels and known numeric fields from allowlisted inputs. Apply the same projection to tooltips, accessible labels, chart screenshots and filenames. The owner can turn Shield off for private study.
- For a standalone **example PNG**, generate from the current, share-safe viewer projection through the shared Card System frame and take the chart image with primitives included. Start with 4:5, add the other card sizes after they pass the shared frame checks. Open Share with Shield on and keep the action disabled until the matching preview is ready. Omit arbitrary free text in the Shield PNG. A user wanting to expose copy should see the exact Shield-off preview before export. Keep the CD-3 playbook card treatment for playbook summaries, including its Shield rule for hiding results. Native share is available only on the user's action. [Card rules](../23-card-system.md#1-rules-for-every-card) · [Screenshot path](../../components/TradeChart.tsx#L204)
- First recovery slice adds a **private example backup** with paired headers and complete candle snapshots. State in the initial release that the journal backup excludes examples. Export only validated pairs and surface any skipped IDs. Parse and validate the complete backup before writes. Restore to matching owned parents automatically where the ID and ownership are valid, or let the user explicitly choose an eligible destination for missing parents. An older journal backup can restore the original playbook through the existing Tune path first. A reassignment changes the parent ID with explicit confirmation and retains the historical rubric. Import all pairs in one examples transaction. Same-ID, same-content restores are idempotent and preserve local archive state. A validated import may repair a missing or corrupt payload when its identity and frozen header fields match. Surface a conflict for divergent valid records. A legacy journal restore carries no example operation. Private backups expose frozen text and provenance and should be labeled as private.
- If approved later, a `.mogplaybook.json` sharing package earns its own versioned envelope. Include the selected playbook fields and validated example header/snapshot pairs, with a preview of exactly what will travel. Use a safe-field projection by default, omitting origin IDs, private text and financial results. Never present such an abridged copy as an equivalent backup. If private text is explicitly included, preview it and require the user's share action. Import either creates or picks a destination through the existing editor, assigns locally owned IDs, validates examples before committing pairs and deduplicates retries. Define a portable provenance variant with no source journal reference before enabling import. A package should carry the chart data needed to reopen its examples. A rendered PNG is optional output.

## Thin releases

| Slice | Independently usable result | Release check |
| --- | --- | --- |
| **1. Save and reopen** | Real closed Trade Detail → default-window capture summary, destination, kind, verdict and basis → atomic device save → **View examples** under Tune → interactive base-timeframe chart with source, coverage and frozen verdict. Use the simple candle surface and header list. Keep levels and callouts empty. | Save a non-sample anchored trade, reload, reopen with the app loaded and market requests blocked, then edit the parent, remove the source trade and clear only its candle cache. The saved example still displays the same bars, classification and rule text. A blocked or failed transaction leaves the draft and produces no gallery row. Test on `390×844`. |
| **2. Recover** | Private example backup and restore in Tune, archive access and an unfiled recovery path. | Round-trip a missing-parent example and a normal example, retry the file import and verify identity and ownership. Reject bad hashes, unsupported versions and conflicts without a partial new import. |
| **3. Decision view** | Add context/reveal toggle plus explicit cutoff and framing controls in capture. | Test exact-boundary, intrabar, same-bar entry/exit and rebucketed cutoff cases. Sealed autoscale, time labels, crosshair and accessible output are derived only from eligible data. |
| **4. Annotate the rule** | Add curator assessments and anchored callouts, then verified levels as available. Current examples can be copied into a new frozen version with those assessments, retaining the bars. | Editing a live rule never relabels the frozen rule or an annotation. A level known after the cutoff or derived with unavailable volume fails the projection check. |
| **5. Study capture** | Add an untraded example directly from a bounded historical study chart. | A Yahoo coarse response, stale cached range, missing decision bar, closed market and sample each reach their explicit state. Capture leaves the trade journal and both trade and account stats untouched. |
| **6. Drill** | Single-playbook deck, sealed question, attempt, explanation and optional outcome reveal. | Two same-range examples with different OHLC swap correctly. A winning trap and losing exemplar score by their frozen kind. Verify eligibility, duplicate submit, zero/short deck and write failure. |
| **7. Playbook hub** | Add thesis and tagged-trade stats. Keep the current Tune editor as the editing entry point. | Check denominators with missing R, prices and checklists, plus empty and archived setups. |
| **8. Compare examples** | Pick two examples and read their decision context and frozen rule evidence together. | Compare examples with different rule labels or candle resolutions and gaps in one chart. Mobile tabs and chart gestures work independently. |
| **9. Example PNG** | Share from the frozen viewer through the Card System frame. | Verify privacy changes and rapid view changes invalidate the old prepared PNG. Test chart primitives, safe fields, screenshot failure/retry and native sharing on a phone. A public package or server sync gets its own release after owner approval. |

For the chart slices, check zero horizontal overflow at `390×844`, 44px controls, thumb reach, accessible focus and keyboard paths, tabular numbers, theme and opacity changes without lost zoom, and readable sealed/partial/archived states. Use deterministic fixture bars for verification and a genuine non-sample trade for the first-loop acceptance. Treat the brief's sub-60-second capture as a usability target to measure on a phone. Optimistic save and animation timing guarantees would need their own measured evidence.

## Owner decisions

The proposals reuse `OD-PB-03` through `OD-PB-05` for different topics. Refer to the choices by topic until the owner records the decisions.

| Decision | Recommended default |
| --- | --- |
| Historical study capture | **Allow it after Trade Detail capture.** Untraded examples enable a new playbook before there is execution history. Their source label and absent trade result preserve the distinction. |
| Scope of anti-examples | **Keep one parent playbook.** A later cross-playbook filter can surface traps without creating duplicate records or a second library. |
| Ordinary viewer opening state | **Open revealed in the gallery and sealed in drills.** The former is a labeled study artifact and the latter tests a fresh judgment. |
| Drill entry | **Dedicated Playbook action.** Optionally link from post-review completion. Keep a single fixed trade queue for trade triage. |
| Portable sharing beyond PNG | **Defer editable package sharing.** Ship a private backup first. Decide who will receive editable packages and which authored fields users can choose to send before specifying the shared envelope. |
