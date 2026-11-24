# 01 — Playbook Lab: see what setups, trade types and tags exist and how they relate

Source: FIELD-NOTES *Idea: playbook lab (Chris 11/23, ~8:15 PM CT)*: "a page for viewing and exploring playbooks, trade types, and tags: what kinds of trades and setup tags exist and how they relate. Distinct feature from trade cards and review cards." Also *Gap: API-created trades had no setup* (playbook and tag vocabulary confusion). Related: docs/23 §5 (`CD-3` playbook card and `/playbooks` binder), docs/16 `R-07` (editor), `R-08a` (per-playbook and per-tag stats), `OD-26` / issue #7 / #23 (the real playbooks and tags are still placeholders), `OD-54` (editor limits), docs/playbook-design/03 (examples, drills; its slice 7 "Playbook hub") and 04 (discretionary prompts).

---

## 1. What exists

| Piece | Where | What it does |
| :--- | :--- | :--- |
| Playbook record | `lib/playbooks.ts` | `id`, `name`, `default_style`, ordered `checklist_rules`, `archived`. Seeds: ORB Reclaim, ONL Sweep + SMT, VWAP Trend Push, No Setup / Impulse. |
| Tag lists | `lib/playbooks.ts` | `SETUP_TAGS` (SMT Divergence, Pushed w/ NQ, Level Sweep, VWAP Hold, Opening Drive) and `EXECUTION_TAGS` (A+ Patience, Chased Entry, Cut Early, Moved Stop, Revenge). **Constants in code**: not editable, not synced, with no descriptions. |
| Editor | `components/PlaybookEditor.tsx` in Tune | Add, rename, reorder rules, archive. |
| Binder | `/playbooks` (`app/playbooks/page.tsx`, `components/PlaybookBinder.tsx`, `lib/playbook-binder.ts`) | A grid of active playbooks; tap opens the full card (`PlaybookCard`, stats, example, drill line); PNG export (`PlaybookCardSheet`). Reached only from Tune ("Open the binder"). There is **no `/playbooks/[id]` route** (the field note mentions one; docs/playbook-design/02 proposed it). |
| Stats | `lib/selectors.ts` `runningStats` | Per-playbook and per-tag breakdowns on Today (`R-08`). |
| Feed filters | `lib/selectors.ts` `FeedFilters` | Status only (`all`, `unreviewed`, `flagged`). |

What is missing for "how they relate": nothing shows which tags go with which playbook, which tags are never used, which trades have no setup, or examples of a tag. The binder answers "how is this playbook doing"; the Lab answers "what is my vocabulary and where is it used".

## 2. Where it lives

- **`/playbooks/lab`**, with a two-tab header on `/playbooks`: **Binder | Lab**. Shares the route family without changing the binder.
- Tune's link becomes "Playbooks & Lab". *(Decision Q-1: add Playbooks as a fifth bottom-nav item? The dock has four (`components/AppShell.tsx` `NAV`). Recommended: not yet; link from Tune and from the Review "All caught up" state.)*
- Read-only. Editing stays in Tune (`PlaybookEditor`). Every Lab screen links to the editor for the playbook shown.

## 3. What "trade types" means here

Chris used "trade types" next to playbooks and tags. The app has three candidates:

1. The **playbook** itself (the setup the trader names).
2. Shape facts code can compute: direction, exit reason, hold length band, whether the stop moved, result (win / loss / scratch).
3. A **family** above playbooks (reversal, continuation, breakout, impulse) that does not exist yet.

The Lab shows (1) and (2) now. (3) would be one optional field on `Playbook` (`family: string | null`) and is a decision (**Q-2**, recommended: wait until the real playbook list replaces the placeholders, `OD-26`). `trade_style` is not used: OD-24 removed its labels from the interface.

## 4. Screens (390×844 first)

### 4.1 Lab home

```
Binder | Lab
Your vocabulary                        include samples ○
4 playbooks (1 archived) · 5 setup tags · 5 execution tags
31 trades · 26 with a playbook · 19 with a setup tag
[ Playbooks ] [ Tags ] [ Map ] [ Gaps ]        ← segmented, sticky
```

### 4.2 Playbooks

One row per playbook (active, then archived under a fold):

```
ORB Reclaim                                   12 trades · last Fri
 Setup tags:  Opening Drive 7 · Level Sweep 4
 Execution:   A+ Patience 5 · Chased Entry 2
 Ends by:     Target 5 · Trailed 3 · Stop 4
 Rules followed 82% · Avg +0.31R (n 12)
```

Tap → **playbook view** (inside the Lab, `?playbook=orb-reclaim`): rules (read-only), co-occurring tags as horizontal bars with counts, shape facts (direction split, exit reasons, hold bands, stop moved %, win/loss/scratch), three example trades (latest, best rules-followed, latest loss) as rows with sparklines (no live chart per row, as the binder does), and links: "Open card" (binder), "Edit" (Tune), "All 12 trades" (Feed filtered).

### 4.3 Tags

Two groups, Setup and Execution. Each tag:

```
Level Sweep · setup                            9 trades
 With: ONL Sweep + SMT 5 · ORB Reclaim 4
 Avg +0.12R (n 9) · rules 78%
 [3 example rows]
```

Plus **Not in your vocabulary**: tags found on trades that are not in the current lists (left by older versions or by the API), each with a count and a link to those trades. This is where the 11/23 "VWAP Hold as a playbook" kind of mix-up becomes visible.

### 4.4 Map

A playbook × setup-tag grid with counts. The cell shade is the count (single hue, `--gold-mid` at token intensity, Invariant 5); results are not encoded in colour (gold is for good process, #80). Tap a cell → the Feed with `playbook=` and `tag=`. On a phone the grid scrolls sideways **inside its own container** with the first column pinned; the page itself never scrolls sideways (AGENTS §4). With more than 8 tags, a list view replaces the grid ("pairs, most used first").

### 4.5 Gaps

- Trades with no playbook (link).
- Trades with a playbook but no setup tag (link).
- Playbooks never used, tags never used.
- "No Setup / Impulse" share of all trades.

Each line is a link to the matching trades in the Feed, where the Pit Stop can fix them.

## 5. Tag registry (optional package `PL-3`, needs a decision)

Tags are code constants today. For the Lab to show descriptions, and for the agent vocabulary ([07](07-agent-api.md) §3.1) to stay current without a deploy, tags need to be data:

```ts
// singleton "tag_registry" (like prefs), synced, in backups
interface TagRegistry {
  setup: TagDef[]; execution: TagDef[];
}
interface TagDef { id: string; label: string; description: string; retired: boolean; playbook_ids: string[] }
```

- Trades keep storing labels in `quick_tags` (no trade migration). The registry maps labels to definitions; a renamed tag keeps its old label in `aliases`. Retired tags stay resolvable (like archived playbooks, `OD-54`).
- `playbook_ids` lets a tag declare where it belongs, which the Pit Stop can use to order chips.
- Seeded from today's constants; edits in Tune next to the playbook editor.

*(Decision Q-6: build the tag registry now, or keep constants until Chris supplies the real list (`OD-26`, issues #7/#23)? Recommended: build it with the Lab, because the agent API needs a live list and the real list is exactly what Chris will want to edit.)*

## 6. The pure model

`lib/playbook-lab.ts` (new, pure, no React):

```ts
interface LabView {
  counts: { playbooks: number; archived: number; setupTags: number; executionTags: number;
            trades: number; withPlaybook: number; withSetupTag: number };
  playbooks: PlaybookFacet[];      // per playbook: n, last used, co-tags, exit reasons, shape facts, rules %, avg result R, examples
  tags: TagFacet[];                // per tag: kind, n, playbooks with counts, avg result R, rules %, examples
  unknownTags: { label: string; n: number }[];
  matrix: { playbookId: string; tag: string; n: number }[];
  gaps: { noPlaybook: string[]; noSetupTag: string[]; unusedPlaybooks: string[]; unusedTags: string[]; impulseShare: number | null };
}
function labView(playbooks, tags, trades, opts: { includeSamples: boolean; now: number }): LabView
```

- Real, closed trades for results; open trades count in "n" but not in results (`OD-38`).
- Averages print only from `PLAYBOOK_CARD_MIN_TRADES` (10) trades, like the binder ("n 4 · not enough for rates yet").
- Result R is account R ([04](04-r-size.md)) once `RS-3a` lands; before that, the existing `rMultiple`. The model takes an `rOf(trade)` function so it does not care which.
- Shield hides money (there is none here except via R) and hides nothing else: counts and R are allowed (UX-64).
- Examples: by trade id only; rows render with the stored `sparkline` (B-42: lists never load candles).

## 7. Feed filters the Lab needs

The Lab links into the Feed with `playbook`, `tag`, `account` and `date`. The Feed filter extension is package `NAV-1` ([06](06-daily-review-and-review-cards.md) §5); the Lab only builds URLs with `filtersToQuery`.

## 8. Relationship to the playbook-design proposals

The Lab is not the "Playbook hub" of docs/playbook-design/03 slice 7, which centres on saved chart examples and drills. The Lab reads only what exists now (playbooks, tags, trades). If examples ship later, the playbook view in §4.2 gains an "Examples" row that links to them; nothing here blocks that design.

## 9. Acceptance

- `/playbooks/lab` at 390×844: no horizontal page overflow (the Map scrolls inside its container), 44 px targets, tabular numbers.
- Every count is a link and the linked Feed shows exactly that many trades (test on fixtures).
- Unknown tags appear when a trade carries one; disappear when fixed.
- Samples excluded by default; the toggle includes them, labelled.
- States: loading, no trades ("Log a trade and tag it to see your map"), no tags used, Shield on, a playbook archived with trades.
