# 02 — Playbook UX Dynamics: Chart Examples, Living Setups & Training

> **Branch:** `design/playbook-ux-examples`  
> **Status:** Design proposal for MogMine playbook dynamics v2.  
> **Predecessors & Context:** Seeded by [00-brainstorm-tappy.md](00-brainstorm-tappy.md), [lib/playbooks.ts](../../lib/playbooks.ts) (R-07), [components/TradeChart.tsx](../../components/TradeChart.tsx), [components/TradeDetail.tsx](../../components/TradeDetail.tsx), [components/ReviewScreen.tsx](../../components/ReviewScreen.tsx), [docs/03](../../docs/03-trade-cards-and-note-taking.md), [docs/08](../../docs/08-ux-notes-viewing-and-journaling.md), and [docs/23](../../docs/23-card-system.md) (Card System).

---

## Executive Summary & Core Dynamics

Today, a Playbook in MogMine is simply a name, default trade style, and up to 12 checklist rule labels stored in `localStorage` (`mogmine-playbooks-v1`). Trades copy those rules upon assignment and freeze them (`UX-50`).

This document designs **Playbook Dynamics v2**: turning static text checklists into **living, visual, interactive training setups**.

```text
+-------------------------------------------------------------------------+
|                              PLAYBOOK v2                                |
|                                                                         |
|  [ Thesis & Rules ]  ----->  [ Frozen Chart Examples ]  -----> [ Drills]|
|   "What we look for"          - Exemplars (A+ textbook)         Blind   |
|   "What we forbid"            - Near-Misses (Execution flaw)    Review  |
|                               - Anti-Examples (The Trap)        Engine  |
|                                      |                                  |
|                                      v                                  |
|                         [ Live Tagged Trade Stats ]                     |
|                                n >= 10 trades                           |
+-------------------------------------------------------------------------+
```

### The Seven UX Principles of Playbook Examples

1. **Frozen moments, never live links (`UX-50` freeze extended):** An example is an immutable snapshot containing its exact candle window, timeframe, level set, annotations, verdict note, and post-decision outcome bars. It is stored permanently in IndexedDB (`mogmine-examples-candles-v1`). A subsequent playbook rule edit, trade deletion, or Yahoo 30-day intraday drop *never* breaks a saved example.
2. **Examples as interactive data, not flat bitmap images:** Examples store structured bars and anchored annotations (`price`, `time_utc`). They render through the native `TradeChart` engine, support timeframe switching, pinch-zoom, and dynamic hide/reveal. Flat PNGs (Trade-Card frame) are export artifacts generated *from* this data.
3. **Tri-modal classification (A+ Exemplar, Near-Miss, Anti-Example):** A playbook taught only with winning charts breeds pattern-matching without market discrimination. Anti-examples demonstrate what *looks* like the setup but fails a prerequisite.
4. **Outcome hide/reveal as the native default:** To foster objective training, an example viewer opens with future outcome bars hidden past the "Decision Point" bar. The trader evaluates market structure before tapping to unveil "What Happened Next".
5. **Thumb-zone, sub-60s mobile capture:** Saving an example from Trade Detail or during study takes under 60 seconds with 4-5 taps on a `390×844` viewport.
6. **Unified review queue, not disconnected silos:** Blind review drills for playbook examples plug directly into the existing `/review` deck rather than living in an abandoned sub-menu.
7. **Strict Shield & Privacy compliance:** Chart snapshots and exports honor `--shield` state (hiding dollar PnL, account numbers, and position sizing), displaying strictly R-multiples and point excursions.

---

## 1. Capture Flows

Playbook examples originate from two distinct mobile workflows:
- **Flow A:** Promoting a real traded trade from `TradeDetail`.
- **Flow B:** Capturing an untraded historical study moment directly from a chart.

### Flow A: Capture from Trade Detail ("Save as Playbook Example")

When reviewing a logged trade on `TradeDetail` (`/trades/[id]`), the trader notices an execution that exemplifies their setup or represents a classic mistake.

```text
[ TradeDetail Action Bar ] 
    [ Share Card ] [ Review ] [ ••• More ]
                                    |
                                    v
                     +-----------------------------+
                     | [✦] Save as Playbook Example|
                     +-----------------------------+
                                    |
                                    v
                 +-------------------------------------+
                 | SHEET: Save to Playbook (Step 1-3)  |
                 | - Auto-selects trade's playbook     |
                 | - Trimming scrub slider             |
                 | - Kind: Exemplar / Near-Miss / Anti |
                 | - One-line verdict note             |
                 +-------------------------------------+
```

#### Step-by-Step Walkthrough

1. **Trigger:**
   - In `TradeDetail.tsx`, within the bottom thumb-zone dock or under the secondary action menu (`•••`), tap **"Save as Playbook Example"**.
   - Tap target is $\ge 44\text{px}$, placed safely away from destructive actions ("Delete trade").

2. **Sheet Presentation (Half-Sheet / 85vh Modal):**
   - An obsidian sheet slides up with an interactive preview of the trade's chart cropped around the trade window.
   - Header displays: `Save Example · {trade.symbol}` with a `Cancel` ghost button.

3. **Step 1: Destination Playbook Selection:**
   - If `trade.playbook_id` is already assigned, that playbook is pre-selected with a subtle gold highlight chip: `[ ORB Reclaim ✓ ]`.
   - If unassigned or if the trader wants to file it elsewhere, tapping the chip opens a quick single-tap selector listing active playbooks from `lib/playbooks.ts` (`currentPlaybooks()`).

4. **Step 2: Example Kind & Decision Anchor:**
   - Three segmented tabs (radio pills, 44px min height):
     - **`A+ Exemplar`**: Textbook setup matching all primary rules.
     - **`Near-Miss`**: Setup appeared valid but entry was chased, stop was misplaced, or execution slipped.
     - **`Anti-Example`**: Setup looked tempting but was an explicit trap / missing HTF bias / counter-trend chop.
   - **Decision Point Anchor:** Defaults to `trade.entry_time`. A vertical amber dashed guide line appears on the chart preview. The trader can tap any candle to re-anchor the exact decision moment where the trade was triggered.

5. **Step 3: Trimming & Framing the Window:**
   - Default framing: 30 bars before entry, bars during trade, and 30 bars post-exit (using existing `ChartExtension` logic from `TradeChart.tsx`).
   - Dual-handle scrubber bar below the preview:
     - Left thumb: `Context Start` (scrolls backwards in time).
     - Right thumb: `Outcome End` (limits how much post-decision aftermath is included).
   - "Fit to Trade" reset button snaps framing back to the optimal trade crop.

6. **Step 4: Verdict & Key Anchors:**
   - **Verdict Note:** A single-line text input (80 chars max) with placeholder:
     - Exemplar: *"Clean reclaim of VWAP after 5m liquidity sweep"*.
     - Anti-Example: *"Chased into HTF supply with SMT divergence against us"*.
   - **Rule Tagging:** Checklist pills of the playbook's rules (`checklist_rules`). The trader checks which specific rules were validated or violated.

7. **Step 5: Commit & Storage:**
   - Tap **"Save to Playbook"** (`btn-primary`, 48px height).
   - Instant optimistic feedback: Button flashes gold checkmark `Saved ✓` ($\le 100\text{ms}$).
   - **Behind the scenes:**
     - Copies the current candle window from `IndexedDB` (`trade_candles`) into `mogmine-examples-candles-v1`.
     - Freezes current computed levels (`session_vwap`, `overnight_high`, `overnight_low`, `prior_day_high`, `prior_day_low`) as static horizontal price markers.
     - Writes the example record to `mogmine-playbook-examples-v1`.
   - Toast notification appears with action: `"Saved to ORB Reclaim" [View Playbook]`.
   - Sheet dismisses; user remains on `TradeDetail`. Total elapsed time: $< 25\text{s}$.

---

### Flow B: Capture from Historical Study Chart (Untraded Moments)

Traders frequently review historical chart days (e.g., during weekend study or pre-market prep) and identify textbook setups they missed or did not execute.

```text
[ Historical Chart Study Mode ]
    Tap & hold crosshair on key candle (250ms)
                     |
                     v
             [ Context Action ]
       +----------------------------+
       | [✦] Bookmark as Example    |
       +----------------------------+
                     |
                     v
        +--------------------------+
        | SELECT PLAYBOOK & KIND   |
        | - Set Decision Point     |
        | - Choose Pre/Post Window |
        | - Save Snapshot          |
        +--------------------------+
```

#### Step-by-Step Walkthrough

1. **Trigger:**
   - In any full-screen historical chart view (`/chart` or chart inspect mode on a past day):
   - Trader scrubs crosshair to the setup bar. Long-press on the bar (250ms) or tap the chart context tool in the header: **"Capture Example"**.
   - The selected candle is highlighted with a gold vertical cursor labeled `DECISION BAR`.

2. **Target Setup:**
   - A bottom drawer presents:
     - `Select Playbook`: Scrollable list of active playbooks.
     - `Classification`: `[ Exemplar | Near-Miss | Anti-Example ]`.

3. **Window Auto-Padding:**
   - The system automatically captures:
     - 45 bars prior to the decision bar (the structural setup).
     - 45 bars after the decision bar (the subsequent expansion / failure).
   - Trader can tap `‹ 30` or `30 ›` buttons to widen either side if HTF context requires it.

4. **Annotations & Price Levels:**
   - Trader can tap the price axis or chart to drop up to 2 key levels (e.g., `Overnight Low`, `Opening Range High`).
   - If levels are already active from the indicator engine (`codex/indicator-level-trend-math`), visible levels are auto-snapshotted into the record.

5. **Commit:**
   - Trader enters a verdict note (`"Textbook 09:45 AM ONL bounce with NQ confluence"`).
   - Tap **"Save Example"**. Candles and metadata freeze into IndexedDB.

---

## 2. Playbook Detail v2: The Living Setup Document

The playbook screen (`/playbooks/[id]`) evolves from a basic text editor in Tune into a **tactical command center** for the setup.

### Mobile Screen Hierarchy (`390×844` Viewport)

```text
+-------------------------------------------------------------+
| < Playbooks       ORB Reclaim                [••• Settings] |
+-------------------------------------------------------------+
| === ABOVE THE FOLD (First Screen) ========================= |
|                                                             |
|  [ SCALP ]  ·  MES Continuous  ·  Active                    |
|                                                             |
|  THESIS                                                     |
|  "Reclaim of the Opening Range Low after an initial false   |
|   breakout sweep between 09:35 and 10:00 ET."               |
|                                                             |
|  LIVE METRICS (Tagged Trades, n = 18)                       |
|  +-------------------+------------------+----------------+  |
|  | Win Rate: 68%     | Avg R: +1.8R     | Discipline: 92%|  |
|  +-------------------+------------------+----------------+  |
|                                                             |
|  CHECKLIST RULES (4)                                        |
|  [✓] 1. 5m ORL swept by < 6 ticks                           |
|  [✓] 2. Bullish 1m candle close back inside OR              |
|  [✓] 3. Hard stop placed at sweep wick low                  |
|  [✓] 4. Minimum 2:1 R to OR Mid / VWAP                      |
|                                                             |
| === BELOW THE FOLD (Scrollable) =========================== |
|                                                             |
|  EXAMPLE GALLERY (7 Total)                                  |
|  [ All (7) ]   [ A+ Exemplar (4) ]   [ Anti-Examples (3) ]  |
|                                                             |
|  +-------------------------------------------------------+  |
|  | [A+ EXEMPLAR] · 2026-11-12 09:42 ET           +2.4R   |  |
|  | +---------------------------------------------------+ |  |
|  | | [ Interactive Mini-Chart Snapshot               ] | |  |
|  | | [ Sealed / Tap to Reveal or Full Interactive    ] | |  |
|  | +---------------------------------------------------+ |  |
|  | "Clean double-sweep of ONL, swift 1m close back above"|  |
|  +-------------------------------------------------------+  |
|                                                             |
|  +-------------------------------------------------------+  |
|  | [ANTI-EXAMPLE] · 2026-11-04 09:51 ET         -1.0R   |  |
|  | "Chased reclaim 4 bars late into declining VWAP"      |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  [ + Capture New Example ]                                  |
|                                                             |
|  BOTTOM ACTION: [ Start Blind Drill (5 Cards) ]             |
+-------------------------------------------------------------+
```

### Above-The-Fold Architecture

On a standard `390×844` mobile device, space above the fold is prioritized for immediate orientation before trading:
1. **Title & Style Pill:** `ORB Reclaim` with trade style badge (`Scalp`, `90m session`, or `Investment`).
2. **One-Paragraph Core Thesis:** High-contrast summary of the market dynamic exploited (max 180 chars).
3. **Live Performance Ribbon (from `R-08a` selectors):**
   - Three key figures: **Win Rate**, **Average R**, and **Rule Adherence %**.
   - If tagged trades $n < 10$, displays `Building stats (n = 4/10)` to prevent early variance distortion (`Invariant 7` / `docs/23 §1.7`).
4. **Active Checklist Rules:** Clean, expandable bullet list displaying the mandatory criteria.
5. **Peek of First Exemplar:** The top edge of the first chart card peeks at the bottom of the fold, indicating visual content below.

---

## 3. Example Viewer: The Interactive Frozen Chart

Tapping any example card opens the **Example Viewer** (`/playbooks/[id]/examples/[exampleId]` or modal sheet).

```text
+-------------------------------------------------------------+
| < ORB Reclaim · Example #2 (A+ Exemplar)          [Share PNG]
+-------------------------------------------------------------+
| [TIMEFRAME: 1m | 5m]     [MODE: Decision Bar | What Happened]
+-------------------------------------------------------------+
|                                                             |
|  4125.00 +-------------------------- ONH (Frozen Level)     |
|          |         *                                        |
|          |       *   *  *                                   |
|  4115.50 +------*-------*----------- VWAP                   |
|          |     *   [▲ ENTRY]                                |
|  4108.25 +----*--------------------- ORL                    |
|          |   *  <- Wick sweep                               |
|  4105.00 +--*----------------------- STOP (4104.75)         |
|             |          |                                    |
|          09:30       09:42 (Decision)    10:15              |
|                      [SEAL / MASK LINE]                     |
+-------------------------------------------------------------+
| STATUS: Sealed at Entry (09:42 ET)                          |
| [ ▶ REVEAL OUTCOME (What Happened Next) ]                   |
+-------------------------------------------------------------+
| ANNOTATIONS & RULES                                         |
| [✓] 5m ORL swept by < 6 ticks (Actual: 3.5 ticks)           |
| [✓] Bullish 1m close back inside                            |
|                                                             |
| VERDICT NOTE                                                |
| "Notice how the wick touched the liquidity pool and bounced |
| immediately. Volume was 2x the 20-period average."          |
+-------------------------------------------------------------+
```

### Interactive Chart Features & Behaviors

1. **Frozen Data Source:**
   - Candlesticks are rendered from the example's frozen IndexedDB bar payload.
   - Panning and pinching function seamlessly within the captured window ($\pm 45$ bars). Edge bounce indicators prevent user confusion at window boundaries.
2. **Decision Point Masking (The "Sealed" State):**
   - By default, candles past the `decision_time` are **hidden**.
   - A vertical gold gradient line indicates the Decision Bar.
   - Price coordinates, levels, and annotations before that moment are fully visible.
3. **Outcome Reveal ("What Happened Next"):**
   - Tapping the prominent button **`▶ Reveal Outcome`** animates the subsequent bars forward to the exit or window completion (smooth 300ms bar-by-bar draw, or instant if `prefers-reduced-motion` is active).
   - Once revealed, the button transforms into **`◀ Reset to Decision`** and the post-trade stats (MAE, MFE, realized R) expand below.
4. **Frozen Indicator Level Lines:**
   - Static lines drawn across the canvas:
     - `ORL / ORH` (Opening Range boundaries)
     - `ONL / ONH` (Overnight extremes)
     - `VWAP` (Session anchor)
     - `PDC / PDH / PDL` (Prior Day levels)
   - Labeled on the right price scale in monospace caps.
5. **Shield Mode Integration:**
   - When the user's global `--shield` preference is active (or toggled via on-screen privacy lock):
     - Dollar amounts (`+$340.00`) are entirely stripped.
     - Replaced strictly by R-multiple (`+2.4R`) and tick/point excursion (`+13.50 pts`).
     - Position size (e.g. `2 contracts`) and account identifiers are hidden.

---

## 4. Training Dynamics: Blind Review & Quiz Mode

Playbook examples transform passive notes into **active mental conditioning**.

### The Drill Engine (`CD-2` Architecture)

The drill mode tests the trader's pattern recognition against their own curated playbook database.

```text
[ Daily Warm-Up or Playbook Drill ]
                 |
                 v
+-------------------------------------------------------------+
| DRILL CARD (Sealed at Decision Point)                1 of 5 |
| Symbol: MES · Time: 09:42 ET · Setup: ???                   |
+-------------------------------------------------------------+
|                                                             |
|               [ CANDLE CHART TO DECISION BAR ]              |
|                 (Outcome strictly hidden)                   |
|                                                             |
+-------------------------------------------------------------+
| QUESTION: Does this meet the criteria for [ ORB Reclaim ]?  |
|                                                             |
|  [ A+ SETUP (In) ]       [ NEAR-MISS (Borderline) ]         |
|                                                             |
|                    [ TRAP / PASS (Out) ]                    |
+-------------------------------------------------------------+
```

#### Step-by-Step Drill Sequence

1. **Deck Assembly:**
   - A drill session draws 5 random examples.
   - Decks can be filtered to:
     - **Single Playbook Deck:** Master one specific setup.
     - **Mixed Warm-Up Deck:** 5 cards across all active playbooks presented prior to the 09:30 ET market open.
     - **Trap / Anti-Example Deck:** High concentration of anti-examples to sharpen filter discipline.
2. **Prompt & Decision:**
   - Front of card displays the chart up to the decision candle. Symbol, time of day, and session levels are visible.
   - Trader chooses one of three answers:
     - `A+ Setup (Take)`
     - `Borderline / Pass`
     - `Anti-Example (Trap)`
3. **The Reveal & Grading:**
   - Upon selecting an answer, the outcome bars animate forward.
   - The card reveals the truth:
     - Badge displays: `CORRECT: A+ Exemplar` (Green gold) or `INCORRECT: This was an Anti-Example` (Muted orange).
     - Annotations illuminate on the chart pinpointing the exact tell (e.g., *"Notice NQ made a lower low here: SMT was invalid"*).
4. **Spacing & Review Queue Integration:**
   - **No Second Silo:** Example drills leverage the existing `/review` infrastructure:
     - Real unreviewed trades sit in the queue alongside periodic playbook calibration cards.
     - If the trader misjudges an example (calls an Anti-Example an A+ Setup), that card is flagged and re-injected into the queue 2 days later (`Misses Deck`, docs/23 §4.3).
   - Stats are logged to `mogmine-drills-v1`: Trader's setup recognition accuracy percentage is tracked per playbook.

---

## 5. Anti-Examples: Teaching Discrimination, Not Confusion

A common flaw in trading education is showing only winning charts, which leads traders to hallucinate setups in random chop. Anti-examples teach what **not** to trade.

### The "Spot the Difference" Side-by-Side Presentation

On desktop and tablet viewports, or via swipe-comparison on mobile (`390×844`), an anti-example is paired directly with an A+ exemplar.

```text
+-------------------------------------------------------------+
| SPOT THE DIFFERENCE: ORB Reclaim                            |
+-------------------------------------------------------------+
| [ A+ EXEMPLAR ]               | [ ANTI-EXAMPLE (The Trap) ] |
| Date: 2026-11-12              | Date: 2026-11-18            |
| Outcome: +2.4R                | Outcome: -1.0R (Stopped)    |
+-------------------------------+-----------------------------+
| CHART A                       | CHART B                     |
|  *                            |  *                          |
|   *                           |   *   * <- Chased close     |
|    \__ Clean 3-tick wick sweep|    \_______ 14-tick blowout |
|        Quick reclaim inside   |             No bid returned |
+-------------------------------+-----------------------------+
| THE ANATOMY:                  | THE FLAW:                   |
| 1. Swept ORL by only 3 ticks  | 1. Pierced ORL by 14 ticks  |
| 2. Immediate volume response  | 2. Heavy volume below level |
| 3. Closed inside within 1 bar | 3. Took 4 bars to crawl back|
+-------------------------------------------------------------+
| KEY RULE BROKEN:                                            |
| Rule #1: "5m ORL swept by < 6 ticks" -> VIOLATED (14 ticks) |
+-------------------------------------------------------------+
```

### Mobile Implementation (Carousel / Split View)

On a mobile screen where side-by-side charts would be too compressed to read:
1. **Swipe Carousel (`390px`):**
   - Card 1: `A+ Exemplar` with gold highlight accent border.
   - Card 2: `Anti-Example` with slate-orange accent border.
   - Swiping between them keeps price and time scaling aligned so the eye tracks structural differences immediately.
2. **Delta Callout Box:**
   - A dedicated callout below the chart explicitly names the differentiating factor:
     - *"What looked right: Fast push back above VWAP."*
     - *"The deadly flaw: Higher timeframe trend was firmly bearish; NQ did not confirm."*

---

## 6. Empty and First-Run States: Zero to First Example in Under 60 Seconds

A new playbook with zero examples can feel daunting and sterile. MogMine accelerates initial adoption through clear nudges.

### Empty State Screen (`/playbooks/[id]`)

```text
+-------------------------------------------------------------+
| ORB Reclaim                                                 |
| Rules defined: 4  ·  Examples: 0                            |
+-------------------------------------------------------------+
|                                                             |
|                 [ Dotted Chart Frame Outline ]              |
|                                                             |
|                      No examples saved yet                  |
|       A playbook without charts is just a wish list.        |
|                                                             |
|  [ 1. Promote a Past Trade ]      [ 2. Load Sample Setup ]  |
|                                                             |
+-------------------------------------------------------------+
| QUICK START NUDGES                                          |
| • You have 3 logged trades tagged 'ORB Reclaim' in your feed|
|   [Review & Promote Trade #104 (2026-11-12) ->]             |
+-------------------------------------------------------------+
```

### The Sub-60s First-Example Flow

1. **Auto-Detection Banner:**
   - If the trader already has logged trades in `lib/store.ts` matching this `playbook_id`:
   - An intelligent card prompts: *"Trade on Nov 12 followed 4/4 rules and produced +2.4R. Add it as your first exemplar?"*
   - Tapping it opens the pre-filled Capture Sheet (Flow A). One tap on `Save to Playbook` completes the process in **$< 15$ seconds**.
2. **Sample Setup Starter (Zero Trades Logged):**
   - For a trader starting with no trades:
   - A button **"Load Curated Sample Example"** populates the playbook with a bundled offline fixture example (using `fixtures/levelsets/MES-2026-11-12.json`).
   - The user immediately experiences the interactive viewer and drill mode without needing market data setup.

---

## 7. Sharing Dynamics: Cards & Portable Playbook Packages

Sharing must adhere to MogMine's core invariants: Canvas-based rendering, theme token fidelity, and privacy protection.

### 7.1 Single Example Export: Trade-Card Frame Integration (`CD-3`)

Exporting an example renders a standalone PNG using the unified Card System frame (`docs/23 §2`).

```text
+-------------------------------------------------------------+  <- 1px specular gold top edge
| PLAYBOOK EXEMPLAR · ORB Reclaim              4/4 RULES [✓]  |  Header band
+-------------------------------------------------------------+
|                                                             |
|                    MAIN CANVAS AREA                         |
|             Lightweight-Charts 2D Snapshot                  |
|               (Clean crop, labeled levels,                  |
|                 decision mark & annotations)                |
|                                                             |
+-------------------------------------------------------------+
| Symbol: MES=F    | Timeframe: 1m     | Result: +2.4R        |  Stats row (tabular-nums)
+-------------------------------------------------------------+
| THESIS & VERDICT:                                           |
| "Clean liquidity sweep of Overnight Low into 09:35 open;    |  Context band
|  immediate 1m reclaim candle with SMT confirmation."        |
| mogmine · 2026-11-12                     Shield: ACTIVE     |  Footer
+-------------------------------------------------------------+
```

- **Export Resolution:** `1080×1350` (4:5 social/archive standard) and `1080×1920` (9:16 story/mobile wallpaper).
- **Privacy Enforcement:** Share sheet opens with `Shield` **ON** by default (`UX-71`). Dollar amounts, account IDs, and contract counts are stripped.
- **Generation Speed:** Generated on-device in $< 300\text{ms}$ using off-screen canvas composition (`UX-06`).

### 7.2 The Playbook Package (`.mogplaybook.json`)

If a trader wishes to backup, share with a mentor, or move playbooks between devices without server sync:

- **JSON Payload Format:**
  ```json
  {
    "version": "mogmine.playbook.v2",
    "exported_at": "2026-11-22T02:00:00Z",
    "playbook": {
      "name": "ORB Reclaim",
      "default_style": "scalp",
      "thesis": "Reclaim of 5m opening range low after liquidity flush.",
      "checklist_rules": [
        { "id": "rule-1", "label": "5m ORL swept by < 6 ticks" },
        { "id": "rule-2", "label": "Bullish 1m close back inside" }
      ]
    },
    "examples": [
      {
        "id": "ex-orb-01",
        "kind": "exemplar",
        "symbol": "MES=F",
        "timeframe": "1m",
        "decision_time": "2026-11-12T14:42:00Z",
        "verdict": "Textbook reclaim with volume expansion",
        "bars": [ /* Array of OHLCV candles */ ],
        "levels": [
          { "price": 4108.25, "label": "ORL", "color": "var(--gold-mid)" }
        ],
        "annotations": [
          { "time": "2026-11-12T14:40:00Z", "price": 4105.00, "text": "Sweep low" }
        ]
      }
    ]
  }
  ```
- **Portability:** Can be exported via standard iOS/Android share sheet and imported via `TuneScreen` (`Import Playbook Package`). Completely local-first, zero server dependency.

---

## 8. Phased Build Order: Smallest Slice First

Building playbook dynamics without scope creep requires strict phase slicing. Each phase delivers immediate user value.

```text
Phase 1: Local Examples & Flow A Capture
  - IndexedDB storage for example candles
  - Capture action on TradeDetail
  - Examples gallery tab on Playbook detail

Phase 2: Interactive Example Viewer & Hide/Reveal
  - Lightweight-Charts frozen snapshot viewer
  - Decision Point mask & Reveal button
  - Level lines & annotations display

Phase 3: Anti-Examples & Compare Mode
  - Anti-example tagging & classification
  - Side-by-side spot-the-difference view

Phase 4: Training Engine & Blind Drill Cards
  - Review queue integration
  - 5-card warm-up deck & drill score tracking

Phase 5: Export Cards & Portability
  - Trade-Card frame export for Playbook Examples
  - .mogplaybook.json export/import
```

### Slice Details

- **Phase 1: Data Model & Trade Detail Capture (Smallest Slice)**
  - Extend `lib/playbooks.ts` and create `lib/playbook-examples-store.ts`.
  - Add "Save as Playbook Example" sheet to `TradeDetail.tsx`.
  - Store frozen candle window in IndexedDB (`mogmine-examples-candles-v1`).
  - Render read-only thumbnail list in Playbook view.

- **Phase 2: Interactive Viewer with Outcome Reveal**
  - Implement `PlaybookExampleViewer.tsx` reusing `TradeChart.tsx`.
  - Add `decision_time` logical cut to slice bar array passed to `ISeriesApi`.
  - Implement "Reveal Outcome" state transition.

- **Phase 3: Anti-Examples & Teaching Discrimination**
  - Add `kind: "anti_example" | "near_miss"` filtering.
  - Build the comparison carousel on mobile viewports.

- **Phase 4: Drill Mode in Review Queue**
  - Integrate Playbook Drill Cards into `ReviewScreen.tsx` when queue has $< 3$ real trades or via explicit "Drill" button.
  - Implement answer grading (`Take` / `Pass` / `Trap`).

- **Phase 5: Card System PNG Sharing & Backups**
  - Implement `buildPlaybookExampleCard` in `lib/shareCard.ts`.
  - Add backup/restore support in `TuneScreen.tsx`.

---

## 9. Risks and Owner Decisions

Before writing application code or altering database schemas, the following decisions require formal owner guidance:

| ID | Topic | Conflict / Choice | Recommendation |
| :--- | :--- | :--- | :--- |
| **OD-PB-01** | **Untraded Chart Capture** | Should users be allowed to capture examples from charts they never traded (Flow B), or strictly from logged trades (Flow A)? | **Allow both.** Flow B enables building a playbook library before live trading occurs. |
| **OD-PB-02** | **Anti-Example Scope** | Should anti-examples live strictly inside their parent playbook, or in a shared cross-playbook "Traps & Mistakes" library? | **Keep inside parent playbook initially.** Cross-playbook tagging adds relational overhead not needed in local storage. |
| **OD-PB-03** | **Default Outcome Visibility** | In the standard Playbook Example Viewer (outside quiz mode), should the outcome be hidden by default (`Sealed`) or fully revealed? | **Hidden by default.** Maximizes training value; one tap unveils the outcome. |
| **OD-PB-04** | **IndexedDB Storage Cap** | Storing 200 bars per example across 50 examples = ~10,000 candles (~1.5 MB). Is IndexedDB storage acceptable without server sync during Phase 1-2? | **Yes.** IndexedDB easily handles 50+ MB on modern mobile browsers. Fully aligns with `docs/22` local-first rule. |
| **OD-PB-05** | **Quiz Queue Placement** | Should playbook drills mix directly into the daily `/review` queue, or remain a dedicated screen accessed via Playbook / Today? | **Dedicated screen with an optional nudge in Review Queue** when daily trades are completed. Prevents cluttering post-market triage. |

---

## 10. Verification & Mobile Fit Checklist (`390×844`)

When implementing this specification:
- [ ] **Capture Sheet Height:** Does not exceed 85vh on iPhone viewport; thumb-reach preserved for top tabs.
- [ ] **Pan/Pinch Isolation:** Panning within the frozen example chart never bubbles up to page scroll.
- [ ] **Monospace Alignment:** Prices, R-multiples, and bar timestamps strictly use `tabular-nums` (`font-variant-numeric: tabular-nums`).
- [ ] **Color Contrast:** Exemplar badge (`var(--gold-mid)`), Near-Miss badge (`var(--amber-muted)`), and Anti-Example badge (`var(--orange-risk)`) maintain $> 4.5:1$ contrast against `#07080C` obsidian background.
- [ ] **Offline Operation:** A saved example renders immediately in airplane mode from IndexedDB bars with zero network calls.
- [ ] **Shield Conformance:** With Shield toggled ON, no dollar values or account references appear on screens or generated PNGs.
