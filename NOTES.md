# NOTES.md — Current State & Handoffs

The volatile file. `AGENTS.md` says what never changes. This says where things stand today.

- Read this at the start of a session. Update it at the end.
- Newest handoff first. Eight lines or fewer per entry.
- When a note becomes lasting knowledge, move it into `docs/` or `DECISIONS.md` and delete it here.
- Delete entries that no longer help the next person.

---

## Current state (2026-11-15)

- **`main` holds UI Phases 1–4, accessibility (#19), Shield mode (#15), backup (#18), and the honest-box cleanup (#30, #31)**: duration-fitted chart windows, a 45-bar floor (`MIN_FITTED_BARS = 45`), duration-derived timeframes, TP/SL/exit autoscale, fill-only position boxes with path lines and KEY levels, no on-chart P&L pill or axis tags, and real Yahoo Finance market bars only.
- **First frontend is live at `mogmine.vercel.app`.** Ten demo trades use real Yahoo Finance candles only; without market bars they show no chart.
- **Which build is where.** `mogmine.vercel.app` served a bundle containing `America/Chicago` (`lib/time.ts`) at 21:28 CT on 2026-11-14, so it is serving `main` at or after PR #2 (CT). The Vercel preview for branch `app/first-trade-review` (`aaed7af`) predates PR #2 and still shows ET. Vercel reports successful builds for both heads. Which branch Vercel calls Production was not read from Vercel's settings: unverified.
- **Phone behaviour is not verified.** Builds and Yahoo responses passed; persistence, gestures and native sharing have not been checked on a phone (`AC-11`).
- **No TopstepX account yet (`D-009`).** Everything is built and tested on Yahoo data. The plan for that is [docs/10](docs/10-yahoo-first-build-plan.md).
- Specs: `docs/01`–`07` (original), `docs/08` (UX notes), `docs/09` (backend risk register), `docs/10` (Yahoo-first build plan), `docs/11` (mobile workflow and assistant API proposals), `docs/12` (levels, zones and the daily markup), `docs/13` (bold UI bets).
- Open decisions in [DECISIONS.md](DECISIONS.md) include `OD-24`–`OD-27` from the UI branches; `OD-27` records the mathematical conflict between the bar floor (now 45 bars, owner 2026-11-15; was 30) and a 35% minimum box width for very short fixtures. `OD-15` (`MES` → `MES=F`, `MNQ` → `MNQ=F`, no mini fallback, levels match chart instrument) is Decided and implemented. `OD-23` (box styles) was accepted by the owner on 2026-11-14 and only waits to be moved to Decided. `OD-1`, `OD-2`, `OD-4` and `OD-16` matter now. `OD-3` and `OD-7` are parked until there is a broker account. `OD-17`–`OD-22` are product proposals; they do not expand approved scope.
- **Times display in Central Time** (`lib/time.ts`), the owner's zone. Storage stays UTC and session math stays `America/New_York`.
- `mogprompt.md` and `docs/` still disagree on many names. The interim rule is that `docs/` wins. The full list is in the [drift register](DECISIONS.md#3-spec-drift-register).

## Next up

M0 and M1 are done only when their acceptance criteria hold: `AC-01` – `AC-11` in [docs/10 §7](docs/10-yahoo-first-build-plan.md#acceptance-criteria-for-m0-and-m1).

1. **Start the candle archive** ([docs/10 §3](docs/10-yahoo-first-build-plan.md#3-start-the-candle-archive-first)). It is the only task that loses data by waiting: `1m` bars older than 30 days cannot be fetched.
2. Owner decides `OD-16` (build order) and `OD-2` (auth and RLS from the first migration).
3. Scaffold one Next.js app with a Supabase project, RLS on, and `market_candles` (M0).
4. Build the `core` money and session math with golden tests, then one trade on one chart (M1).
5. Owner decides `OD-1`, then freeze or reconcile `mogprompt.md` using the drift register.
6. When a TopstepX account exists: ask Topstep to confirm in writing that a read-only cloud service is allowed (B-01), then reopen `OD-3` and `OD-7`.

## Lanes

Claim a lane before starting. Clear the claim when you stop.

| Lane | Claimed by | Since | Working on |
| :--- | :--- | :--- | :--- |
| Core math | — | | |
| Chart | — | | |
| App shell and notes | — | | |
| Data | — | | |
| Market data | — | | |
| Ingestion | — | | |
| AI review | — | | |

## Handoff log

### 2026-11-15 — agent (Grok Bot) — integration/batch6 default is the 45-bar trade window
Did:      Opening visible range is the standard `fitWindow` (30% lead-in / 50% hold / 20% after-exit) at `max(45, the trade's own window)`. Removed the 2.5× zoom-out multiplier Chris rejected. Fit stays an optional View action. Held-range re-apply after setData is unchanged.
Files:    `lib/trades.ts`, `lib/__tests__/core.test.ts`, `components/TradeChart.tsx`, `NOTES.md`.
Left:     Draft PR #107 against main, stacked on #100. Do not merge or deploy.

### 2026-11-15 — agent (Grok Bot) — integration/batch6 sample fixture pad
Did:      Expanded `fixtures/sample-bars.json` with real unmodified Yahoo 1m bars for the Nov 8–13 Globex week (MES=F / MNQ=F), shared across the ten samples so 1m/5m/15m/1h all open with at least 45 bars. Existing hold-window OHLC is unchanged (fills still snap). `getSampleCandles` serves the shared series by symbol; samples still never fetch at runtime.
Files:    `fixtures/sample-bars.json`, `lib/candles.ts`, `lib/__tests__/sample-bars.test.ts`, `lib/__tests__/honest-box.test.ts`, `NOTES.md`.
Left:     Draft PR #107 against main, stacked on #100. Do not merge or deploy. Keep the fixture out of printcode/gitrdif dumps.

### 2026-11-15 — agent (Grok Bot) — integration/batch6 follow-up (zoom, KEY, X-Ray)
Did:      The zoomed-out default now re-applies after Lightweight Charts setData/layout so it is not replaced by an automatic tight fit. `defaultVisibleRange` shows at least 45 bars when that many candles are loaded (`to - from`, with `to = barCount` when showing the whole series). The gold KEY pill is gone; the key level is a faint muted dotted line with no label. X-Ray is removed (View toggle, hold-X, `setXray`, primitive fade).
Files:    `lib/trades.ts`, `lib/__tests__/core.test.ts`, `components/TradeChart.tsx`, `components/TradeDetail.tsx`, `components/PositionBoxPrimitive.ts`, `NOTES.md`.
Left:     Sample fixtures are often only as long as the hold, so a 5m view of `mnq-trend-hold` has ~14 candles even when fully zoomed out. Real Yahoo windows are already padded 15 hours.


### 2026-11-15 — agent (Grok Bot) — integration/batch6
Did:      Draft integration of #80 (gold for good process only), #81 (R strip), #82 (slim toolbar, zoomed-out default, Fit as an option), #83 (data-notes chip), #84 (two-step entry), and #85 (11px type floor, Inter + JetBrains Mono). Chart opens wide (>= 45 bars via defaultVisibleRange); fitWindow goldens unchanged. View menu labels Simple / After exit. Data-notes chip is amber only for missing/partial coverage. Levels grid kept, with Add stop/target/key on Trade Detail. Kept #71 out.
Left:     Draft PR against main, stacked on integration/batch5 (#100). Do not merge or deploy.


### 2026-11-15 — agent (Claude Haiku 5.5) — issue #85 type floor and fonts, branch `feat/85-type-floor-fonts`
Did:      Raised every sub-11px font-size in `app/globals.css` (9px and 10px rules, incl. `font:` shorthands) to `0.6875rem`. Loaded Inter and JetBrains Mono with `next/font/google` in `app/layout.tsx`; `--font-sans`/`--font-mono` now start with those variables. Fallback stacks unchanged.
Verified: `npm test` 112/112, `npm run typecheck` and `npm run build` exit 0. Lint: 0 errors, 1 pre-existing warning in `postcss.config.mjs`. Headless Chrome at 390×844 on Today, Feed, Review, Tune and Trade Detail: 0px horizontal overflow, no text under 11px, both fonts report `loaded`.
Left:     Feed, Review and Tune were probed for overflow and small text only, not inspected visually. Not tested at 360px. Do not merge without Chris.
Watch:    `next/font/google` fetches fonts at build time; a build with no network access will fail rather than fall back.

### 2026-11-15 — Codex — `feat/84-two-step-entry` (#84)
Did:      Manual entry now saves only the required execution fields, keeps its draft on close, and opens the new trade detail route; stop, target and key remain nullable.
Detail:   Trade Detail adds missing plan levels inline with existing tick/side validation; RiskChips remain for stop sizing and Shield masks dollars. Level controls remain available without candles.
Spec:     Updated docs/12 to put LV-17 sizing after the execution save. Chart renderer, formulas and fixtures are unchanged.
Verified: `npm test` 113/113; typecheck; lint 0 errors/1 permitted PostCSS warning; build 8/8 pages; headless Chrome at 390px had zero horizontal overflow and passed draft/save/validation/Shield checks.
Left:     No code items. Physical-phone verification was not available.

### 2026-11-15 — agent (Claude Haiku) — Data-notes chip (#83), branch `feat/83-data-notes-chip`
Did:      Trade Detail data-quality notes (1m, continuous contract, coverage, same-bar, stop/target/exit) collapse into one "N data notes" chip (44px, tap to expand). Hindsight unchanged. No chip when there are no notes.
Amber:    Only when bar coverage is missing or partial (MAE/MFE and bar check untrusted). All other notes muted. Chris to confirm (DECISIONS OD-36).
Files:    `lib/data-notes.ts`, `components/DataNotesChip.tsx`, `components/TradeDetail.tsx`, `app/globals.css`, `lib/__tests__/data-notes.test.ts`, `docs/08`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm test` 122/122, `npm run typecheck` clean, `npm run lint` 0 errors (1 pre-existing PostCSS warning), `npm run build` OK.
Left:     No browser check at 390px yet. Draft PR against integration/batch5, do-not-merge-without-Chris.

### 2026-11-15 — agy (gemini-3.8-flash-high) — Chart toolbar slim & default zoom (#82)
Did:      Issue #82: slimmed Trade Detail toolbar to 1 row at 390px (timeframe switch + View button). Folded Fit, detail level (Simple / After exit), X-Ray, fullscreen, and 30-bar extensions into View menu. Moved ‹ › to 44px edge hits on chart. Implemented Chris's decision: charts open zoomed out by default (wide context >= 45 bars via `defaultVisibleRange`), Fit is an option in View menu and reports not-fitted initially. Preserves user pan/zoom across timeframe changes. Zero gold used on toolbar chrome/View.
Files:    `components/TradeDetail.tsx`, `components/TradeChart.tsx`, `lib/trades.ts`, `lib/__tests__/core.test.ts`, `app/globals.css`, `NOTES.md`.
Verified: `npm test` (113/113 passed), `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing warning in postcss.config.mjs), `npm run build` (8/8 static pages).
Left:     PR against integration/batch5 (do-not-merge-without-Chris). Simple / After exit visible labels open to owner preference.

### 2026-11-15 — agent (Grok Bot) — follow-up on `feat/82-slim-toolbar` (#82)
Did:      Raised View menu labels from 9–10px to the 11px floor (sibling #85). Programmatic range updates clear their flag on a microtask so the default zoomed-out view is not treated as a user pan.
Files:    `app/globals.css`, `components/TradeChart.tsx`, `NOTES.md`.

### 2026-11-15 — agent (Grok Bot) — App shell, branch `feat/81-r-strip` (#81)
Did:      Replaced the Feed and Review sparkline with an R strip (stop left, target right, entry tick, exit marker, faint MAE/MFE). A larger copy sits under the Trade Detail chart; the six-cell levels grid is kept. Works in Shield and with no candles. Blind review hides the exit/MAE/MFE. Layout is a pure helper with unit tests.
Files:    `lib/rstrip.ts`, `lib/__tests__/rstrip.test.ts`, `components/RStrip.tsx`, `components/TradeRow.tsx`, `components/ReviewScreen.tsx`, `components/TradeDetail.tsx`, `app/globals.css`, `NOTES.md`.
Left:     Sparkline component is unused by Feed/Review but left in the tree.

### 2026-11-15 — agent (Grok Bot) — App shell, branch `feat/80-gold-good-process` (#80)
Did:      Gold is reserved for good process only: the full-rules seal, checked checklist rules, Today's "By the rules" / day-head process score, and the clean-process header glow. Selected and active chrome (timeframes, pills, dock, focus rings, primary buttons, brand mark, Shield switch) now use plain white. Tune gold preset and intensity still preview the process gold.
Files:    `app/globals.css`, `components/TuneScreen.tsx`, `NOTES.md`.
Left:     Share-card RULES seal stays gold (good process). Gold presets remain a Tune control.


### 2026-11-15 — agent (Grok Bot) — integration/batch5
Did:      Draft integration of #78 (Low hindsight one-liner), #79/#77 (first-load P&L), #97/#96 (#87+#88 Trade Card lazy + current view), #92/#65 (session coverage), #95/#90 (market-data expected coverage), #93 (Tune Shield risk mask), #94/#91 (docs stale/no-purple), #98/#86 (candle refetch), and #99/#89 (sample fixture bars). Kept #71 out. Composed #65+#90 so coversTradeWindow uses Globex hours when a symbol is passed. Composed #86+#90 so a cache is reused only when it covers the trade window and the hindsight window, or is refetched after session close. Samples load from sample-bars.json and never hit Yahoo.
Left:     Draft PR against main, do-not-merge-without-Chris. Do not merge or deploy. Holiday calendar remains OD-35. The reported $140 then $171 pair was not a current fixture P&L.


### 2026-11-15 — agent (Antigravity) — Runtime sample bars from fixture (#89)
Did:      Issue #89: sample trades render 1m bars from `fixtures/sample-bars.json` at runtime with no Yahoo or /api/market-data calls. Restored truthful CandleSource "Demo fixture" and updated Tune copy to match. Real trades continue fetching Yahoo and caching in IndexedDB. Added locking tests in `lib/__tests__/sample-bars.test.ts`.
Files:    `lib/candles.ts`, `lib/trades.ts`, `lib/store.ts`, `components/TradeDetail.tsx`, `components/TuneScreen.tsx`, `lib/__tests__/sample-bars.test.ts`, `NOTES.md`.
Verified: `npm test` 85/85, `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing PostCSS warning), `npm run build` (8/8 static pages).
Left:     Draft PR against main (#89), do-not-merge-without-Chris.

### 2026-11-15 — Codex — Market data, branch `feat/86-candle-refetch` (#86)
Did:      Refetch matching candle caches only after their 17:00 New York hindsight window closes and only when bar coverage is short; replace the same signature-keyed IndexedDB entry.
Also:     Shared DST-safe session-close math with hindsight, made coarse final bars count through close, and extended overnight Yahoo request windows through the assigned close.
Tests:    Fake cache/clock cases cover open, closed-partial, closed-complete, coarse bars, signature changes, DST, maintenance-hour and weekend assignment.
Verified: `npm test` 88/88; typecheck and build pass; lint 0 errors/1 existing PostCSS warning.
Left:     Nothing open for #86. No fixtures, chart styling, R, stats, deployment, M0 archive, or PR #71 changed.

### 2026-11-15 — agent (Claude Haiku 5.5) — docs stale cleanup, branch `feat/91-docs-stale` (#91)
Did:      CONTRIBUTING §2 says the app is live on `main` (no "no code yet"). docs/14 intro and table show Phases 1–5 on `main`, Phase 6 not started. docs/12 §9 and `OD-23` restated to D-010 (faint red/green plan fills, stronger result-colour actual band, no outline, no purple or teal). `OD-33` marked restated, owner to review.
Left:     PR for #91 is do-not-merge-without-Chris. Archived-box outline (docs/12 §9) is not covered by D-010 and is unchanged. docs/15 still lists an optional `PLAN` tag; D-010 does not.

### 2026-11-15 — agent (Antigravity) — App shell and notes, branch `feat/17-tune-shield-risk`
Did:      Shield mode masks Tune risk budget: heading hides ($ USD), readout and input display "Hidden", quick chips omitted, and hint explains turning Shield off changes the dollar amount. Input is disabled/readOnly with accessible label. Pure display helper added with focused tests.
Files:    `lib/prefs.ts`, `components/TuneScreen.tsx`, `app/globals.css`, `lib/__tests__/tune-prefs.test.ts`, `NOTES.md`.
Verified: `npm test` 83/83 passed; `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing warning), `npm run build` passed.
Left:     PR against main, do-not-merge-without-Chris.

### 2026-11-15 — agent (Claude Haiku) — issue #90 market-data coverage (branch `feat/90-market-data-coverage`)
Did:      `/api/market-data` accepts a timeframe only when `coversTradeWindow` (new `lib/market-data/coverage.ts`) holds: entry bar, exit bar and every bar inside the hold from the shared `expectedInsideBarTimes`. Thin or gapped sets fall through, then 404. `lib/candles.ts` uses the same test for cached and fresh sets. `lib/trade-bar-validation.ts` now imports the shared helper instead of its private copy.
Verified: `npm test` 89 pass (was 81); typecheck clean; lint 0 errors, 1 pre-existing warning; `npm run build` passes.
Left:     Not run against live Yahoo. Trades that span the 17:00–18:00 ET maintenance break get no complete set until #65 narrows the expected bars to Globex hours, so they will 404 instead of showing a thin chart. Owner decides whether full-bar coverage is too strict.
Watch:    Strict coverage can push a trade with one 1m gap to 5m or 1h. Chris to confirm before merge (PR is do-not-merge-without-Chris).

### 2026-11-15 — agent (Codex) — Core math, branch `feat/65-session-coverage`
Did:      Issue #65: shared MES/MNQ expected-bar logic now omits the regular 17:00–18:00 ET halt and Friday 17:00–Sunday 18:00 ET weekend closure for coverage and excursions.
Files:    `lib/session.ts`, `lib/{trade-bar-validation,trades}.ts`, `lib/__tests__/session-coverage.test.ts`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm test` 86/86; typecheck/build pass; lint 0 errors/1 existing PostCSS warning.
Left:     Holidays and early closes still appear as missing evidence until an authoritative calendar is chosen (`OD-35`). Do not merge without Chris.

### 2026-11-15 — agent (Grok Bot) — Chart + App shell, branch `feat/87-trade-card-current-view` (#87)
Did:      Trade Card now rebuilds from the live screenshot after pan, pinch, fit, or ‹30/30› when the sheet is already open (AC-10). Stacks on #88 (lazy build); notes typing still does not encode. A leftover blob is dropped on a closed-sheet redraw so the next open is current.
Files:    `components/TradeDetail.tsx`, `NOTES.md`.
Verified: `npm test` / typecheck / lint / build to be recorded in the PR.
Left:     None for AC-10. Native share on a real phone is still AC-11.

### 2026-11-15 — agent (Grok Bot) — Chart + App shell, branch `feat/88-trade-card-lazy` (#88)
Did:      Trade Card PNG is built lazily when the sheet opens (or when Shield is toggled on an open sheet), not on every Trade Detail redraw. A notes typation pause no longer re-screenshots the chart or re-encodes the 1080×1350 card. The Trade Card button is enabled once candles are ready; the sheet shows its existing preparing state until the blob lands.
Files:    `lib/shareCard.ts`, `lib/__tests__/core.test.ts`, `components/TradeDetail.tsx`, `NOTES.md`.
Verified: `npm test` / typecheck / lint / build to be recorded in the PR.
Left:     After pan, pinch, or ‹30/30› an already-open (or previously prepared) card can still be stale until the sheet is opened again — that is issue #87 (AC-10), a sibling branch.

### 2026-11-15 — agent (Claude Haiku 5.5) — `feat/hindsight-low-summary`
Did:      Low chart detail no longer hides the after-exit hindsight. It now shows the hindsight sentence as one compact line (tap reveals the full text, sentence plus `TP +Nm` / `SL +Nm`). Medium is unchanged (button, one-tap helper, expand). Hindsight is computed whenever the chart is ready. Chart primitive untouched: Low still hides the dotted continuation.
Files:    `lib/hindsight.ts` (`hindsightCollapsedText`, `hindsightExpandedText`), `lib/__tests__/hindsight.test.ts`, `components/TradeDetail.tsx`, `app/globals.css` (`.hindsight-line`), `NOTES.md`.
Watch:    Low one-liner truncates with an ellipsis on phones; the full text is one tap away. Still does not change R, P&L, outcome or stats.
Open:    Do-not-merge without Chris (PR title and body say so).

### 2026-11-15 — agent (Grok Bot) — Chart + App shell, branch `feat/77-pnl-first-load` (#77)
Did:      First-load P&L flicker. Trade Detail (and Feed) painted `serverState` sample money before `hydrateJournal` ran in `useEffect`, so a stale device copy could replace — or be replaced by — the fixture P&L after first paint. Both screens now wait for hydration (as Today/Review already did). Hydration runs in `useLayoutEffect`. Stale sample prices are still refreshed in one `hydrateJournal` update; tested with an MNQ copy that priced at $140 vs the fixture $720.
Left:     PR against main, do-not-merge-without-Chris. The reported $140 then $171 pair is not a current fixture P&L; the locked case is stale-device $140 vs current fixture math, with no post-paint jump.


### 2026-11-15 — agent (Grok Bot) — integration/batch4 cleanup before merge
Did:      Stripped UX/Invariant codes from Tune captions (plain wording only). Trade Card outcome subline now wraps instead of ellipsizing, so R and points stay visible in the preview.
Left:     Ready for Chris's approved merge of PR #76. Do not squash. PR #71 stays open.

### 2026-11-15 — agent (Grok Bot) — integration/batch4
Did:      Draft integration of PRs #72 (after-the-exit), #73 (trade document spec, no-purple docs fix), #74 (Tune screen), and #75 (Trade Card sheet). Kept #71 (M0 archive) out. Resolved TradeDetail so hindsight (‹30/30›, Medium continuation, off-chart later-touch text) and the Trade Card sheet (privacy re-render, Share/Save/Copy) both land. NOTES handoffs from all four branches kept.
Left:     Draft PR against main, do-not-merge-without-Chris. Do not merge or deploy until Chris says so.

### 2026-11-15 — agent (Codex) — Chart + App shell, branch `feat/16-trade-card-sheet`
Did:      Issue #16: preview sheet, Shield re-render, prepared Share/Save/Copy, zoned entry/exit, playbook/tags/frozen-rules card copy.
Files:    `lib/shareCard.ts`, `components/{TradeCardSheet,TradeDetail}.tsx`, `app/globals.css`, `lib/__tests__/core.test.ts`, `NOTES.md`.
Verified: `npm test` 64/64; typecheck/build pass; lint 0 errors/1 existing PostCSS warning; 390×844 Chrome had 390px scroll width and working preview/privacy/actions.
Left:     Native iOS share-sheet remains untested, as allowed by issue #16. No publish, deployment or primitive rebuild.

### 2026-11-15 — agent (Antigravity) — App shell and notes, branch `feat/17-tune-screen`
Did:      Issue #17 (Phase 5: Real Tune screen). Wired controls on `/tune` for Position Box opacity (Invariant 5), gold preset and intensity (`GOLD_PRESETS`: bullion, champagne, amber, platinum), blue/orange palette (UX-80), risk budget ($10–$100,000, default $250 with quick chips), show/hide samples, and Shield mode toggle; kept time zone and backup intact.
Files:    `components/TuneScreen.tsx`, `lib/prefs.ts`, `app/globals.css`, `lib/__tests__/tune-prefs.test.ts`, `NOTES.md`.
Verified: `npm test` (73/73 passed), `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing warning), `npm run build` (8/8 static pages), 390×844 Chrome render check.
Left:     PR against main (#17), do-not-merge-without-Chris.

### 2026-11-15 — agent (Grok Bot) — Chart, branch `feat/37-after-the-exit` (#37)
Did:      After-the-exit hindsight. Medium detail (the default) draws dotted faint-gray entry, faint-red stop, and faint-green target lines past the exit, with hollow later-touch dots and no on-chart text. Low detail hides them. ‹ 30 / 30 › widen the view by 30 bars of the current timeframe ([ / ], Fit restores). The "held to plan" sentence is computed in `lib/hindsight.ts` and shown one tap away under "After the exit — hindsight". Never changes R, outcome, or stats.
Files:    `lib/hindsight.ts`, `lib/__tests__/hindsight.test.ts`, `components/{PositionBoxPrimitive.ts,TradeChart.tsx,TradeDetail.tsx}`, `NOTES.md`.
Verified: see the PR description for command output.
Left:     Do not merge without Chris. #34 (buildMarks) can later absorb the continuation segments. Extra candles are not fetched when a tap runs out; the button says "No more candles". Optional post-exit excursion bracket stays off.
Watch:    Dotted continuation is on by default at Medium, per the owner's 2026-11-15 decision on #37. No purple, no end labels, no 'after exit' chart text; later-touch times live in the hindsight block.

### 2026-11-15 — agent (Claude Haiku 5.5) — Trade document spec (docs only), branch `feat/32-trade-document-spec` (#32)
Did:      Added `docs/15-trade-document-and-render-grammar.md` (design §2 and §5 with the 2026-11-15 owner decisions, hindsight summary, open items `OD-30`–`OD-34`). Updated `docs/02` §2 to the box as built. Committed seven examples to `fixtures/trades/`. Index pointers in README, AGENTS, CONTRIBUTING; DECISIONS D-010 and OD-30–34. Follow-up commits restated D-010 / docs/15 to fills-only (no purple, no outlines) to match the owner's standing chart rule and the PR #72 review.
Verified: `npm test` 64/64; `typecheck` and `build` exit 0; `lint` 0 errors, 1 pre-existing warning (`postcss.config.mjs`).
Left:     PR against main, do-not-merge-without-Chris. `OD-30`–`OD-34` await the owner. No code. `deriveTrade` and `buildMarks` are #33 and #34.
Watch:    The design file on the box is `trades-on-chart-design-and-plan.md`, not the `position-box-answer.md` the issue cites. Its §2.3 dollar figures assumed five contracts; doc 15 uses the two-contract examples.



### 2026-11-15 — agent (Grok Bot) — Core math + App shell, branch `feat/batch3-coverage-daystats`
Did:      Issues #60 and #61. `validateTradeAgainstBars` now requires both entry and exit candles for `complete` coverage, and reports `chronology` separately (`unresolved` when entry and exit fall in the same bar). `fillInsideBar` returns false when the bar is missing. `dayStats` exposes `gross` (not `net`), priced/unpriceable counts, an `incomplete` flag, and a win rate over priced trades only. Today and the day header label the total "gross" and show a quiet incomplete cue.
Files:    `lib/trade-bar-validation.ts`, `lib/trades.ts`, `lib/selectors.ts`, `components/{DayHeader,TodayScreen,TradeDetail}.tsx`, `app/globals.css`, `lib/__tests__/core.test.ts`, `NOTES.md`.
Verified: see the PR description for command output.
Left:     PR against main, do-not-merge-without-Chris. Issue #65 (session-aware expected coverage) is filed only, not implemented.
Watch:    `DayStats.net` was renamed to `gross`. Callers must use the new field. Win rate is `wins / pricedCount`, not `wins / count`.

### 2026-11-15 — agent (Claude Haiku 5.5) — Sample fixture versions, branch `feat/batch3-fixture-version` (#62)
Did:      Samples carry `fixture_version` (`DEMO_FIXTURE_VERSION = 1`) and `annotations_modified`. `updateTrade` sets the flag when an annotation value changes. `applyFixtureRefresh` takes an optional `previous` fixture and refreshes untouched default annotations, keeping edited ones. Open edge case: `OD-29`.
Verified: `npm test` 57/57 (new `lib/__tests__/fixture-version.test.ts`), typecheck, build pass. Lint has one warning in `postcss.config.mjs`, unchanged from main.
Left:     Lane claims not changed. Legacy samples whose default changed in an older build are kept until a snapshot is supplied (`OD-29`).

### 2026-11-15 — agent (Antigravity) — Core math + Chart, branch `feat/batch3-calc-alignment`
Did:      Issues #63 & #64: plannedR rejects wrong-side target and target at entry; tradeTicks returns null for invalid quantity; isScratch returns false when quantity is invalid or trade cannot be priced; alignTradeToBars / TradeChart preserves alignment kind and marks nearby (OD-28 cap kept) as approximate with quiet chart cue (softened fill, thinner/dotted path, tiny ≈).
Files:    `lib/trades.ts`, `components/PositionBoxPrimitive.ts`, `components/TradeChart.tsx`, `lib/__tests__/validation.test.ts`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm test` (51/51 pass), `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing warning), `npm run build` (8/8 static pages).
Left:     Ready for review; PR against main opened referencing #63 and #64; do-not-merge-without-Chris.

### 2026-11-15 — agent (Antigravity) — Core math + App shell and notes, branch `feat/53-54-cleanup-review-status`
Did:      Issues #53 and #54: removed dead mergeAxisTags, AxisTag, axis title helpers and tests; removed orphaned .style-pill CSS; committed package-lock.json; fixed classifyTrade to compare raw elapsed ms (<15m scalp boundary) with tests; updated deriveReviewStatus to count pre_trade_thesis, management_notes, post_exit_notes, checklist_state, and take_again as review evidence; tightened stale bullets in NOTES.md.
Files:    `lib/trades.ts`, `app/globals.css`, `lib/__tests__/core.test.ts`, `lib/__tests__/honest-box.test.ts`, `NOTES.md`, `package-lock.json`.
Verified: `npm test` (33/33 pass), `npm run typecheck`, `npm run lint` (0 errors, 1 pre-existing PostCSS warning), `npm run build` (8/8 static pages).
Left:     Ready for review; PR opened to main referencing #53 and #54.
Watch:    holdSeconds() display rounding is untouched; only classifyTrade compares raw milliseconds.

### 2026-11-15 — agent (Claude) — Validation and bar alignment, branch `feat/50-51-validation-alignment`
Did:      Fixed #50: `specFor` returns null for unknown contracts (no fallback spec); `canonicalSymbol` maps `mes` to `MES`; money and R functions return null for an unknown symbol, non-finite price, off-tick price, quantity that is not a whole number of 1 or more, or a stop on the wrong side. `validateTradeInput` checks executions before save. The add-trade form rejects off-tick prices instead of snapping them. Fixed #51: `alignToBar` returns containing, nearby (3 bars, max 30 minutes, OD-28) or unresolved. `snapToBar` returns null when unresolved. The chart hides the box then.
Files:    `lib/trades.ts`, `lib/format.ts`, `lib/store.ts`, `lib/describe.ts`, `lib/selectors.ts`, `lib/shareCard.ts`, `components/{AddTradeSheet,RiskChips,TradeChart,PositionBoxPrimitive,TradeRow,TradeDetail,ReviewScreen}.tsx`, `lib/__tests__/{honest-box,validation}.test.ts`, `docs/{02,07}*.md`, `DECISIONS.md` (OD-28), `NOTES.md`.
Verified: see the PR description for the command output.
Left:     Backup import keeps trades with an unknown symbol or a stored quantity of 0 or 1.5 and shows their money as "—". It does not drop or repair them. (`package-lock.json` was committed on #57.)
Watch:    `tradePnl`, `tradePoints`, `tradeTicks`, `rMultiple`, `plannedR`, `initialRiskUsd` now return `number | null`. Callers must handle null. `formatMoney` and `formatPoints` take null and show "—".

### 2026-11-15 — agent (Codex) — Chart, branch `feat/phase4-chart-windows`
Did:      Fixed #28: series + primitive autoscale include planned TP/SL and exit; Fit restores price autoscale; every sample has a target; generated sample candles/sparklines are removed; missing data renders no chart.
Files:    `components/{PositionBoxPrimitive,TradeChart,TradeDetail}.tsx`, `lib/{candles,fixtures,store,trades}.ts`, `lib/__tests__/core.test.ts`, `docs/{02,07,08,14}*.md`, `NOTES.md`.
Verified: `npm run build` passed (8/8 pages); `npm run lint` 0 errors/1 existing PostCSS warning; `npm run typecheck` clean; `npm test` 17/17.
Verified: app route returned 1,730/1,805 real Yahoo `NQ=F` 1m bars; 390×844 Chrome had 390px scroll width, no console/request errors, and a forced 404 rendered 0 chart hosts while details remained.
Artifacts: `/workspace/phase4-scalp.png` (13m, 30 bars, 43.33%) and `/workspace/phase4-90min.png` (90m, 36×5m bars, 50%); both visibly show TP and SL.
Left:     Nothing pushed or merged. `package-lock.json` remains untracked and uncommitted. No real-phone/iOS Safari pass was performed.

### 2026-11-14 (night CT) — agent (Codex) — Chart + App shell and notes, branch `feat/phase4-chart-windows`
Did:      Implemented issues #13, #10, #11, #12, #25 and #14 as separate commits: removed duration-category UI, fitted windows from hold duration, added the 30-bar floor and duration timeframes, and removed the no-data chart fallback.
Files:    `components/`, `lib/`, `app/globals.css`, `docs/02`, `docs/05`, `docs/07`, `docs/08`, `docs/14`, `DECISIONS.md`, `NOTES.md`.
Verified: `npm run lint` 0 errors/1 existing PostCSS warning; `npm run typecheck` clean; `npm test` 16/16; `npm run build` completed 8/8 static pages.
Verified: 390×844 Chrome pass across all 10 samples: zero overflow/errors/removed labels; 1m→15m context 180→450 minutes; only TradingView attribution is under 44px.
Artifacts: `/workspace/phase4-scalp.png` (13-minute hold, 43.3%) and `/workspace/phase4-90min.png` (90-minute hold, 50%).
Left:     Nothing pushed. Owner should decide `OD-27`; 2-, 5- and 7-minute floor-bound fixtures are truthfully 7%, 17% and 23% of 30 bars rather than the issue's impossible 35% minimum.
Watch:    `package-lock.json` remains untracked and uncommitted as requested. No real-phone/iOS Safari pass was performed.

### 2026-11-14 (night CT) — agent (Antigravity) — Market data + Chart, branch `feat/27-mes-feed`
Did:      Implemented `#27` (`OD-15` decided): mapped `MES` → `MES=F` and `MNQ` → `MNQ=F` in `lib/trades.ts` (`FUTURES_SPECS` + `normalizeTrade` ticker migration), updated `lib/market-data/yahoo.ts` Invariant 3 comment (no `ES=F`/`NQ=F` fallback), scoped IndexedDB candle cache keys and signatures by Yahoo ticker in `lib/store.ts` and `lib/candles.ts`, added unit tests in `lib/__tests__/core.test.ts`, and updated `DECISIONS.md`, `AGENTS.md`, `docs/02`, `docs/07`, `docs/09`, `docs/10`, `docs/12`, `docs/14`, `mogprompt.md`, and `fixtures/levelsets/MES-2026-11-12.json`.
Verified: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.
Left:     Unblocks drawing daily levels (`#26`) since chart and fixture both use `MES=F`.
Watch:    Existing stored trades with `yahoo_ticker: "ES=F"` for `MES` migrate to `"MES=F"` on load, and old `ES=F` IndexedDB cache entries are ignored because cache keys and signatures now include the Yahoo ticker.

### 2026-11-15 — agent (Antigravity) — App shell and notes + Chart, branch `feat/19-accessibility`
Did:      Phase 6 accessibility pass (#19) in `app/globals.css`, `components/*`, `lib/theme.ts`, `lib/__tests__/core.test.ts`: `rem` typography & fluid grids for large text (UX-85), `>= 44px` tap targets on segmented/suggest/toast/chart-note/topnav buttons, `--text-faint` contrast raised to `#7b8498` (`>= 4.77:1`), blue/orange box frame + result pill text/dashed border (UX-80), skip link, modal focus trap & dialog guard for `J`/`K`/`F`/`N`/`C`/`X`, valid ARIA on badges/switches/chips/status skeletons (UX-83, UX-84).
Verified: `npm test` (11/11), `npm run typecheck`, `npm run lint` (0 errors, 1 existing warning), `npm run build` pass. Headless Chrome across `/`, `/feed`, `/trades/[id]` (winner, no-stop, missing), `/review`, `/tune` + `AddTradeSheet` at 390×844 (100%, 125%, 150% font scale) and 1280×900 with `prefers-reduced-motion: reduce`, `data-palette="blue-orange"`, and `--gold-intensity: 0`: 0 horizontal overflow, 0 missing accessible names, 0 sub-44px targets, 0 console errors.
Left:     No real iPhone / iOS Safari or native iOS share sheet available in this Linux container; Phase 5 Tune controls (sliders/palette switcher UI, backup) and the new Trade Card sheet live on sibling branches and should be re-checked on hardware after merge.
Watch:    Keep `.pill` and `.save-status` as `position: relative` so `.visually-hidden` children never widen scroll containers.
### 2026-11-14 (late CT) — agent (Antigravity) — App shell and notes, branch `feat/18-journal-backup`
Did:      Phase 5 journal backup on `/tune` (#18): added `buildBackup` and `parseBackupFile` in `lib/store.ts`, `getPrefs` in `lib/prefs.ts`, Download backup and Restore from file with confirmation and validation in `components/TuneScreen.tsx`, and unit tests in `lib/__tests__/core.test.ts`.
Verified: `npm run typecheck` clean; `npm run lint` 0 errors (1 pre-existing warning in `postcss.config.mjs`); `npm test` 12/12 pass; `npm run build` passes.
Left:     Sibling Tune controls (box opacity, gold preset/intensity, palette, risk budget, show/hide samples) belong to their sibling Phase 5 issue.
Watch:    Backups store trades and preferences only (`includesCandles: false`); charts re-fetch Yahoo Finance candles on open and samples keep their fixture bars.
### 2026-11-14 — agent (Codex) — App shell and notes (released), branch `feat/20-home-screen-icons`
Did:      Issue #20: added opaque MogMine 180/192/512 PNG icons, manifest/head links, and a one-time iOS browser Home Screen hint with durable seen state and dismissal.
Verified: `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`: all exit 0; lint has the existing `postcss.config.mjs` warning, tests 11/11. `git diff --check` exit 0.
Verified: Production server returned 200 for manifest, SVG, all PNGs; head links resolved. Playwright at 390×844: hint shown once, 50×44 dismiss target, `scrollWidth 390 <= clientWidth 390`, dismissed and suppressed on reload.
Left:     Real-iPhone Add to Home Screen installation/icon check remains outstanding; no physical iOS device is available here.
Watch:    `package-lock.json` was already untracked before this work and is intentionally not part of issue #20.

### 2026-11-14 (night CT) — agent (Claude Code) — Chart + App shell and notes, branch `ui/phased-improvements`
Did:      UI phases 1–3, three local commits (`c74bbae`, `685319b`, `5a9f8c6`): routes and a real Today/Feed on phones, device store without inline candles, Position Box rewrite and in-place timeframe switch, Pit Stop, checklist, review queue. Plan and open questions in `docs/14`; `OD-24`–`OD-26` opened.
Verified: `npx tsc --noEmit` clean; `npm run lint` 0 errors, 1 old warning; `npm test` 10/10; `npm run build` passes. Headless Chrome at 390×844 and 1280×900: no overflow, no console errors; touch swipe on the chart scrolls the page. No real phone, no iOS, share sheet untested.
Left:     Stopped on the owner's instruction. Phase 4 (chart window from each trade's duration, `OD-24`) is specified in docs/14 §3 and not started. Tune is a placeholder; the Trade Card is still the old one-button version. Specs not yet updated for the differences listed in docs/14 §7.
Watch:    Known fault: short trades draw as tiny boxes because the window uses three fixed buckets (`fitPadding`). Nothing is pushed. Commits are authored "Claude Code" because the machine has no git identity. Old `v1`/`v2` localStorage is left in place on purpose.

### 2026-11-14 (late evening CT) — agent (Grok Bot) — M0/M1 acceptance from owner review
Did:      Added `AC-01`–`AC-11` to `docs/10` §7 (M0: repeatable upserts, bounded backfill, coverage per symbol/session, retries and visible failure, recovery test; M1: per-trade coverage and refresh, gaps and incomplete candles, safe writes, gross P&L and tick validation, Trade Card follows the view, phone E2E). Linked them from the M0/M1 rows, `docs/09` (B-10, B-47, B-61, M0/M1 list) and `docs/08` (§4 state row, §16 checklist). Annotated the 2026-11-15 Codex entry.
Verified: Each finding read in code on `main` `d93583f`; file:line references are in the AC table. Markdown relative-link check: 0 broken. Docs only, no code changed.
Left:     Nothing is built. Priority: coverage (AC-03, AC-06, AC-07), safe writes (AC-08), recovery test (AC-05). Vercel's Production branch setting is unverified (see Current state).
Watch:    The deployed `app/first-trade-review` preview still shows ET; `main` and `mogmine.vercel.app` show CT.

### 2026-11-14 (evening CT) — agent (Grok Bot) — levels docs + CT display
Did:      Ported `docs/11`–`13`, `fixtures/levelsets/MES-2026-11-12.json` and their pointer edits from the pre-PR#1 snapshot (base `7c3d8fa`). Added `lib/time.ts`; `TradeJournal`/`TradeChart` show CT (list, header, Trade Card, axis, crosshair); manual entry reads typed times as CT.
Verified: `npx tsc --noEmit` and `npm run build` pass. `npm run lint`: the same 7 errors as `main` (refs/setState in `TradeJournal`), none new. CT parse/format checked across both DST switches with the device set to Tokyo. Markdown link check: 0 broken.
Left:     Level sets and zones are not in code: the chart still draws one dotted `KEY` line per trade. Next step: render `fixtures/levelsets/` on `TradeChart` in the docs/12 style (red resistance, green support, yellow ADR, gray neutral, zones as bands, white right-edge labels), as a draft the owner publishes, never auto-published. Move `OD-23` to Decided.
Watch:    The display zone is a constant, not yet the UX-86 preference. Day ticks on the chart axis are relabelled only at CT midnight because the library places them at UTC midnight.

### 2026-11-15 — agent (Codex Work) — Market data + demo set
Did:      Added a server-side Yahoo Finance adapter/API, ten seeded MES/MNQ trades, existing-storage migration, source labels and an offline fixture fallback (the fallback was later removed by issue #28).
Verified: Vercel build READY at commit e4a5857; production page returned 200 with 10 trades; Yahoo route returned 1,810 NQ=F candles; runtime error scan was clean.
Correction (2026-11-14, owner review): "Verified" above covers server function only (build, page load, Yahoo route). Phone persistence, gestures and native sharing were not checked on a phone and still need an end-to-end check (`docs/10` `AC-11`).
Left:     Yahoo candles are fetched per opened trade and cached only on-device. The Supabase daily archive from M0 is still pending.
Watch:    Superseded by issue #28: Yahoo may throttle hosted requests, and no generated fallback chart is allowed.

### 2026-11-14 — agent (Codex Work) — Chart + app shell and notes
Did:      Scaffolded the first Next.js frontend; added offline fixtures, adaptive trade review, v5 Canvas PositionBoxPrimitive, manual entry, local-first notes, and private Trade Card sharing.
Verified: Local source checks passed before publication; npm install was blocked by the executor network (403), so Vercel preview build is the package/type/build verification.
Left:     Supabase, Yahoo archive and owner auth are not wired; the original preview used generated candles, removed later by issue #28. No Topstep work was added.
Watch:    Trade Card generation uses takeScreenshot(true). Re-check iOS share/copy and the 390×844 acceptance flow on the deployed preview.

Format:

```text
### YYYY-MM-DD — who (person or agent + tool) — lane
Did:      what changed, with file paths
Verified: commands run and the result, or "not verified"
Left:     what is unfinished or assumed
Watch:    anything the next person will trip over
```

### 2026-11-14 — agent (Grok Bot, trade helper) — levels proposal, no lane
Did:      Added `docs/12` and `fixtures/levelsets/MES-2026-11-12.json`. Pointer rows in README, AGENTS, CONTRIBUTING; notes in docs/02, 04, 06, 08. Opened `OD-20`–`OD-23`.
Verified: Thu 2026-11-12 ADR (141.73), pivots and ON high/low recomputed from Yahoo `MES=F` bars; `git apply --check` on the snapshot. No code exists.
Left:     Owner decides `OD-20`–`OD-23`; assistant drafts wait on `OD-19`, series on `OD-15`.
Watch:    Yahoo `1d` bars are labelled by Globex start date (docs/12 LV-02).

### 2026-11-14 — agent (Codex) — App shell and notes (released)
Did:      Added `docs/11-product-workflows-and-api-context.md`: daily planning/capture, detail/full-chart controls, domain-anchored comments, indicator definitions, assistant permissions and review scenarios. Added open `OD-17`–`OD-19`; aligned older UX passages with existing guardrails. Documentation only.
Files:    `AGENTS.md`, `CONTRIBUTING.md`, `DECISIONS.md`, `NOTES.md`, `README.md`, `docs/01-architecture-and-stack.md`, `docs/02-charting-position-boxes-and-divergence.md`, `docs/03-trade-cards-and-note-taking.md`, `docs/04-ai-review-engine.md`, `docs/05-mobile-ux-and-gold-design-system.md`, `docs/06-data-model-and-roadmap.md`, `docs/08-ux-notes-viewing-and-journaling.md`, `docs/11-product-workflows-and-api-context.md`.
Verified: `git diff --check` exited 0 (line-ending notices only). Reviewed `git diff -- docs/01-architecture-and-stack.md docs/02-charting-position-boxes-and-divergence.md docs/03-trade-cards-and-note-taking.md docs/04-ai-review-engine.md docs/05-mobile-ux-and-gold-design-system.md docs/06-data-model-and-roadmap.md docs/08-ux-notes-viewing-and-journaling.md README.md DECISIONS.md` and read the new document in full.
Verified: Inline PowerShell audit (`& ([scriptblock]::Create((Get-Content -LiteralPath (Join-Path $env:TEMP 'mogmine-doc-audit.ps1') -Raw -Encoding UTF8)))`) exited 0: “Markdown files checked: 17”; “Relative file links checked: 160”; “New-document anchors checked: 8”; “Open decisions: 19; references resolved; table contiguous”; “Documentation issues: 0”.
Left:     Owner review of detail defaults, indicator anchors/bands/BE, daily-plan scope, assistant authorization and “trade copy”. No endpoint/schema decisions, app code, browser tests or new vendor verification. `D-009` and build-order interim rules remain in force.
Watch:    Direct `.ps1` invocation was blocked by Windows execution policy; the audit ran inline without changing policy. New product ideas remain proposals, not accepted decisions. `mogprompt.md` reconciliation is still `OD-1`.

### 2026-11-14 (later) — agent (Claude Code) — Yahoo measurements and build order, no lane
Did:      Added `docs/10`. Recorded `D-009`, `OD-15`, `OD-16`. Replaced second-hand Yahoo limits with measured ones in `docs/09` B-11 and B-12, `AGENTS.md` §3b, `docs/02` and `mogprompt.md`.
Verified: Called Yahoo's chart endpoint from this machine for `ES=F`, `NQ=F`, `MES=F`, `MNQ=F`, `^VIX`, `DX-Y.NYB`. `1m` accepted to 30 days back and 8 days per request, `5m`/`15m`/`30m` to 60 days, `1h` to 730 days. Link check: 0 broken.
Left:     No archiver exists yet. Whether Yahoo delays the newest bars is still unknown (market was closed).
Watch:    Yahoo serves `MES=F` and `MNQ=F` as real, separate series, which contradicts the premise of Invariant 3 (`OD-15`). Measurements were from a desktop. Yahoo may throttle a hosted server.

### 2026-11-14 — agent (Claude Code) — docs review, no lane
Did:      Added `docs/08`, `docs/09`, `DECISIONS.md`, `CONTRIBUTING.md`, `NOTES.md`, PR template. Updated `AGENTS.md`, `README.md`, `mogprompt.md`, appended entries to `.gitignore`, and added pointer callouts to `docs/01`–`07`.
Verified: Vendor facts checked against Topstep, ProjectX, lightweight-charts, Vercel, Cloud Run and Supabase docs. See `docs/09` §10. No code exists, so nothing was run.
Left:     Nothing committed. The schema changes in `docs/09` §8 are proposals. The DDL in `mogprompt.md` §12 is unchanged and still has the problems listed there.
Watch:    Items marked `?` in `docs/09` §10 are unverified. Yahoo and iOS push facts come from secondary sources.

## Parking lot

Ideas that are not specified yet. Promote to a spec or delete.

- **Topstep risk rail on Today:** distance to the daily loss limit and trailing drawdown, read from the account stream.
- **Weekly review:** one insight a week from tags and directives, in place of a dashboard.
- **Personal rules:** the trader's own stop rules ("two losses, then stop"), surfaced quietly when they apply.
- **Auto-detected "Moved Stop":** from the order event log (B-07), so the trader does not have to tag it.
