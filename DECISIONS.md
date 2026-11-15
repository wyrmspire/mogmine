# DECISIONS.md — Decision Log

One place for what has been decided, what is still open, and where the specs disagree. Check here before re-arguing a choice or inventing a name.

- **Accepted** decisions are settled. Changing one needs a new entry that supersedes it.
- **Open** decisions have a recommendation and an interim rule. Follow the interim rule until the owner closes the item.
- To close an item: set the status, date and decider, then update the affected spec in the same PR.
- Humans and agents may add open items. Only the project owner closes them.

---

## 1. Accepted

| ID | Decision | Where it is specified |
| :--- | :--- | :--- |
| D-001 | Next.js (App Router, TypeScript, Tailwind, PWA) on Vercel | [docs/01](docs/01-architecture-and-stack.md) §1A |
| D-002 | Supabase for Postgres, Realtime and Storage | [docs/01](docs/01-architecture-and-stack.md) §1B |
| D-003 | Persistent broker connections run only on Google Cloud Run | [AGENTS.md](AGENTS.md) Invariant 4 |
| D-004 | `lightweight-charts` with Canvas series primitives for all chart overlays | [AGENTS.md](AGENTS.md) Invariant 1 |
| D-005 | Candles are persisted when a trade is logged and read from the database first | [AGENTS.md](AGENTS.md) Invariant 2 |
| D-006 | External services sit behind `MarketDataProvider`, `TradeIngestionAdapter`, `ReviewContextPlugin` | [AGENTS.md](AGENTS.md) Invariant 6 |
| D-007 | Single user first, `user_id` on core tables from the start | [AGENTS.md](AGENTS.md) Invariant 7 |
| D-008 | Contract point values come from one `FUTURES_SPECS` table | [docs/07](docs/07-agent-guardrails-and-smart-notes.md) Recipe 5 |
| D-009 | **No broker account yet.** Until a TopstepX account exists, Yahoo Finance is the only data source and the app is built and troubleshot against it. Trades come from manual entry, a test-trade tool and fixtures. Decided by the owner, 2026-11-14. | [docs/10](docs/10-yahoo-first-build-plan.md) |
| **OD-15** | **Chart `MES` on Yahoo `MES=F` and `MNQ` on `MNQ=F`, with no `ES=F` / `NQ=F` fallback.** Levels are computed from and drawn on the same instrument as the chart (`MES=F` for `MES`). Candle cache keys include the Yahoo ticker so old `ES=F` bars are never shown for `MES`. Decided by the owner (Chris), 2026-11-14. | [AGENTS.md](AGENTS.md) Invariant 3, [docs/02](docs/02-charting-position-boxes-and-divergence.md) §4, [docs/10](docs/10-yahoo-first-build-plan.md) §4, [docs/12](docs/12-levels-zones-and-daily-markup.md) LV-06 |

---

## 2. Open

Raised by the 2026-11-14 reviews and product discussion. Evidence and detail are in [docs/09](docs/09-backend-risk-register.md) (`B-nn`), [docs/08](docs/08-ux-notes-viewing-and-journaling.md) (`UX-nn`), [docs/10](docs/10-yahoo-first-build-plan.md), [docs/11](docs/11-product-workflows-and-api-context.md) and [docs/12](docs/12-levels-zones-and-daily-markup.md).

| ID | Question | Recommendation | Interim rule | Changes |
| :--- | :--- | :--- | :--- | :--- |
| **OD-1** | `mogprompt.md` and `docs/` use different names for the same things (§3). Which wins? | `docs/` is canonical for names. `mogprompt.md` is the long-form narrative and holds the only full DDL. Reconcile it in one pass. | `docs/` names win. Columns that exist only in the `mogprompt.md` DDL are kept. Never invent a third name. | `mogprompt.md` §3, §5, §10, §12 |
| **OD-2** | Auth and RLS now or in Phase 5? | Now. Without them the database is publicly readable and writable (B-40). One allow-listed user, sign-ups off, RLS on every table. | Build as if accepted. No table ships without RLS. | `docs/01` §2, `docs/06` roadmap |
| **OD-3** | How do trades get in first? | A stateless REST pull (`Trade/search`) behind a **Sync** button and a schedule comes first. It is needed anyway for reconciliation (B-03). The SignalR listener follows as a latency upgrade. All server code is read-only against the broker, and Topstep's written confirmation is recorded here (B-01). | No code may reference order-mutation endpoints. | `docs/06` Phases 1 and 4, `mogprompt.md` §13 |
| **OD-4** | Per-trade candle windows or a session-keyed cache? | Session-keyed `market_candles`, filled by a daily archive that runs whether or not a trade happened ([docs/10 §3](docs/10-yahoo-first-build-plan.md#3-start-the-candle-archive-first)). That replaces most of the three enrichment passes (B-10, B-13). `trade_candles` remains the per-trade read path. | Do not build a single fetch-at-close. | `docs/02` §4, `docs/06`, `docs/07` Recipe 3 |
| **OD-5** | Fills attached to trades, or a fill ledger with derived trades? | Ledger first, trades derived by one pure function, allocation table for reversals (B-04 – B-06). | New schema work follows [docs/09 §8](docs/09-backend-risk-register.md#8-proposed-schema-changes). | `docs/06` ERD, `mogprompt.md` §12 |
| **OD-6** | Which `lightweight-charts` version, and how is the companion pane built? | Pin `5.3.x`. The recipes already use v5 type names, so "v4+" is inaccurate. Use native panes for the stacked companion view (UX-27). Shift timestamps through one `toChartTime()` helper (B-22). | Write against v5. | `AGENTS.md` wording, `docs/02`, `docs/07` Recipe 2 |
| **OD-7** | Where do primary-instrument candles come from? | ProjectX `retrieveBars` for the traded contract. Yahoo for companions and macro tickers (B-12). | Keep both behind `MarketDataProvider`. Record `provider` per row. | `docs/02` §4, `docs/06` Phase 5 |
| **OD-8** | How is the Trade Card image produced? | Compose on a canvas or render on the server from the uploaded chart snapshot. `html-to-image` is fragile on iOS Safari. | Whatever the path, the image is ready before the Share tap (UX-70). | `docs/03` §1 |
| **OD-9** | Does the `investment` style fit Topstep accounts? | Topstep accounts must be flat before a daily cut-off (exact time not verified). Multi-day holds cannot happen there. Reshape the third bucket as "extended intraday" and drop the 5–7-day window until another broker needs it. | Keep the enum value. Do not build multi-day chart logic yet. | `docs/02` §3, `docs/07` Recipe 3 |
| **OD-10** | How is R defined when a trade scales in or out? | `R = P&L ÷ initial risk $` (B-32). Decide gross or net. | `null` without a stop. Never `0`. | `docs/07` Recipe 5 |
| **OD-11** | Per-trade push or a session digest? | Digest on by default, per-trade off (UX-60, UX-61). | No push work before the in-app flow is solid. | `docs/05` §1.2, `mogprompt.md` §8 |
| **OD-12** | Which review fields does the model produce? | Facts from code, judgments from the model, hindsight labelled (B-62, B-63). | The model never outputs a number the code can compute. | `docs/04` §3 |
| **OD-13** | Is a wide-screen layout in scope for v1? | Yes, as a three-pane layout from 1024 px (UX-68). Mobile stays the acceptance viewport. | Do not ship layouts that are a stretched phone column. | `docs/05` |
| **OD-14** | What is in the first usable version? | The "First" column of [docs/08 §15](docs/08-ux-notes-viewing-and-journaling.md#15-build-order-for-the-experience). | Finish a column before starting the next. | `docs/06` roadmap |
| **OD-16** | Is the plan the right size and in the right order? | No. Build in the milestone order of [docs/10 §7](docs/10-yahoo-first-build-plan.md#7-step-back-is-this-the-right-way-to-build-it): archive, one trade on one chart, feed and notes, context, AI, broker. Park Cloud Run, Realtime, push, the monorepo split, the preset switcher and the chart image as AI input until each is proven needed. Start as one Next.js app. | The `docs/06` roadmap stands until the owner decides. The candle archive (M0) starts regardless, because it is the only task that loses data by waiting. | `docs/06` roadmap, `docs/01`, `CONTRIBUTING.md` §2 |
| **OD-17** | How do Low/Medium/High detail, full-chart mode, comments, levels/zones and saved trade views fit together? What did “trade copy” mean? | Independent detail and full-chart controls; stable domain anchors, collapsed comments and an accessible context list; preserve zoom and historical object revisions. See [docs/11 §2–3](docs/11-product-workflows-and-api-context.md#2-detail-and-full-chart-mode-are-separate). | Product proposal only. Keep existing Simple/Advanced note modes; do not interpret detail as note mode or “trade copy” as broker order copying. No new schema or defaults until reviewed. | docs/02, docs/03, docs/05, docs/06, docs/08 |
| **OD-18** | Which indicator definitions and defaults: session/weekly VWAP, 200 EMA, bands, and the undefined “BE”? | Versioned code calculations shared by API/UI; explicit timeframe, price basis, seed/warm-up, session/week anchors, band formula and coverage. Resolve the existing VWAP anchor drift. See [docs/11 §4](docs/11-product-workflows-and-api-context.md#4-indicator-context-is-reproducible). | Do not choose an anchor, formula, band type or BE meaning silently. Mark unavailable coverage; AI never computes indicator values. | docs/02 §6, docs/06, drift register VWAP anchor |
| **OD-19** | Which daily planning, unassigned capture and external-assistant operations belong in scope, and how are clients authorized? | Reuse Today/Playbooks/Review Queue; distinguish reusable setups from revisioned daily plans. Assistants read bounded context and create drafts through validated domain tools with revocable access. See [docs/11 §1](docs/11-product-workflows-and-api-context.md#1-the-daily-loop-beyond-the-chart) and §5. | Product proposal only; no additional first-release commitment or endpoint/table names. Preserve `D-009`, `OD-14` and `OD-16`. No external write access before ownership, permissions, revisions and retry behavior are specified and tested. | docs/01, docs/03, docs/04, docs/06, docs/08 |
| **OD-20** | Fixed-column `session_levels`, or revisioned level sets? | `level_sets`, `level_zones` and `levels` with stable keys and revisions; trades freeze `levels_at_entry`; zone labels join with ` / ` ([docs/12 §4, §6](docs/12-levels-zones-and-daily-markup.md#6-data-model-proposed-shape)). | Proposal only, like `OD-19`. No level columns added to `session_levels`. | docs/06, docs/08 UX-21, docs/09 §8 |
| **OD-21** | Are `PDH` / `PDL` / `PDC` the prior RTH or the prior Globex session? | Globex session high/low and settlement, matching the owner's markup. RTH values become `rth_high`, `rth_low`, `rth_close` ([docs/12 §3](docs/12-levels-zones-and-daily-markup.md#3-level-types-and-formulas)). | Store both; label by type. | docs/02 §6, `mogprompt.md` §7 |
| **OD-22** | Level colours by type or by role? | By role for the daily set: red resistance, green support, yellow ADR, gray neutral, white right-edge labels, from tokens ([docs/12 §5](docs/12-levels-zones-and-daily-markup.md#5-style-spec)). | Read colours from tokens only. | docs/02 §6 |
| **OD-23** | How are planned, actual and archived boxes told apart, given UX-80 uses dashes for risk? | **Owner accepted 2026-11-14:** planned purple solid with a `PLAN` tag (no dashes, so UX-80 stays as written), actual teal solid, archived dotted with no price-axis labels ([docs/12 §9](docs/12-levels-zones-and-daily-markup.md#9-position-boxes-sizing-and-the-three-styles)). | Build Actual first. | docs/02 §2, docs/08 UX-80 |
| **OD-24** | Is there a session-length trade category, and how is the chart window sized? | **Owner approved 2026-11-14:** there is no such interface category. The fitted window comes from each trade's own duration on a continuous scale: twice the hold, with 30% before entry and 20% after exit, plus a floor of about 30 bars (raised to 45 by the owner on 2026-11-15). Timeframes show different context. Whether the stored `trade_style` field stays for the AI lens (docs/04 §2) is still open. | Do not add interface that depends on `scalp` / `session_90m` / `investment`. Keep the stored field, but derive the chart and initial timeframe from hold duration. | docs/02 §3, docs/04 §2, docs/05 §1, docs/06 `trade_style`, docs/07 Recipe 3, drift register "Fitted trade window" |
| **OD-25** | Keep blind review? It was built on `ui/phased-improvements` as an off-by-default switch on `/review` before any bet in docs/13 was approved. | Keep it off by default and try it on trades older than a week (BET-03). | Stays off by default. No other bet is built without approval. | docs/13 §4, docs/08 §7 |
| **OD-26** | Which playbooks, tags and checklist rules? The app ships fixed defaults from the docs/03 examples in `lib/playbooks.ts`, with no editor. | Owner supplies the real list; an editor waits for the database. | Treat the defaults as placeholders. | docs/03 §2, docs/06 `playbooks` |
| **OD-27** | How should Phase 4's 35–60% visual band apply when the approved bar floor binds? With the 45-bar floor (owner, 2026-11-15) the 2.5-, 3.5-, 5.5-, 7.5- and 8-minute samples occupy only about 6%, 8%, 12%, 17% and 18% of a truthful 45-bar time axis; holds under 22.5 minutes on 1m are floor-bound. | Exempt floor-bound holds from the percentage band. Never stretch the Position Box beyond entry and exit merely to pass a visual target. | The approved 45-bar floor and truthful timestamps win; record floor-bound exceptions in the handoff. | docs/14 §3, issue #14 |
| **OD-28** | How far may a fill snap to a bar it is not inside (issue #51)? A fill with no containing bar snaps to a nearby bar only within 3 bars of that bar and 30 minutes of clock time, or else gets no box. Ties go to the earlier bar. | Proposal from the agent (feat/50-51-validation-alignment). The cap is a clock limit, not an exchange calendar, so it cannot tell holidays from halts. | Keep the tight cap, or the owner names another. A session calendar is not built until the owner asks. | docs/02 §2, docs/07 Recipe 1, `lib/trades.ts` `alignToBar` |

`OD-3` and `OD-7` depend on a broker account. Under `D-009` they are parked, not rejected.

---

## 3. Spec drift register

`mogprompt.md` and `docs/` were written separately and disagree in the places below. Under the `OD-1` interim rule the `docs/` column is canonical. Two developers who each follow a different column will produce code that does not fit together.

| Topic | `docs/` (interim canonical) | `mogprompt.md` |
| :--- | :--- | :--- |
| Trade style columns | `trade_style`, `style_overridden`, `hold_seconds` | `trade_archetype`, `archetype_overridden`, `hold_duration_seconds` |
| Style type | `TradeStyle` | `TradeArchetype` |
| `MarketDataProvider` | `name`, `resolveProviderSymbol()`, `getCandles()`, `supportsTickData()` | `providerId`, `resolveProviderTicker()`, `fetchCandles()`, `supportsTickResolution()` |
| Symbol type | `string` | `CanonicalSymbol` union |
| `TradeIngestionAdapter` | `source`, `ingest()` | `adapterSource`, `processPayload()` |
| Ingestion sources | `topstepx_stream`, `csv_import`, `manual_entry` | `topstepx_signalr`, `csv_import`, `manual_terminal` |
| Execution input | `RawExecutionInput` (`externalFillId`, `filledAt`, `commission?`) | `RawExecutionRecord` (`externalExecutionId`, `timestamp`, `feeOrCommission`) |
| Trade input | `NormalizedTradeInput` | `NormalizedRoundTripTrade` |
| `ReviewContextPlugin` | `id`, `priority`, `buildContext()` | `pluginIdentifier`, `executionWeight`, `extractContext()` |
| Context block | `pluginId`, `summaryText`, `structuredData`, `imageAttachments` | `pluginIdentifier`, `category`, `summaryProse`, `structuredMetadata`, `visualAttachments` |
| AI output type | `AITradeReviewOutput`, snake_case fields | `AITradeReviewSchema`, camelCase fields, adds `volatilityHazardRating` |
| Grade scale | No `C+` | Includes `C+` |
| `ai_reviews` | `model_used`, `grade`, `headline`, `snapshot_url`, `structured_review` | `model_identifier`, `evaluation_grade`, `verdict_headline`, `chart_snapshot_url`, `structured_evaluation`, `playbook_score` |
| `economic_events` | `event_time`, `impact`, `actual`, `forecast` | `event_timestamp`, `impact_tier`, `actual_value`, `forecast_value`, `previous_value` |
| `trade_companion_charts` | `image_url`, `annotations` | `image_storage_url`, `divergence_annotations` |
| `trade_notes` | `voice_audio_url`, `mood_tag` | `voice_memo_storage_url`, no mood column |
| `user_preferences` | `default_companion_tickers` | `default_companion_symbols`, `privacy_shield_default` |
| `executions` | Has `account_id`, `symbol` | Neither. Uses `fee`. |
| `playbooks` | `default_style` | `default_archetype`, plus `target_asset`, `description`, `is_active` |
| Fitted trade window | Continuous from hold duration: 30% before entry, 50% in trade, 20% after exit, with a 45-bar floor (was ~30 until 2026-11-15) | Fixed duration-category windows |
| Opening range | "first 5m or 15m" | 5 minutes |
| VWAP anchor | "Session VWAP" | From 09:30 ET |
| CSS utilities | `.tabular-price`, `.specular-card` | `.tabular-numbers`, `.specular-border` |
| R format | `+2.6R` | `+2.60 R` |

Fixed during the review, no longer drifting:

- The classifier in `mogprompt.md` §5.2 rounded the hold time to whole minutes before comparing, so a 14m 40s trade was classed `session_90m`. It now compares seconds, matching `docs/07`.
- Links in `AGENTS.md` and `README.md` pointed at `file:///c:/mogmine/...` and worked on one machine only. They are now relative.
