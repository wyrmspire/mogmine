# NOTES.md — Current State & Handoffs

The volatile file. `AGENTS.md` says what never changes. This says where things stand today.

- Read this at the start of a session. Update it at the end.
- Newest handoff first. Eight lines or fewer per entry.
- When a note becomes lasting knowledge, move it into `docs/` or `DECISIONS.md` and delete it here.
- Delete entries that no longer help the next person.

---

## Current state (2026-11-15)

- **Branch `feat/phase4-chart-windows` (local, not pushed) holds UI Phase 4 and the #28 follow-up**: duration-fitted chart windows, a 30-bar floor, duration-derived timeframes, TP/SL/exit-aware price autoscale, and no generated candle fallback. `main` and the deployed site are unchanged.
- **First frontend is live at `mogmine.vercel.app`.** Ten demo trades use real Yahoo Finance candles only; without market bars they show no chart.
- **Which build is where.** `mogmine.vercel.app` served a bundle containing `America/Chicago` (`lib/time.ts`) at 21:28 CT on 2026-11-14, so it is serving `main` at or after PR #2 (CT). The Vercel preview for branch `app/first-trade-review` (`aaed7af`) predates PR #2 and still shows ET. Vercel reports successful builds for both heads. Which branch Vercel calls Production was not read from Vercel's settings: unverified.
- **Phone behaviour is not verified.** Builds and Yahoo responses passed; persistence, gestures and native sharing have not been checked on a phone (`AC-11`).
- **No TopstepX account yet (`D-009`).** Everything is built and tested on Yahoo data. The plan for that is [docs/10](docs/10-yahoo-first-build-plan.md).
- Specs: `docs/01`–`07` (original), `docs/08` (UX notes), `docs/09` (backend risk register), `docs/10` (Yahoo-first build plan), `docs/11` (mobile workflow and assistant API proposals), `docs/12` (levels, zones and the daily markup), `docs/13` (bold UI bets).
- Open decisions in [DECISIONS.md](DECISIONS.md) include `OD-24`–`OD-27` from the UI branches; `OD-27` records the mathematical conflict between the bar floor (now 45 bars, owner 2026-11-15; was 30) and a 35% minimum box width for very short fixtures. `OD-15` (`MES` → `MES=F`, `MNQ` → `MNQ=F`, no mini fallback, levels match chart instrument) is Decided and implemented. `OD-23` (box styles) was accepted by the owner on 2026-11-14 and only waits to be moved to Decided. `OD-1`, `OD-2`, `OD-4` and `OD-16` matter now. `OD-3` and `OD-7` are parked until there is a broker account. `OD-17`–`OD-22` are product proposals; they do not expand approved scope.
- **Times display in Central Time** (`lib/time.ts`), the owner's zone. Storage stays UTC and session math stays `America/New_York`.
- `mogprompt.md` and `docs/` still disagree on many names. The interim rule is that `docs/` wins. The full list is in the [drift register](DECISIONS.md#3-spec-drift-register).
- The development machine had neither Node nor Python installed on 2026-11-14. Node is needed before anything can be scaffolded.

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
| Chart | Codex | 2026-11-15 | Issue #29 sample/bar coherence and exit validation |
| App shell and notes | — | | |
| Data | — | | |
| Market data | — | | |
| Ingestion | — | | |
| AI review | — | | |

## Handoff log

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
