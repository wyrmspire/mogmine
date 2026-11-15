# NOTES.md — Current State & Handoffs

The volatile file. `AGENTS.md` says what never changes. This says where things stand today.

- Read this at the start of a session. Update it at the end.
- Newest handoff first. Eight lines or fewer per entry.
- When a note becomes lasting knowledge, move it into `docs/` or `DECISIONS.md` and delete it here.
- Delete entries that no longer help the next person.

---

## Current state (2026-11-15)

- **Branch `ui/phased-improvements` (local, not pushed) holds UI phases 1–3.** Work is paused for the owner to approve [docs/14](docs/14-ui-phased-plan.md) before Phase 4. `main` and the deployed site are unchanged.
- **First frontend is live at `mogmine.vercel.app`.** Ten demo trades use Yahoo Finance 1m candles when available and deterministic fixture candles offline.
- **No TopstepX account yet (`D-009`).** Everything is built and tested on Yahoo data. The plan for that is [docs/10](docs/10-yahoo-first-build-plan.md).
- Specs: `docs/01`–`07` (original), `docs/08` (UX notes), `docs/09` (backend risk register), `docs/10` (Yahoo-first build plan), `docs/11` (mobile workflow and assistant API proposals), `docs/12` (levels, zones and the daily markup), `docs/13` (bold UI bets).
- 26 entries under Open in [DECISIONS.md](DECISIONS.md) (`OD-24`–`OD-26` come from the UI branch); `OD-23` (box styles) was accepted by the owner on 2026-11-14 and only waits to be moved to Decided. `OD-1`, `OD-2`, `OD-4` and `OD-16` matter now. `OD-3` and `OD-7` are parked until there is a broker account. `OD-17`–`OD-22` are product proposals; they do not expand approved scope.
- **Times display in Central Time** (`lib/time.ts`), the owner's zone. Storage stays UTC and session math stays `America/New_York`.
- `mogprompt.md` and `docs/` still disagree on many names. The interim rule is that `docs/` wins. The full list is in the [drift register](DECISIONS.md#3-spec-drift-register).
- The development machine had neither Node nor Python installed on 2026-11-14. Node is needed before anything can be scaffolded.

## Next up

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
| Chart | agent (Codex) | 2026-11-14 | Phase 4 issue chain on `feat/phase4-chart-windows` |
| App shell and notes | agent (Codex) | 2026-11-14 | Phase 4 labels, filters and no-data state |
| Data | — | | |
| Market data | — | | |
| Ingestion | — | | |
| AI review | — | | |

## Handoff log

### 2026-11-14 (night CT) — agent (Claude Code) — Chart + App shell and notes, branch `ui/phased-improvements`
Did:      UI phases 1–3, three local commits (`c74bbae`, `685319b`, `5a9f8c6`): routes and a real Today/Feed on phones, device store without inline candles, Position Box rewrite and in-place timeframe switch, Pit Stop, checklist, review queue. Plan and open questions in `docs/14`; `OD-24`–`OD-26` opened.
Verified: `npx tsc --noEmit` clean; `npm run lint` 0 errors, 1 old warning; `npm test` 10/10; `npm run build` passes. Headless Chrome at 390×844 and 1280×900: no overflow, no console errors; touch swipe on the chart scrolls the page. No real phone, no iOS, share sheet untested.
Left:     Stopped on the owner's instruction. Phase 4 (chart window from each trade's duration, `OD-24`) is specified in docs/14 §3 and not started. Tune is a placeholder; the Trade Card is still the old one-button version. Specs not yet updated for the differences listed in docs/14 §7.
Watch:    Known fault: short trades draw as tiny boxes because the window uses three fixed buckets (`fitPadding`). Nothing is pushed. Commits are authored "Claude Code" because the machine has no git identity. Old `v1`/`v2` localStorage is left in place on purpose.

### 2026-11-14 (evening CT) — agent (Grok Bot) — levels docs + CT display
Did:      Ported `docs/11`–`13`, `fixtures/levelsets/MES-2026-11-12.json` and their pointer edits from the pre-PR#1 snapshot (base `7c3d8fa`). Added `lib/time.ts`; `TradeJournal`/`TradeChart` show CT (list, header, Trade Card, axis, crosshair); manual entry reads typed times as CT.
Verified: `npx tsc --noEmit` and `npm run build` pass. `npm run lint`: the same 7 errors as `main` (refs/setState in `TradeJournal`), none new. CT parse/format checked across both DST switches with the device set to Tokyo. Markdown link check: 0 broken.
Left:     Level sets and zones are not in code: the chart still draws one dotted `KEY` line per trade. Next step: render `fixtures/levelsets/` on `TradeChart` in the docs/12 style (red resistance, green support, yellow ADR, gray neutral, zones as bands, white right-edge labels), as a draft the owner publishes, never auto-published. Move `OD-23` to Decided.
Watch:    The display zone is a constant, not yet the UX-86 preference. Day ticks on the chart axis are relabelled only at CT midnight because the library places them at UTC midnight.

### 2026-11-15 — agent (Codex Work) — Market data + demo set
Did:      Added a server-side Yahoo Finance adapter/API, ten seeded MES/MNQ trades, existing-storage migration, source labels and offline fixture fallback.
Verified: Vercel build READY at commit e4a5857; production page returned 200 with 10 trades; Yahoo route returned 1,810 NQ=F candles; runtime error scan was clean.
Left:     Yahoo candles are fetched per opened trade and cached only on-device. The Supabase daily archive from M0 is still pending.
Watch:    Yahoo may throttle hosted requests, so every trade retains its complete fixture chart.

### 2026-11-14 — agent (Codex Work) — Chart + app shell and notes
Did:      Scaffolded the first Next.js frontend; added offline fixtures, adaptive trade review, v5 Canvas PositionBoxPrimitive, manual entry, local-first notes, and private Trade Card sharing.
Verified: Local source checks passed before publication; npm install was blocked by the executor network (403), so Vercel preview build is the package/type/build verification.
Left:     Supabase, Yahoo archive and owner auth are not wired; the preview deliberately uses fixture candles and localStorage. No Topstep work was added.
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
