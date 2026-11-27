# Review: MogMine UX/UI Design Principles charter

This reviews `MogMine UX_UI Design Principles.pdf` against the app as it actually exists. It's written for the charter's author, who wrote it from a description of MogMine without seeing it, and for the owner, who decides what to adopt.

I checked against `main` at `3747928` (2026-11-26): the code, [DECISIONS.md](DECISIONS.md), [MOGMINE-BLUEPRINT.md](MOGMINE-BLUEPRINT.md) and the specs in `docs/`. I didn't use the live app on a phone, so anything about feel or speed still needs a hands-on check.

## Summary

The charter points the right way, and MogMine already does about half of what it asks. The useful parts are the contrast findings, shape-coded candles, labelling agent-written content, and a shortcut palette. About a third of the charter is written for a different product, a native-app brokerage with many users, and should be cut or rewritten. A few factual and citation errors need fixing before anyone treats it as authoritative.

A second document, `MogMine Product, UX, and Agent-First Architecture Audit.pdf`, is reviewed in the [addendum](#addendum-the-product-ux-and-agent-first-architecture-audit) at the end. It was written from the code and is much more accurate. Of the two, it's the better guide to product direction. The charter is still useful for visual and accessibility rules.

## What the author couldn't know from a description

- **It's a journal, not a brokerage.** MogMine records and reviews futures trades (starting with `MES` on TopstepX). It doesn't place orders, hold money or show buy/sell prompts. Advice about friction before placing trades, cool-downs, trending-asset pushes and fee disclosure has nothing to attach to.
- **One user.** It's the owner's personal trading development system. Peer features, cohort usability testing and multi-tenant privacy programs are out of scope for now.
- **A web app, not native.** It's a Next.js progressive web app (PWA) on Vercel. iOS and Android APIs (`kMonospacedNumbersSelector`, `android:fontFeatureSettings`, dp units) don't apply. CSS px and `font-variant-numeric` are what count.
- **Dark only, on purpose.** "Obsidian and gold" is the product's identity (README §3). There's no light theme, so the light-mode rules don't apply yet.
- **No built-in AI.** A built-in AI engine is deliberately deprioritized (Blueprint §3). AI reaches MogMine through *external* agents, such as ChatGPT or Claude, that read and write through `/api/v1` using agent keys. The AI pillar applies to how agent-written content appears in the app and to the API contract, not to an in-app chatbot.
- **Owner decisions outrank specs.** The Blueprint's document hierarchy (§5) puts DECISIONS.md above every design doc. Where the charter contradicts a recorded owner decision, the decision wins until the owner changes it. Those cases are listed separately below.

## Pillar by pillar

| Pillar | What the charter asks | What the app does today | Verdict |
|---|---|---|---|
| 1. Cognitive architecture | ≤2 disclosure levels; key state always visible; no placeholder-only labels; steppers only for discrete values | Slim toolbar, with secondary controls in one **View** menu (#82). Shield state shows in the top bar. | Mostly matches. Not audited screen by screen. |
| 2. Visual & data precision | Canvas `#121212`–`#1E1F22`; WCAG AA **and** APCA; colorblind preset; hollow/filled candles; tabular numbers; true minus | Canvas `#07080c`, text `#f4f5f7`. WCAG AA passes everywhere, **APCA doesn't for secondary text**. Blue/orange colorblind palette exists (UX-80). Candles are filled only. Inter plus JetBrains Mono with `tabular-nums`. True minus `−` in [lib/format.ts](lib/format.ts). | **Gaps**, see 1–3 below |
| 3. Ergonomics & speed | ≥44 pt targets; bottom nav on phones, nav rail on desktop; J/K, ⌘K, `?`; Undo | 44 px minimum targets throughout `globals.css`. Bottom dock on mobile, top nav on desktop. J/K/F/N/C/`[`/`]`/Esc on the trade screen (UX-69). Undo in several editors. | Mostly matches. **No ⌘K palette or `?` cheat sheet** (gap 5). |
| 4. Human-AI trust & calm UI | Label every AI touchpoint; show provenance; exception-only alerts; no badge counts | No in-app AI. Agent writes are logged under Settings → Agent keys. No push notifications. **Review tab shows a count badge.** | Gaps 4 and 6 |
| 5. Ethical & mastery design | No confetti or coercive streaks; ex-ante capture; outcome-masked review by default; active-recall spaced drills | UX-66 already bans confetti, sounds and dollar streaks. Gold marks rule-following only. Challenges are process-based (Drawdown Defender, Clean Run). Plans keep timestamped revisions. Drills hide the chart from the entry onward, then reveal, and resurface misses at **1, 3, 7 days**. Hindsight is labelled (OD-12). **Blind review is off by default (OD-25).** | Strong match. One owner-decision conflict. |
| 6. Privacy by design | One-gesture Discreet Mode; share cards strip balances by default; opt-in consent | **Shield** toggle in the top bar hides dollars and size app-wide. Share cards **open with Shield on** (OD-46a, `TradeDetail.tsx:193`). Agent keys are revocable. | Matches |
| 7. QA gates | Six pre-ship gates, including testing with 5 novice and 5 expert users | One user, with agents doing most of the building | Needs rewriting (see "Doesn't fit") |

## Gaps worth acting on

Ordered by value to the owner.

### 1. Secondary text fails the charter's APCA thresholds (charter is right)

This is the charter's own warning, that dark UIs can pass WCAG and still be hard to read, and it applies here. Measured on the app's real tokens:

| Text token | On `--bg-obsidian` | On `--bg-surface` | On `--bg-elevated` | Charter target |
|---|---|---|---|---|
| `--text-primary` `#f4f5f7` | 18.4:1 · Lc 101 | 17.5:1 · Lc 101 | 16.2:1 · Lc 100 | pass |
| `--text-muted` `#8e95a9` | 6.7:1 · Lc 45 | 6.4:1 · Lc 45 | 5.9:1 · Lc 44 | Lc ≥ 60 labels, ≥ 75 body: **fails** |
| `--text-faint` `#7b8498` | 5.3:1 · Lc 37 | 5.1:1 · Lc 36 | 4.7:1 · Lc 35 | **fails** |
| `--chart-axis-text` `#8b93a7` | 6.5:1 · Lc 44 | 6.2:1 · Lc 44 | 5.8:1 · Lc 43 | **fails** for 11 px axis labels |
| `--loss-text` `#ff6f7a` | 7.4:1 · Lc 50 | 7.1:1 · Lc 50 | 6.6:1 · Lc 49 | **fails** for small P&L text |
| `--profit-text` `#34d399` | 10.4:1 · Lc 66 | 10.0:1 · Lc 66 | 9.2:1 · Lc 65 | passes as labels, not as body |
| `--gold-mid` `#d4af37` | 9.5:1 · Lc 61 | 9.1:1 · Lc 61 | 8.4:1 · Lc 60 | borderline |

The APCA values come from a quick script implementing APCA 0.0.98G. Confirm them in the official APCA calculator before changing tokens. The fix is token-only: lighten `--text-muted`, `--text-faint` and `--chart-axis-text`, and give `--loss-text` more luminance. That matters because the app's type floor is 11 px (#85).

### 2. Near-black canvas with near-white text (needs an owner call)

The charter bans `#000000` and puts the canvas at `#121212`–`#1E1F22`, with off-white text around `#E8E8E8`, to avoid halation (glowing text). MogMine's canvas is `#07080c` and its primary text is `#f4f5f7`, close to the pairing the charter warns about. "Obsidian" is a brand decision, though, so I wouldn't move the canvas just because the charter says so. A cheaper middle ground: soften `--text-primary` toward `#e6e8ec` and keep the canvas. Check it on the owner's actual phone at night.

### 3. Candles rely on color alone

Up and down candles differ only by hue, both in the default green/red and the blue/orange palette (the palette lives in [app/globals.css](app/globals.css)). The charter's suggestion of **hollow up candles and filled down candles** is cheap in lightweight-charts: set the up body to transparent and keep the up border and wick. It would make charts readable in grayscale and for colorblind users without a palette switch. It doesn't conflict with D-010, which covers position boxes, not candles. Share cards read the live theme, so they'd pick up the change automatically.

### 4. Agent-written content isn't labelled where you read it

Agents can write notes, tags and records through the API. Writes are recorded in `mogmine_agent_audit` and shown under Settings → Agent keys. I found no marker on the trade or review screens themselves showing that an agent wrote something. The charter's "signal unmistakably whenever a user is interacting with an AI system" fits here: a small "by agent" marker on agent-written fields would do it, and it supports the Blueprint rule that MogMine knows "what happened vs. what was learned afterward."

### 5. Shortcut palette and cheat sheet

J/K/F/N/C already work on the trade screen, and the View menu shows key hints next to items, as the charter recommends. Still missing: a global ⌘/Ctrl+K command search and a `?` overlay listing the shortcuts. Low effort, mostly useful on desktop.

### 6. Count badge on the Review tab (needs an owner call)

`AppShell.tsx:60` shows a number on Review: trades still missing tags. The charter bans unread badges because they drive impulsive actions. This one points at journaling backlog, not trading, so it's arguably the good kind of nudge. Owner's choice: keep it, or replace it with a dot.

## Where the charter conflicts with recorded owner decisions

Owner decisions win until the owner changes them. The author should either drop these demands or present them as proposals.

- **Outcome-masked review by default vs OD-25.** The charter wants profit/loss hidden by default during review. The owner kept blind review **off by default**, to be tried on trades older than a week (BET-03). The research the charter cites (outcome bias) is a good argument for revisiting OD-25. It's still a proposal, not a rule.
- **Canvas color vs the obsidian brand.** See gap 2.
- **"Reward process quietly" is already policy.** UX-66 and the "gold for good process" rule (#80) cover the charter's ethics pillar more tightly than the charter does. Cite them instead of restating them.

## What doesn't fit MogMine (cut or rewrite)

- **Brokerage-only material.** Friction before trades, cool-downs during volatility, trending-asset pushes, pricing and fee disclosure, and most of the regulator and retail-investor statistics in §5. MogMine has no order flow. Keep a one-line rationale and drop the rest.
- **Native platform APIs.** iOS `kMonospacedNumbersSelector`, Android `fontFeatureSettings`, and "pt / dp". Say CSS px and `font-variant-numeric`.
- **Material 3 adaptive scaffolding.** Five breakpoints, 3-pane layouts, foldables, drag-handle panes, desktop nav rail. That's heavy for a phone-first single-user journal. The current bottom dock and top nav are fine. Keep "don't stretch phone layouts across wide screens" and drop the rest.
- **Light-mode rules.** There's no light theme. Move them to a "when a light theme exists" note.
- **Red-up/green-down regional conventions.** One US futures trader. Not needed now.
- **Relatedness (peers, mentors) in SDT.** Single-user for now. Mark it future.
- **QA gates with 5 novice and 5 expert users.** There's one user. Replace this with gates that can actually run here: an automated contrast check on tokens, a keyboard-parity checklist, the existing mobile checklist in [AGENTS.md](AGENTS.md), and an owner phone check.
- **ISO 27701 / ISO 31700 programs and automated retention jobs.** Scale down to what applies: Shield default behavior, agent-key scope and revocation, Supabase row-level security, and what data goes to external agents.
- **"Swipe gesture" for Discreet Mode.** Shield is a one-tap toggle, which already meets the intent. No gesture is needed.

## Factual and citation issues to fix

- **Microsoft's Human-AI guidelines are misnumbered.** The published list runs G14 "Update and adapt cautiously", G15 "Encourage granular feedback", G16 "Convey the consequences of user actions", G17 "Provide global controls", G18 "Notify users about changes". The charter skips G14 and shifts the rest by one, then leaves a note saying G18's wording "should be verified." Fix the table against the Amershi et al. (2019) paper it already cites, and remove the placeholder.
- **Research claims rest on secondary blogs.** For example, the "80% of top tasks on Level 1 / workbench test" rule is cited to a no-code vendor blog (ref 1). The Hoober grip and target figures are cited to an agency blog (refs 2, 16). The gamification effect sizes are cited to a student journal summary (ref 9). Cite the primary papers or soften the numbers to guidance. I didn't check every statistic. Treat the precise figures (5.17%, 0.77 SD, 11.2%) as unverified until traced to their sources.
- **Okabe–Ito hexes vs the shipped palette.** The charter prescribes `#009E73`/`#D55E00`. The app ships its own blue/orange (`#4c8dff`/`#f98a3c`). Either is defensible. The charter should say whether it's mandating exact hexes or the principle.
- **16:9 card size.** The charter says 1600×900. The app exports 1920×1080. Same ratio, so no change is needed. Update the charter.

## Already in line with the charter

The app already does these. List them in the charter as "current practice" so nobody rebuilds them:

- Tabular numbers in a mono face, true minus signs, signed R values (`+2.6R`, `−1.0R`)
- 44 px minimum targets, bottom dock on phones, skip link
- J/K navigation and on-screen shortcut hints (UX-69)
- Shield mode, with share cards opening with Shield on (OD-46a)
- Card sizes 4:5, 9:16, 1:1, 16:9
- No confetti, sounds or dollar streaks (UX-66). Process-only gold and challenges.
- Drills with a sealed reveal and 1/3/7-day spacing for misses (docs/23 §4)
- Timestamped plans with revisions, and labelled hindsight (OD-12, D-010)
- WCAG AA contrast on every text token

## Suggested next step

Turn the charter into a short Markdown doc, `docs/27-design-principles.md`, of about two pages, structured as:

1. Each principle, one sentence.
2. The current practice that satisfies it, linked to code or a decision.
3. The open gaps above as numbered items.

The PDF can stay as background reading. Then the owner decides gaps 2 and 6 and whether to revisit OD-25. The other gaps can be planned as small packages.

---

## Addendum: the Product, UX and Agent-First Architecture Audit

`MogMine Product, UX, and Agent-First Architecture Audit.pdf` (23 pages) was written from a code and handoff snapshot, not a description, and it says so up front. It also separates *Observed*, *Inference* and *Recommendation*. That makes it much more reliable than the charter. I checked its factual claims against `main` at `3747928`.

### Claims checked against the code

| Audit claim | Status | Evidence |
|---|---|---|
| Dock is Today, Feed, Add, Review, Tune | Confirmed | `components/AppShell.tsx:39` |
| Today has Today / Progress tabs; Feed has Real / Replay / All | Confirmed | `TodayScreen.tsx:34`, `FeedScreen.tsx:15` |
| Shield once hid the contracts field (bug); it's now masked but editable; an older doc is stale | Confirmed | `AddTradeSheet.tsx:399`; stale text at `docs/20-price-first-entry.md:18` |
| `includeArchived` / `includeSamples` now default to false | Confirmed | `lib/agent/http.ts:156` |
| OpenAPI request bodies are a generic object with `additionalProperties: true` | Confirmed | `lib/agent/openapi.ts:116` |
| Agent keys have only `read` / `write` scopes | Confirmed | `mogmine_agent_tokens.scopes` check constraint |
| Agent writes have no idempotency key or expected-version check | Confirmed | Device sync *does* use `expectedUpdatedAt` now (`lib/persistence/store-sync.ts:95`), so Blueprint priority 4 is partly done. The agent API doesn't. |
| Audit log is one row per request, with no model or rules version | Confirmed | Columns: method, path, record type/id, status, outcome |
| Strategy Lab gates small samples (<5 counts only, 5–9 thin, 10+ full), uses Wilson intervals and shrinkage | Confirmed | `lib/strategy-lab/attribution.ts:19-21` |
| "No configurable commission/slippage model" | **Partly wrong** | Slippage *is* modeled: 1 tick per stop and market fill, set per recipe (`types.ts:212`, `runner.ts:159`). **Commissions are missing.** Slippage is editable only in the recipe JSON tab and isn't shown in the results. |
| Same-bar stop/target ambiguity needs a policy | **Already exists** | A bar that hits both stop and target counts as the stop, with slippage, labelled `ambiguous-stop` (`skills/measure.ts:145`). It needs surfacing in the UI, not designing. |
| Number of conditions/variants searched isn't tracked | Confirmed | Also listed as a trap in Blueprint §3 item 7 |
| Clean Run counts trades, so a disciplined no-trade day can't advance it | Confirmed | `target_trades` in `lib/challenges.ts:15` |
| Shield is display-only and doesn't reach the API | **Mostly** | One exception: the agent Strategy Lab context card reads the owner's Shield setting (`lib/agent/strategy-lab.ts:163`), so that one API response changes when the owner toggles Shield in the UI. That's exactly the ambiguity the audit warns about. Pick one rule. |

### Where I'd adjust the audit

1. **Scope vs. the Blueprint.** The Blueprint's current objective is "convergence, not expansion" (§3), and it orders financial and temporal truth, the candle archive, sync integrity and the AI operation contract before new areas. The audit's roadmap adds about eight endpoints, an Insight object, a hypothesis lifecycle and new scopes. Some of it maps straight onto Blueprint priorities and should go first:
   - `GET /api/v1/session` is priority 6, "ask MogMine about Tuesday".
   - Trials-searched counts, holdout provenance and commissions are priority 7's listed traps.
   - Idempotency and expected-version on agent writes complete priority 4.

   Insight objects, replay candidates and capability scopes are new feature areas. Wait for the owner to open them.
2. **It doesn't mention the candle archive.** The Blueprint ranks it #3 and calls it time-sensitive, because Yahoo history expires and unarchived bars are lost for good. The read path is merged (`19452b8`). The write-side PR #71 is still open and owner-gated. That belongs ahead of every item in the audit's roadmap.
3. **"Truth" queue items can start from what the app already flags.** These are fill matching, the data-quality chip and missing stops. The Next-action card is the cheapest, highest-value item in the audit. Build it on those existing signals before adding new detectors.
4. **Renaming Feed → Journal and Tune → Tools** is cheap but costs muscle memory. Owner's call.
5. **Its citations don't resolve.** The `fileciteturn…file…` markers point to files uploaded into a chat session, and the URLs carry `utm_source=chatgpt.com`. Replace the markers with repo paths and strip the tracking parameters before anyone treats the PDF as a reference.

### How the two documents fit together

- **They agree on the core.** Process over outcome, no gamification, and attention through queues rather than interruptions. All three are already policy (UX-66, OD-12, the Review queue).
- **The audit's rules are more concrete. Adopt them:**
  - "At most three ranked items on Today" makes the charter's "≤4 working-memory chunks" concrete.
  - "Never show a percentage without its denominator nearby" (`10/12, early sample`) belongs in the charter's numeric-typography rules.
  - Drill ground truth comes from playbook or human labels, never from whether the trade won. That strengthens the charter's outcome-bias section with an actual mechanism.
- **The audit's insight provenance fields cover my gap 4** (agent-written content isn't labelled). Do the cheap part first: a per-record "written by agent" marker using the agent key id the API already knows. Leave full Insight objects for when the owner opens that area.
- **Blind review.** The charter wants outcome masking by default. The audit treats blind review as an existing, optional feature, which matches OD-25. The audit's drill ground-truth argument is the better case for revisiting OD-25 later.

### Revised next step

Make the suggested `docs/27-design-principles.md` a merge of both documents:

1. Start from the audit's product model: Plan → record → review → patterns → practice → test → playbook → transfer.
2. Add the charter's trimmed visual and accessibility rules (gaps 1–3).
3. Link each rule to the current practice or the open gap that satisfies it.

Before adding new feature areas, fix the stale `docs/20` Shield line, decide the Shield-in-API rule, and add commissions plus a trials-searched count to Strategy Lab results.
