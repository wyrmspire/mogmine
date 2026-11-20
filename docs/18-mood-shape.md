# 18 — Mood Shape

A soft radar blob that shows the trader's discretionary and emotional state on one trade. It sits next to the R strip, on the Trade Card, as a 40px thumbnail in the feed, and stays visible in blind review. The payoff is comparing how trades felt with how they ended.

Builds on [03 §2A](03-trade-cards-and-note-taking.md) (the auto-parser's "Emotional State"), [08](08-ux-notes-viewing-and-journaling.md) (UX-33 AI suggests and the trader decides, UX-67 describe and never judge), [13 §4](13-bold-ui-bets.md#4-bet-03--blind-review) (BET-03 blind review) and [15 §3.1](15-trade-document-and-render-grammar.md) (events are the truth). Open choices are `OD-39` in [DECISIONS.md](../DECISIONS.md).

**Status:** built on the device. Pure functions, fixtures, the editor, the thumbnails and the stats card are on `main` after this change. No table and no migration until `OD-30` is settled. The AI parser is not built: an on-device phrase matcher stands in for it and uses the same output contract.

---

## 1. The shape

- Each **spoke** is an emotion or state, and each scored spoke has a value from 0 to 1. The radius is the score. The spokes are spread evenly by angle, and the first one points up.
- The outline is a closed uniform Catmull-Rom curve through one point per spoke (the `curveCatmullRomClosed` family), written out in `moodPath()` so each segment can be drawn solid or dashed. It renders as SVG, separate from the chart canvas, and as `Path2D` on the Trade Card.
- A score of 0 is drawn at 12% of the radius, so a low spoke does not collapse into the centre.
- **Unknown is not 0.** An unscored spoke is drawn at a neutral 50% radius with dashed segments on both sides. It is left out of every calculation. The fill gets fainter as fewer spokes are scored.
- When the scored spokes sit within 0.25 of each other, the shape is round and reads as `Balanced`. A spoke dominates when it is at least 0.5 and 0.15 above the next one.
- Colour is neutral ink. A single shape never uses profit or loss colour, and gold stays reserved for good process (#80).

Starting spokes, ordered so opposites face each other: calm/patience, confidence, hope, FOMO, fear, frustration. Calm faces FOMO, confidence faces fear, and hope faces frustration.

## 2. Where a score comes from

Resolved per spoke by `moodVector()`, highest priority first:

| Priority | Origin | Stored? | Notes |
| :--- | :--- | :--- | :--- |
| 1 | `user`: a drag, the arrow keys, or "Clear" (back to unknown) | Yes | The newest user value wins over any AI value, whichever was written later (UX-33). |
| 2 | `voice_ai`: an accepted suggestion, or a re-score after a spoke was added | Yes | Always carries an evidence quote and the model name. |
| 3 | `tag`: a default from execution tags | No | `A+ Patience` → calm 0.8, `Chased Entry` → FOMO 0.8, `Cut Early` → fear 0.7, `Moved Stop` → hope 0.7, `Revenge` → frustration 0.8. Computed when read. |
| 4 | none | — | `null`, drawn dashed. |

**Suggestions are never scores.** "Suggest from notes" reads the thesis, management, note and after-exit text and keeps a pending suggestion that shows each spoke, its value and a quote. Accept one, accept all, or dismiss. Accepting skips any spoke the trader set by hand. If the notes only speak to spokes the trader already set, nothing is offered and the toast says so.

## 3. Records (derived and versioned)

```ts
interface MoodRecord {
  id: string; trade_id: string;
  spoke_set_version: number;               // registry version it was made against
  scores: Record<string, number | null>;   // null only on a user record ("not scored")
  evidence: Record<string, string>;        // quote per spoke; required for voice_ai
  source: "user" | "voice_ai";
  model: string | null;                    // parser or model for voice_ai
  captured_at: string | null;              // when the feeling was captured; null if unknown
  created_at: string;
}
```

- Records are **append-only**. A correction is a new record. Undo removes only a user record the trader just made.
- The notes and transcripts are the truth. Scores can be rebuilt from them.
- `captured_at` before the exit makes a score **pre-exit**, after the exit **post-exit**, and `null` **unknown**. Tag defaults count as unknown. A capture on an open trade is pre-exit.
- The spoke registry `{version, spokes[]}` is kept apart from the records. Spokes are only ever added, never removed or renamed in place.
- On the device: `localStorage["mogmine-mood-v1"]` holds the registry, the records, pending suggestions and candidates (`lib/mood-store.ts`). Backups carry `mood` (the registry, records and candidates). An older backup without it leaves this device's mood data untouched.
- This replaces the `mood_tag` column named in docs/06 and the drift register, which never existed in code.

## 4. The AI parser contract

When the voice auto-parser is built, its mood output must pass `parseMoodSuggestion()`:

```json
{ "scores": { "fomo": 0.8 }, "evidence": { "fomo": "chased the third push" },
  "candidates": [ { "label": "Boredom", "evidence": "bored after an hour of chop" } ] }
```

Every score must be between 0 and 1 and must have evidence. The evidence must be a quote of the source text (`…` marks cut text). A score for a spoke that is not in the registry becomes a candidate. The model judges feelings, which code cannot compute, so this does not conflict with guardrail 11.

## 5. Dynamic spokes

1. A suggestion names emotions that are not spokes yet. Each one is counted once per trade in `mood_spoke_candidates`. Sample trades never count.
2. Once a candidate reaches **N trades (default 3, `OD-39`)**, the editor offers `Add spoke "Boredom"?`, with **Add spoke** and **No thanks**. No thanks is permanent.
3. Adding a spoke creates registry version + 1. Past real trades are then **re-scored for that spoke only** from their own text (`rescoreForNewSpoke`). Trades the trader scored by hand, and trades whose text says nothing about it, stay unknown, never 0. Re-scores have `captured_at: null`, because nobody knows when old notes were written.
4. Old scores keep their values. Shapes are compared over the spokes that both trades scored.

## 6. Comparing shapes with outcomes

- `similarTrades()`: cosine similarity over shared spokes (at least 3), 0.9 or higher counts as "felt like this". Samples are compared only with samples. Shows wins, losses, mean R, a dot per trade and the sample size.
- `moodOutcomeStats()`: average shape of winners against losers (overlaid outlines, solid for winners and dashed for losers, so colour is not the only cue), and mean R by the strongest feeling. It uses real, closed trades with an R only. Samples, open trades, trades without a stop and trades without a shape are counted as left out, never as 0. All figures are gross.
- **Under 20 trades:** every view says "not enough data yet" and shows the count.
- **Hindsight.** A mood recorded after the exit may just reflect the result. The stats card has a **Before exit only** switch that uses pre-exit scores and drops tag defaults. Weighting pre-exit against post-exit scores is left to `OD-39`; the two are kept apart instead of mixed.

## 7. Surfaces

| Where | What |
| :--- | :--- |
| Trade detail | A 44px shape in a 48px button next to the R strip, and a Mood Shape card (description, Adjust, trades that felt like this). Both open the editor. |
| Editor sheet | 300-unit SVG with axis labels. Each spoke handle has a 52-unit hit circle (55px measured at 390×844). Arrow keys move a focused handle by 0.05 and Home/End go to 0/1. One record per finished drag, with Undo. Shows the list of spokes with source, before or after exit, and quote. Suggestions and "Add spoke?" appear below. |
| Trade Card PNG | 128px shape at the top right with a one-phrase caption ("FOMO high"). Only drawn when something is scored. |
| Feed and Today rows | 40px thumbnail, hidden in the desktop detail rail. |
| Blind review | The sealed card shows the shape and "How it felt: …". The result stays hidden. |
| Feed | "Mood and result" card (collapsed), with the before-exit switch. |

Copy describes and never judges (UX-67): "FOMO high", "Calm / patience low", never "You chased".

## 8. Files

`lib/mood.ts` (pure), `lib/mood-store.ts` (device store), `components/MoodShape.tsx`, `components/MoodEditorSheet.tsx`, `components/MoodCard.tsx`, `lib/__tests__/mood.test.ts`, `fixtures/trades/ex-tp.json` (calm, round), `ex-sl.json` (FOMO, stretched), `ex-trail.json` (scored on the added Boredom spoke), `fixtures/mood/spokes-v2.json`.
