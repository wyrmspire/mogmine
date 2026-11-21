# 23 — Card System: Trade, Drill, Playbook, Day, Plan and Mistake Cards

**Raised:** 2026-11-21, owner request ("how can we improve the trade cards… cards for playbooks… practice flash cards").
**Status:** Proposal. Open decision `OD-46` in [DECISIONS.md](../DECISIONS.md). The recommendations below are the interim rule, so local-first work is not blocked.
**Extends:** [03 §1](03-trade-cards-and-note-taking.md) (Trade Card), [13 §4](13-bold-ui-bets.md#4-bet-03--blind-review) (BET-03 blind review), [05](05-mobile-ux-and-gold-design-system.md) (gold system), [08 §11](08-ux-notes-viewing-and-journaling.md) (export rules).

A card is one finished, self-contained unit of the journal: something to look at in the app, flip, practise on, or share as a PNG. Today there is one card, the Trade Card. This doc turns it into a family that shares one frame, so each new card is a layout of existing parts, not a new renderer.

---

## 1. Rules for every card

1. **Process beats outcome.** Any seal, badge, colour or "collector" treatment is earned by process (rules followed, blind grade, stop respected), never by P&L size. A disciplined `−1R` card looks as good as a `+3R` card. Rewarding big wins teaches outcome bias.
2. **One frame.** Every card uses the frame in §2. A card type changes the main area and the stats row, not the frame.
3. **Shield first when sharing.** The Share action opens with Shield on (R and points only, no dollars, size, account or balance; [03 §1](03-trade-cards-and-note-taking.md), UX-71, UX-72). Save-to-device keeps the last choice.
4. **The image exists before the tap** (UX-70). Build on sheet open and on every option change, as `shouldBuildShareCard` already does.
5. **Canvas, not DOM capture** (`OD-8`). Cards compose on a canvas in `lib/shareCard.ts`-style pure builders; the chart comes from `takeScreenshot(true)` (B-61).
6. **Theme tokens only** (invariant 5). Read colours from `getTheme()`; never hard-code gold hex or box alpha.
7. **Sample size is always printed** next to any rate or average (`n = 14`). Below the minimum in §5.3 the stat says `Not enough trades yet`, not a number.
8. **Local-first** ([22](22-development-mode-and-backend-boundary.md)). Every card in this doc renders from device storage. Storage upload waits for Supabase (B-46, B-50).

---

## 2. The shared frame

```text
+-------------------------------------------+  <- 1px gold top edge only (specular), carbon hairline sides
| TYPE LABEL · subject            seal/stat |  Header band: who, what, when
+-------------------------------------------+
|                                           |
|             MAIN AREA (55–60%)            |  Chart snapshot, ladder, rule list, or sealed chart
|                                           |
+-------------------------------------------+
|  stat  |  stat  |  stat                   |  Stats row: tabular-nums, 3 cells max
+-------------------------------------------+
|  why: playbook · thesis · rules           |  Context band, wraps, never clips numbers
|  mogmine · date                 n = 14    |  Footer: small mark, no account id
+-------------------------------------------+
```

- **Sizes:** `4:5` (1080×1350, current), `9:16` (1080×1920, story / lock screen), `1:1` (1080×1080). Each size is a layout table of band heights, not separate drawing code. The main area grows first; the context band shrinks first.
- **Type label and accent:** each card type has a short uppercase label (`TRADE`, `DRILL`, `PLAYBOOK`, `DAY`, `PLAN`, `MISTAKE`, `CHALLENGE`) and uses one theme accent token. No new colours.
- **Front and back.** In the app a card can flip (tap or swipe; instant under reduced motion). Export is front only by default, with an option for front and back stacked.

---

## 3. Trade Card refresh (`CD-1`)

What exists: `buildShareCard` in [lib/shareCard.ts](../lib/shareCard.ts), 1080×1350, chart about 910×482, Shield toggle, rule count seal, Mood Shape. What changes:

| Change | Why |
| :--- | :--- |
| Chart becomes the main area at 55–60% of height, cropped from a few bars before entry to a few bars after exit | The chart is the trade; today it is under 40% of the card |
| One hero number with the process seal beside it: `+2.6R` next to `4/4 RULES` | The Process + Outcome seal from 03 §1, not yet built |
| Header, main area, stats row, context band, footer per §2 | Tags no longer push the thesis off the card |
| `9:16` and `1:1` sizes | Specified in 03 §1, not yet built |
| Back side: full thesis, management and post-exit notes, full rule list, Mood Shape | Front stays readable at thumbnail size |
| Share opens with Shield on (§1.3) | Most shares go to Discord or X |

**Process seal content, interim:** rules followed (`adherence()`), plus the blind answer when there is one (`TAKE AGAIN ✓`, `SMALLER`, `PASS`). A letter grade (`A`–`D`) waits for `OD-46` (c); do not invent a grading formula.

**Chart framing.** Keep the current chart view for export under `AC-10` while `OD-47` is open. The proposed trade-focused crop is part of that decision.

**Split for PRs:** `CD-1a` pure layout tables and the frame (tests on band heights and Shield copy for all three sizes); `CD-1b` sheet controls (size picker, back toggle) and `390×844` check.

---

## 4. Drill cards — practice on your own trades (`CD-2`)

A drill is BET-03 made repeatable. The Review queue's blind review ([ReviewScreen](../components/ReviewScreen.tsx), `take_again`) grades a trade **once**. A drill can show the same trade many times and keeps every answer.

### 4.1 The basic drill: *Take it?*

1. **Front (sealed):** the trade's chart cut at the entry bar. Later bars, exit, result, tags, notes and mood are hidden. Shows symbol, side, time of day and the playbook's name only if the deck is a single-playbook deck.
2. **Answer:** *Take it* / *Smaller* / *Pass*.
3. **Back (reveal):** the bars play forward to the exit (instant under reduced motion), then the Trade Card front.
4. **Record:** `{ drill_id, trade_id, kind, answer, answered_at, hidden: ["bars_after_entry", ...] }` (B-63, UX-52).

### 4.2 Other drill kinds (after 4.1)

| Kind | Front | Scored by |
| :--- | :--- | :--- |
| **Which playbook?** | Sealed chart, no name | Matches the trade's `playbook_id` |
| **Place the stop** | Sealed chart, tap a price | Distance in ticks from `initial_stop_price` (R-10). Trades without one are not eligible |
| **Name the level** | Chart with one level line unlabelled | Matches the level label (needs docs/12 levels) |
| **What next?** | Chart cut at a time after entry, *Up / Down / Chop* | Next N bars (deterministic rule, tested) |

### 4.3 Decks

- **Warm-up:** 5 random eligible trades older than 7 days (same-day recall spoils it, BET-03).
- **Playbook deck:** one playbook's trades.
- **Misses deck:** trades where the last drill answer disagreed with the result (answered *Take it* on a `−1R` that broke rules, or *Pass* on a clean winner). Shown again after 1, 3 and 7 days (simple spacing, no SRS library).

### 4.4 Eligibility and data

- Closed trades only, not `is_sample`, with candles available. Drills read the per-trade candle cache (IndexedDB, `candleCacheKey`, `lib/candles.ts`) and never fetch only on the fly for old trades (invariant 2). Yahoo drops `1m` after 30 days, so a trade with no cached bars is skipped with a count (`3 trades skipped: no saved bars`), never drawn empty.
- Cutting the chart is passing a shorter bar array; the Position Box draws only up to the cut (BET-03 cost note).
- Drill answers live in a new local store `mogmine-drills-v1` with `user_id` (invariant 7), included in journal backup/restore. They never overwrite `take_again`.

### 4.5 What drills produce

After 30+ answered *Take it?* drills: average R of trades answered *Take it* against trades answered *Pass*, with `n` for each. If *Pass* trades did as well as *Take it* trades, the trader's read of their setups is not adding edge. Shown on the playbook card (§5) and the drill screen.

**Split for PRs:** `CD-2a` pure deck selection, eligibility, cut-off and scoring + tests; `CD-2b` local store + backup; `CD-2c` drill screen with flip and reveal.

---

## 5. Playbook card (`CD-3`, after `R-07` and `R-08`)

### 5.1 Front

Name, the best example chart (the most recent trade with all rules followed and a blind *Take it*; else the most recent all-rules trade; else an empty frame that says `No example yet`), and the stats row: trades, win rate, average R, with `n`.

### 5.2 Back

Ordered rules from the playbook (R-07 store), a **Skip when…** list (new optional playbook field, owner to confirm in `OD-46` d), and the drill result from §4.5.

### 5.3 Numbers

From `R-08a` selectors only: excludes `is_sample` and `open`, skips `rMultiple === null` and prints the skip count, gross only. Minimum sample for any rate: 10 trades (interim; `OD-46` e).

### 5.4 Uses

Glance before the session; a **binder** view (grid of all playbook cards); share a setup with Shield on, which hides results entirely and shows rules and example only.

---

## 6. Later cards

Each is a layout on the §2 frame. None is in the queue yet; each waits on the work named.

| Card | Shows | Waits on |
| :--- | :--- | :--- |
| **Day card** | Planned levels against where trades happened (ladder), net R, rules %, mood, missed moves | BET-02, docs/12 markup |
| **Plan card** (pre-market) | Levels, zones, bias, max loss, if/then lines; `9:16` for the lock screen | docs/12, `OD-19` |
| **Mistake card** | One recurring tag or broken rule, 3 small example charts, the rule that prevents it; feeds the Misses deck | `R-08a` per-tag stats |
| **Challenge card share** | Finished Clean Run or Drawdown Defender as a shareable image; progress, not P&L | Existing `ChallengeCard`, `CD-1a` frame |
| **Week card** | Week's trade count, rules %, best process trade, drill accuracy | `R-08a` |

---

## 7. Ways to use cards

- **Gallery:** any list (feed, playbook, tag) can switch to a grid of card fronts. Thumbnails are generated and cached; list queries still never select `bars` (B-42).
- **Side by side:** two cards of the same playbook, one well executed and one not, on one screen.
- **Warm-up before the open:** Today offers the 5-card warm-up deck before 09:30 ET.
- **Sharing:** mentor or study group, Shield on.
- **Assistant context:** a card's content object (`shareCardContent` and its siblings) is the natural bounded unit for `R-06` / `OD-19`. Read-only.
- **Print:** a playbook binder exported as a multi-page PDF (later; not in queue).

---

## 8. Order

1. `CD-1a`, `CD-1b` — Trade Card refresh on the shared frame.
2. `CD-2a`–`CD-2c` — Drill cards, *Take it?* kind first.
3. `CD-3` — Playbook card, after `R-07b` and `R-08a`.
4. §6 cards with the work they wait on.

Acceptance for every card PR: AGENTS.md §4 at `390×844`, all three sizes rendered in a test, Shield copy tested (no `$`, size, account or balance), reduced-motion flip and reveal, and the empty, loading and missing-bars states (docs/08 §4).

---

## 9. Review notes for future slices

### Trade Card

- **Keep the preview and export in sync.** Reuse the prepared PNG flow in [TradeCardSheet](../components/TradeCardSheet.tsx). When framing, size, side, or Shield changes, enable export only when the matching image is ready. Exercise rapid option changes and a failed encode with a retry. Include an open trade that shows `OPEN` without a result and a trade with a long rule list. Check the native Share tap on an iPhone when one is available. [Export behavior](08-ux-notes-viewing-and-journaling.md#11-trade-card)
- **Give the back its own privacy review.** Consider keeping journal notes and Mood Shape private by default on the back. If a back can be shared, preview both sides before exporting and test Shield across the chart, text, and filename. Use known safe fields in a Shield export. Custom notes, tags, playbook names, and rule labels can contain account names or dollar figures. [Current card content](../lib/shareCard.ts)

### Drill and Playbook Cards

- **Seal the information available at entry.** A completed candle containing the entry can include price movement after the fill, especially at `5m` or `15m`. Try showing only completed bars available at the cutoff, with a separate entry marker if needed. Derive scale and overlays from the sealed data so future bars or marks cannot give away the answer. Test a fill in the middle of a coarse bar and one at a bar boundary. [Bar alignment](../lib/trades.ts)
- **Teach the rule on the reveal.** Show the first relevant frozen checklist rule and the evidence available at the decision. Try weighting the Misses deck by repeatable rule errors, including a rule break on a winner. For the Take it versus Pass comparison, count the first sealed answer per trade, show each group's sample size, and present average R as a historical comparison. Track replay attempts in a practice count. [Blind review](13-bold-ui-bets.md#4-bet-03--blind-review)
- **Give empty decks a useful next step.** Show counts for trades awaiting the age cutoff and trades missing saved bars. Consider a clearly labeled sample drill with its own practice stats while the user's deck is empty. For Playbook Cards, consider letting the trader pin a good teaching example after the automatic selection works. [Candle cache](../lib/candles.ts)

### Scheduled handoff

- List one runnable slice per queue entry when the card work reaches the top. Link each entry to its acceptance checks and name its prerequisites. Read the queue from fetched `origin/main` when picking new work, and resume unfinished work on its topic branch. Include the slice ID, exact checks and results, and next eligible item in the review handoff. [Work queue](../NOTES.md#next-up) · [Contribution workflow](../CONTRIBUTING.md#4-working-with-ai-agents)
