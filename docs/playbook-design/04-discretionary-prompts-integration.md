# Addendum 04 — Discretionary review prompts in the playbook system

**Status** — Design addendum for wyrmspire, 2026-11-22. Not a competing design: it extends [MogMine playbook design v2](03-unified-design-v2.md) (“03”) and the discretionary-call proposal [docs/25](../25-discretionary-calls.md) (`OD-52`, model in [`lib/calls.ts`](../../lib/calls.ts)). Names, data shapes and decisions from 03 are reused as they are. New owner decisions are numbered `OD-DP-01`… and collected in §7 and in [04-summary.md](04-summary.md). Nothing here is decided; agents propose, the owner decides.

The owner's ask (via Tappy): review questions for discretionary moves (“why did you choose this stop?”, “why did you get out early?” and more) should work with playbooks. The owner expects the set of questions to grow and expects to need a settings page to manage it.

**One-line model.** *Kinds* stay a closed, code-owned list (they decide how a call is graded). *Prompts* become an owner-edited library: questions with reason chips and a trigger. *Playbooks* attach prompts and can hold **discretionary rules**, which say when a departure from the plan is part of the setup. *Calls* are the answers. Each call freezes the prompt text, chip labels and rule label it was answered with, the same way a trade freezes its checklist (UX-50).

---

## 0. What the worktree supports (checked against `a3b0397`)

| Checked | Evidence and design consequence |
| --- | --- |
| Call kinds and chips are code constants | `CALL_KINDS` holds seven `CallKindSpec`s, each with one `prompt` string and `reasons: readonly string[]`. `SHARED_CALL_REASONS` adds four. There is no store yet (`DC-2` pending). [calls.ts](../../lib/calls.ts#L22) |
| Calls store chip **labels** | `DiscretionCall.reasons: string[]` holds chip text, and `validateCall` rejects any label not in `reasonsFor(kind)`. Once chips can be edited, a rename would make every old call invalid. **Calls must store stable chip IDs plus frozen labels before `DC-2` ships a store** (§1.4). [validateCall](../../lib/calls.ts#L95) |
| Grading exists only for Cut and Early take | `gradeCall` uses the trade's stop, target and `initial_stop_price` with `buildHindsight`. Every other kind returns `not_graded`. Grades are derived and never stored. [gradeCall](../../lib/calls.ts#L154) |
| Playbook rules are label-only | `PlaybookRule = { id, label }`, up to 12. Rule IDs come from `newPlaybookItemId` and never change, so renames keep history joined. [playbooks.ts](../../lib/playbooks.ts#L8) · [store ids](../../lib/playbooks-store.ts#L128) |
| Checklist freeze and adherence | Pit Stop writes `checklistFor(id)` into `trade.checklist_state` on assignment. `adherence(trade)` counts **every** item, and the running stats and Clean Run read it. Adding discretionary rules to `checklist_state` would change adherence scores and Clean Run results, so they need their own frozen field (§2.3). [PitStop](../../components/PitStop.tsx#L50) · [selectors](../../lib/selectors.ts#L207) · [challenges](../../lib/challenges.ts#L225) |
| Fields a deviation detector can read today | `TradeRecord`: `direction`, `entry_price`, `exit_price`, `exit_time`, `stop_loss_price` (working stop), `initial_stop_price` + `initial_stop_set_at` (frozen first stop, R-10; null on older records), `planned_target_price`, `quantity`, `playbook_id`. No stop-move times, no “normal size”, no signal direction. [TradeRecord](../../lib/trades.ts#L52) |
| Richer facts in the trade document | `buildTradeDocument` derives `exit_reason` (`target` / `stop` / `trail` / `manual` / `unknown`) with a basis, and a `stop_path` from `order`/`modify` events. Flat stored trades get only exit-reason inference (“exit equals stop or target”) and no stop path. [trade-document.ts](../../lib/trade-document.ts#L51) · [docs/15 conversion table](../15-trade-document-and-render-grammar.md) |
| No size baseline | `TradingAccount` and `AccountRules` carry loss limits and targets but no normal size. Neither does `Playbook`. A Size trigger needs a new field (`OD-DP-08`). [accounts.ts](../../lib/accounts.ts#L26) |
| Management surfaces | Tune hosts the gold presets and `PlaybookEditor` (add, rename, restyle, reorder rules with ↑/↓, archive with Undo toast, archived disclosure). Close happens in `CloseTradeSheet`. The review queue (`ReviewScreen`) asks for “Playbook, tags, one line. Then mark it reviewed.” [PlaybookEditor](../../components/PlaybookEditor.tsx#L33) · [CloseTradeSheet](../../components/CloseTradeSheet.tsx#L18) · [ReviewScreen](../../components/ReviewScreen.tsx#L76) |

---

## 1. Prompt model

### 1.1 Three layers, three owners

| Layer | What it is | Owner | Mutable? |
| --- | --- | --- | --- |
| **Kind** (`CallKind`) | The seven departures in docs/25 §2: Skip, Flip, Cut, Early take, Stop here, Hold, Size. | **Code.** The grader branches on it, so the owner cannot add or edit kinds. | Only by a code change and a docs/25 revision. |
| **Prompt** (`ReviewPrompt`) | A question with its reason chips and a trigger: “Out before your target. Why?” Each prompt belongs to one kind. | **The prompt library**, edited by the owner in Tune. Seeded from docs/25. | Yes, by the owner. Changes apply to future asks only. |
| **Attachment** | Which prompts a playbook asks, plus the playbook's **discretionary rules** (§2.3), each of which brings its own rule-check question. | **The playbook.** | Yes, by the owner in the playbook editor. Frozen onto the trade at playbook selection. |
| **Ask / answer** | A prompt that fired on a specific trade (or plan) and the call that answers it. | **The review flow.** It decides when to ask and records the answer. | The answer can be edited like a note. Its frozen prompt text cannot. |
| **Ad-hoc** | A call the trader makes from the call sheet with no trigger. | The trader, on that trade. | It uses the kind's **primary prompt**, so ad-hoc calls stay in the same taxonomy. |

So the answer to “who owns a prompt” is **both, at different layers**. The library owns the *definition* (words, chips, default trigger). The playbook owns *whether and when it is asked* for that setup, and any setup-specific rule. The review flow owns the *instance*. That is the same split as checklist rules (the playbook owns the definition; the trade owns its frozen copy and the ticks).

**Per-trade ad-hoc prompts** (a one-off question typed for one trade) are deliberately not a separate concept. A one-off question with no chips is a note, and notes already exist (docs/03 §2). The call sheet's free-text line covers “something else”. If the owner wants a one-off question to become reusable, a **“Save as prompt”** action on the call creates a library prompt (§3.5).

### 1.2 Calls vs reflections

Every docs/25 kind is a *departure from a default*, so it can be graded. The owner's growing list will probably include questions that aren't departures: “What was NQ doing at your entry?” or “Would you take this again?”. Those can't be graded and shouldn't be scored as discretion.

The model leaves room for them with `answer_shape: "call" | "reflection"`. A reflection has chips and text but no kind and no grade, and it is stored separately (`PromptAnswer`, §1.4) so the discretion score never counts it. **Recommendation: ship call prompts only, and add reflections when the owner first asks for a question that isn't a departure** (`OD-DP-01`).

### 1.3 Interfaces

Same style as 03: additive, `user_id` everywhere (Invariant 7), times as ISO strings in records and UTC milliseconds only where candles are involved, and limits enforced by the sanitizer.

```typescript
import type { CallKind, DiscretionCall } from "./calls.ts"
import type { PlaybookRule } from "./playbooks.ts"
import type { PlaybookV2 } from "./playbook-examples.ts" // 03's extension

/** A reason chip with a stable id. Renames keep the id, so stats stay joined (same rule as playbook rule ids). */
export interface ReasonChip {
  id: string                 // seeds: "seed:cut:thesis-broken"; owner chips: newPlaybookItemId(label, taken)
  label: string              // ≤ 32 chars
  /** Groups chips across kinds for filters and Mood Shape evidence (docs/18). Seeds set it; the owner can change it. */
  family: "market" | "plan" | "risk" | "state" | "other"
  /** Hidden from pickers; still labels and filters past calls. A chip that has never been used can be deleted outright. */
  retired: boolean
}

export type DeviationKind =
  | "exit_before_target_loss"   // → cut
  | "exit_before_target_profit" // → early_take
  | "exit_beyond_target"        // → hold
  | "stop_widened"              // → stop_here (variant), OD-DP-02
  | "stop_tightened"            // → stop_here (variant), OD-DP-02
  | "stop_set"                  // → stop_here (the trade has a stop at all)
  | "no_stop"                   // → reflection, later (OD-DP-01)
  | "size_off_normal"           // → size, needs a baseline (OD-DP-08)
  | "against_signal"            // → flip, needs a recorded signal direction
  | "setup_not_taken"           // → skip, needs a planning session (OD-51, PS-4)

export type PromptTrigger =
  /** Asked on every eligible trade, optionally only when a fact is present ("has a stop"). */
  | { on: "always"; when?: DeviationKind }
  /** Asked only when the detector finds one of these departures. */
  | { on: "deviation"; deviations: DeviationKind[] }
  /** Never asked automatically; offered in the call sheet and on Trade Detail. */
  | { on: "manual" }

export interface ReviewPrompt {
  id: string                 // seeds: "seed:cut"; owner prompts: generated, never changes
  user_id: string
  /** Seed lineage, so "Reset to default" and seed upgrades work without overwriting edits (§3.4). */
  seed_id: string | null
  seed_version: number | null
  answer_shape: "call" | "reflection"
  /** Required when answer_shape is "call". Immutable after the first answer (OD-DP-12). */
  kind: CallKind | null
  /** The kind's prompt in the manual call sheet. Exactly one active primary per kind. */
  primary: boolean
  question: string           // ≤ 120 chars
  reasons: ReasonChip[]      // ≤ 12, the owner's order is the picker order
  include_shared_reasons: boolean
  ask_conviction: boolean
  trigger: PromptTrigger
  /** "global": asked on every playbook unless the playbook turns it off. "playbook": only where a playbook turns it on. */
  scope: "global" | "playbook"
  retired: boolean
}

/** The whole library: one localStorage document, like the playbook list. */
export interface PromptLibraryV1 {
  schema: "mogmine.prompt_library.v1"
  user_id: string
  /** Highest seed set merged so far (§3.4). */
  seeds_version: number
  shared_reasons: ReasonChip[] // docs/25: Gut, News soon, Tired / tilted, Daily limit close
  /** Ordered: library order is ask order when several prompts fire on one trade. */
  prompts: ReviewPrompt[]
}
```

Playbook side (additive to 03's `PlaybookV2`; same sanitizer, draft and backup paths 03 already calls out for `thesis`):

```typescript
/** A rule is mechanical (a pre-trade checkbox, today's behaviour) or discretionary (a sanctioned departure). */
export interface PlaybookRuleV2 extends PlaybookRule {
  /** Absent means "mechanical", so every stored rule keeps its meaning. */
  mode?: "mechanical" | "discretionary"
  /** Discretionary only: which departures this rule covers. "Exit early if momentum stalls" → exit_before_target_*. */
  covers?: DeviationKind[]
}

export interface PlaybookPromptSettings {
  /** Global prompts this playbook does not ask. */
  off: string[]
  /** Playbook-scoped prompts this playbook does ask. */
  on: string[]
}

export interface PlaybookV2 /* 03 */ {
  thesis?: string
  checklist_rules: PlaybookRuleV2[] // same 12-rule limit, mechanical and discretionary together (OD-DP-03)
  prompt_settings?: PlaybookPromptSettings
  /** Optional baseline for the Size trigger (OD-DP-08). Contracts, integer ≥ 1. */
  normal_quantity?: number
}
```

Trade side. Discretionary rules are frozen like the checklist but in a separate field, so `adherence()`, running stats and Clean Run are unchanged:

```typescript
/** Frozen at playbook selection, next to checklist_state (UX-50). Written by the same Pit Stop code path. */
export interface FrozenDiscretionRule {
  id: string
  label: string
  covers: DeviationKind[]
}

export interface TradeRecordAdditions {
  /** Absent on older records and on trades whose playbook had no discretionary rules. */
  discretion_rules?: FrozenDiscretionRule[]
  /** Frozen with the playbook, for the Size trigger. */
  normal_quantity_at_selection?: number | null
}
```

### 1.4 The call record grows (changes to `DiscretionCall`, before `DC-2`)

```typescript
/** A chip as it was when the call was saved. Stats group by id; the call shows its own label. */
export interface FrozenReason { id: string; label: string; family: ReasonChip["family"] }

export interface DiscretionCallV2 extends Omit<DiscretionCall, "reasons"> {
  reasons: FrozenReason[]             // replaces string[]
  /** Which prompt asked. Null only for records migrated from label-only drafts. */
  prompt_id: string | null
  prompt_question: string             // frozen text of the question actually shown
  /** How it was asked. */
  origin: "manual" | "close_sheet" | "review" | "session_review" | "plan"
  /** The departure that triggered it, when there was one. */
  trigger: { deviation: DeviationKind; basis: "broker" | "recorded" | "inferred" } | null
  /** Discretionary rule check (§2.4). */
  rule: { id: string; label: string; verdict: "applied" | "not_applied" } | null
  /** exact: made_at is a known time (exit fill, initial stop set). bound: it's the latest possible time (a stop move on a flat record). */
  made_at_basis: "exact" | "bound"
}

/** Reflection answers (OD-DP-01, later). Separate store, never in the discretion score. */
export interface PromptAnswer {
  id: string; user_id: string; prompt_id: string; prompt_question: string
  trade_id: string | null; plan_session_id: string | null
  reasons: FrozenReason[]; note: string; recorded_at: string
}

/** "Not a call" vs "Later". Lets a fired prompt stop nagging without inventing an answer. */
export interface PromptDismissal {
  id: string; user_id: string; trade_id: string; prompt_id: string
  deviation: DeviationKind | null
  reason: "not_a_call" | "later"   // later: re-shown at the next review pass
  recorded_at: string
}
```

`validateCall` needs the library passed in: a chip is valid when its id is in the prompt's chips **or** in the frozen label set already on the call (so a call stays valid after its chip is retired or renamed). The kind-level checks (trade link, flip direction, ticks, conviction, time order) are unchanged.

### 1.5 Where it lives (extend, don't replace)

| Data | Store | Why there |
| --- | --- | --- |
| `PromptLibraryV1` | **New** localStorage key `mogmine-review-prompts-v1`, with a store module shaped exactly like `playbooks-store.ts` (hydrate, sanitize, seed-merge, `useSyncExternalStore`, `storage` event, backup/restore). | Small, settings-like, read synchronously by the close sheet. Same pattern as playbooks. |
| `CALL_KINDS` | Stays in `lib/calls.ts` as the **seed source** and the kind registry (glyph, `against`, `trade` link rule). Its `prompt` and `reasons` become the v1 seeds. | Grading and validation need the closed list in code. |
| Discretionary rules, per-playbook prompt settings, `normal_quantity` | **Extend** `mogmine-playbooks-v1` entries (`PlaybookV2`). | They are part of the setup definition and must ride the playbook backup. |
| Calls (`DiscretionCallV2`) and dismissals | **Extend** the planned `mogmine-calls-v1` (`DC-2`): `{ calls: [], dismissals: [] }`. | One store for everything the review flow writes about discretion. |
| Reflection answers | `mogmine-prompt-answers-v1`, later. | Kept apart so discretion stats never pick them up. |
| Grade cache | IndexedDB, derived and rebuildable (§4.5, `OD-DP-11`). | Grades stay “derived, never stored as truth”. |
| Later, Supabase (R-05) | `review_prompts` (one row per prompt, chips as JSONB), `discretion_calls`, `prompt_dismissals`, all with `user_id` and RLS. List queries never join bars. | Matches 03's “same pair moves to owner-scoped tables” path. |

The journal backup (`lib/store.ts`) gains `prompt_library` and `calls` sections. An older backup without them leaves the device's library alone, which is how `sanitizePlaybooksBackup` already treats missing playbook lists.

---

## 2. Attachment and triggers

### 2.1 The deviation detector

One pure function, no storage, no React. It runs whenever a prompt might be due: when the close sheet saves, when a review card opens, and in the after-session review.

```typescript
export interface Deviation {
  kind: DeviationKind
  /** Where the fact came from. Inferred facts are shown with "inferred" in the prompt (docs/15 basis rules). */
  basis: "broker" | "recorded" | "inferred"
  /** Best decision time, ISO UTC, and whether it is exact. */
  made_at: string
  made_at_basis: "exact" | "bound"
  /** Price the call is about, snapped to ticks (stop price, exit price). */
  price: number | null
  price_ticks: number | null
  /** Plain sentence for the prompt header, built by code: "Out at 6010.00, 40 ticks before your 6020.00 target." */
  fact: string
}

export interface DeviationContext {
  /** From the trade document when it exists (broker exit_reason, stop_path); else flat fields. */
  doc?: TradeDocumentFacts
  /** Ticks of slippage still counted as "at the plan" (OD-DP-07). Default 1. */
  at_plan_tolerance_ticks: number
}

export function detectDeviations(trade: TradeRecord, ctx: DeviationContext): Deviation[]
```

Rules, all in integer ticks (guardrail 4). `sign` is +1 for long and −1 for short.

| Deviation | Fires when (flat `TradeRecord` fields) | Upgrade when a trade document exists | Does not fire when |
| --- | --- | --- | --- |
| `exit_before_target_loss` / `_profit` | Closed. `stop_loss_price` and/or `planned_target_price` set. The exit is strictly inside `(stop, target)` by more than the tolerance at both edges. Profit or loss by `(exit − entry) × sign`; a scratch (0 ticks) counts as loss (a cut), `OD-DP-07`. | `exit_reason = "manual"` with `broker` basis confirms it. `target` / `stop` / `trail` suppresses it even if prices disagree. | No target **and** no stop (no plan to depart from). Exit within tolerance of the target or stop. Only a stop is known and the trade is in profit: “early” has no meaning without a target, so nothing fires. |
| `exit_beyond_target` | Closed, target set, `(exit − target) × sign > tolerance`. | `exit_reason = "trail"` is still a hold (trailing is how you hold). | No target. |
| `stop_widened` / `stop_tightened` | `initial_stop_price` and `stop_loss_price` both set and differ by ≥ 1 tick. Widened if `(initial − working) × sign > 0`. `made_at` is the exit time (or now) with `made_at_basis: "bound"`. | `stop_path` gives each move with its time: one deviation per move, `made_at_basis: "exact"`. | `initial_stop_price` null (pre-R-10 records: the initial stop is unknown and never back-filled). |
| `stop_set` | `initial_stop_price` set. `made_at = initial_stop_set_at`, exact. | The first stop order in the document. | No stop. |
| `size_off_normal` | `normal_quantity_at_selection` set and `quantity` differs. | Same, using filled quantity. | No baseline (the default today). |
| `against_signal` | A Flip line was answered on the add-trade form (docs/25 §5), or a planning-session row recorded a signal direction opposite `direction`. | — | No recorded signal. Playbooks have no direction field, and inventing one is out of scope. |
| `setup_not_taken` | After-session review only: a planning-session watched playbook with a planned entry, and no trade on that playbook in the session window. | — | Before `PS-4`. |

Detection uses only what was recorded. It never reads candles, so it works offline and in list views. Grades still read candles later. Deviations are **derived, never stored**, like grades. What *is* stored is the answer (a call) or the dismissal, and each carries the deviation that prompted it.

### 2.2 From deviations to asks

```typescript
export interface PendingAsk {
  prompt: ReviewPrompt
  deviation: Deviation | null      // null for "always" prompts without a when-condition
  /** Discretionary rules on the trade that cover this deviation, in rule order. */
  rules: FrozenDiscretionRule[]
  /** A call already on the trade that answers this ask: shown as "You called this at 10:42". */
  covered_by: DiscretionCallV2 | null
}

export function pendingAsks(
  trade: TradeRecord,
  deviations: Deviation[],
  library: PromptLibraryV1,
  playbook: PlaybookV2 | null,      // live playbook, only for prompt_settings
  existing: { calls: DiscretionCallV2[]; dismissals: PromptDismissal[] },
): PendingAsk[]
```

1. **Eligible prompts:** not retired, call-shaped (until reflections ship), scope `global` and not in `playbook.prompt_settings.off`, or scope `playbook` and in `playbook.prompt_settings.on`. A trade with no playbook, or `no-setup`, gets global prompts only.
2. **Match:** `deviation` prompts match any listed deviation found. `always` prompts match every closed trade, or only when their `when` fact is present.
3. **One ask per (kind, deviation).** When two prompts of the same kind match, the first in library order wins. A trade with a cut and a widened stop gets two asks, but two Cut variants never both fire.
4. **Coverage:** a call already on the trade with the same kind (and, for stop calls, the same `price_ticks`) covers the ask. The in-session call made from the open-trade bar is the one that counts, because it is not after the fact. The review shows it and offers **Add a reason**, not a second call.
5. **Dismissed** asks (`not_a_call`) never return. `later` asks return on the next review pass.
6. **Budget:** show at most `N` asks per trade (default 3, `OD-DP-06`). Deviation asks come before `always` asks; then library order. The rest collapse into “2 more questions”.

The ask list is computed live from the current trade and library. Editing the exit price can make an ask appear or disappear. An answered call whose deviation no longer holds keeps its answer and shows **“The trade changed after this answer”**. It is never deleted silently (UX-30–UX-39: nothing the trader wrote is lost).

### 2.3 Discretionary playbook rules

A mechanical rule is a pre-trade condition (“Waited for the candle close”): checked or not. A **discretionary rule** is a sanctioned departure: “Exit early if momentum stalls”, “Move stop to breakeven after 1R”, “Half size after a loss”, “Skip if NQ doesn't confirm”. The rule defines when leaving the mechanical plan is *part of the setup*.

- In the editor, each rule gets a mode switch (**Checkbox** / **Judgement call**). A judgement rule picks what it covers from plain choices that map to `DeviationKind`s: *Exit before target* → both `exit_before_target_*`; *Hold past target* → `exit_beyond_target`; *Move stop* → `stop_widened`, `stop_tightened`; *Change size* → `size_off_normal`; *Skip the setup* → `setup_not_taken`; *Take the other side* → `against_signal`.
- On playbook selection, Pit Stop writes `discretion_rules` next to `checklist_state` from the same live playbook. The UX-50 rules then apply to both: later playbook edits never touch the trade, and an explicit reassignment re-copies both. Mechanical rules stay in `checklist_state` and are the only rules `adherence()` sees. That is why the discretionary rules get a separate field (`OD-DP-03`).
- Discretionary rules do **not** show as checkboxes in Pit Stop. A judgement rule has no pre-trade “yes”, so ticking it would be noise.

### 2.4 How a rule spawns its question

When a deviation fires and the trade's frozen `discretion_rules` contain one or more rules that cover it, the ask gets a **rule step in front of the reason chips**:

> **Out 40 ticks before your 6020.00 target.** *(fact, by code)*
> Your ORB Reclaim rule: **“Exit early if momentum stalls.”** Is that why?
> `[ Yes, the rule ]`  `[ No, another reason ]`

- **Yes:** the call saves with `rule: { id, label, verdict: "applied" }`. The kind's chips are still offered, optional, so the trader can say *what* stalled (`Volume dried up`, `NQ turned`). One tap is enough to save.
- **No:** `verdict: "not_applied"`, and the normal chips follow. This is the important case: a departure the playbook didn't sanction (“off-book”).
- **No covering rule:** the ask goes straight to the chips. Every departure on a playbook without judgement rules is off-book by definition, and stats say so.
- Two covering rules show as two buttons plus **Neither**.

The question text is built by code from the frozen rule label. The owner doesn't write a prompt per rule; writing the rule *is* writing the question. If the owner wants a custom wording, a playbook-scoped prompt with the same deviation trigger replaces the default for that playbook (rule 3 in §2.2 picks it by library order).

Whether an applied rule should make the trade count as “followed the playbook” for adherence or Clean Run is a scoring change to docs/17, so it is flagged, not decided (`OD-DP-04`). Recommended: no effect in v1; show it in discretion stats only.

### 2.5 Every trade vs only on deviation

| Trigger | Use | Seeded |
| --- | --- | --- |
| `deviation` | The default for Cut, Early take, Hold, Size, Flip, Skip and stop moves. It asks only when something departed from the plan, so it isn't noise. | All except `stop_set` |
| `always` + `when` | Questions worth asking on every trade with a given fact. The owner's own example, “why did you choose this stop?”, is `always` when `stop_set`. | Stop here (`OD-DP-05`) |
| `always` (no `when`) | Reflections like “Would you take this again?”. Nothing seeded: `take_again` already covers this in blind review. | — |
| `manual` | Only from the call sheet. Good for rare questions the owner wants available but not asked. | — |

### 2.6 When the asks appear

| Surface | When | After the fact? |
| --- | --- | --- |
| **Close sheet** (`CloseTradeSheet`) | Right after the exit is saved, the detector runs and shows the first ask as one line under the result: “Out before target — why?” with chips. It is skippable, and skipping leaves it pending. | Usually not, when trades are logged live. This is the best place to catch the honest answer. |
| **Review queue card** (`ReviewScreen`) | A **Calls** step after playbook and tags, listing the pending asks for that trade. Marking the trade reviewed with asks still pending is allowed. They stay in a “2 unanswered” chip on Trade Detail. | Usually yes, and labelled so (docs/25 §1 rule 2). |
| **Trade Detail** | A “Questions” row lists pending asks and answered calls. | Depends on timing. |
| **After-session review** (docs/24 §4, `PS-4`) | The calls ledger shows answered calls plus a “Not yet answered” group. `setup_not_taken` asks appear only here. | Yes. |

Because D-011 makes end-of-day logging normal, most deviation answers will be after the fact. That's correct: docs/25 already counts after-the-fact calls separately and never mixes them in. The design should push the *in-session* call (open-trade bar, close sheet) as the fast path and treat review asks as the catch-up net.

---

## 3. Settings page

### 3.1 Where

**Tune → Review prompts**, a new card directly under **Tune → Playbooks**, built as `components/PromptLibraryEditor.tsx` with the same card shell, button classes, toast-with-Undo and archived disclosure as `PlaybookEditor`. If it outgrows a card, it moves to its own route (`/tune/prompts`) with a link from Tune (`OD-DP-13`). 03 already routes playbook work through Tune first and promotes later, so this follows the same path.

### 3.2 Library list (390×844)

```
Review prompts                                     [+ New]
Questions MogMine asks when a trade leaves the plan.

✂ Cut
  Out before your target, at a loss. Why?    On early exit · All playbooks   [Edit]
◎ Early take
  Why bank it before target?                 On early exit · All playbooks   [Edit]
⊢ Stop here
  Why is the stop at this price?             Every trade with a stop          [Edit]
  Stop moved further away. Why?              On stop widened · 2 playbooks    [Edit]
…
Shared reasons   Gut · News soon · Tired / tilted · Daily limit close        [Edit]
▸ Retired 3
```

- Grouped by kind in docs/25 order, using glyph **and** label (UX-80). Inside a group, **↑/↓** set library order, which is ask order. The group's primary prompt carries a small “Call sheet” badge.
- Each row's second line is code-generated from the trigger and scope, so the owner can see *when* a question will appear without opening it.
- 44 px rows, tabular numbers for counts, no horizontal overflow.

### 3.3 Edit form

| Field | Control | Notes |
| --- | --- | --- |
| Question | text, ≤120 | Live preview of the ask card, with a sample fact line. |
| Kind | seven glyph tiles | Locked once any call answers this prompt. The form then offers **Duplicate as a new prompt** (`OD-DP-12`). |
| When to ask | segmented: **On a departure** / **Every trade** / **Only when I call it** | “On a departure” reveals checkboxes limited to the departures that fit this kind (e.g. Cut can't pick `exit_beyond_target`). “Every trade” offers an optional “only if it has a stop”. |
| Playbooks | **All playbooks** / **Only some** + multi-select | Writes `scope` and the playbooks' `prompt_settings`. Archived playbooks are listed under a disclosure, read-only. |
| Reasons | chip list with ↑ ↓ ✕ and “Add a reason”, ≤12, plus “Include shared reasons” | Same interaction as rules in `PlaybookEditor`. ✕ on a chip that has been used **retires** it (“Used on 7 calls. It will stay on those.”). On an unused chip it deletes. Renaming keeps the id. |
| Family per chip | small menu | Market · Plan · Risk · State · Other. “State” chips feed Mood Shape evidence. |
| Conviction | toggle | Default on, as docs/25. |
| Primary | toggle | Turning one on turns the kind's previous primary off. The last active prompt of a kind can't be retired, because the call sheet needs one tile per kind. |
| Retire | button | Toast with Undo. Retired prompts stop firing. Answered calls keep their frozen text. **Restore** is under “Retired”. |
| Reset to default | seed prompts only | Restores seed text, chips and trigger. Owner chips that have been used are kept as retired, never deleted. |

### 3.4 Seeds vs the owner's library

- Seeds live in code, derived from `CALL_KINDS` (prompt text and chips) plus a seed table of triggers and families, with `SEED_PROMPTS_VERSION = 1`. Stable ids: `seed:<kind>` for prompts and `seed:<kind>:<slug>` for chips.
- First run copies the seeds into `mogmine-review-prompts-v1`. From then on the **stored library is the truth**. The seeds are only a source for merges and resets, the same as `PLAYBOOK_SEEDS` vs `mogmine-playbooks-v1`.
- **Seed upgrades** (a later build ships version 2): any seed prompt or seed chip id the library lacks is appended at the end of its kind group. Nothing the owner edited, retired or reordered is changed. This is the existing “a list saved by an older build gains any seed it lacks” rule in `sanitizePlaybooks`, applied to prompts (`OD-DP-09`).
- A seed the owner retired stays retired across upgrades. A seed the owner edited shows a quiet “Edited” badge and **Reset to default**.

### 3.5 Growing the library from use

- **“Save as prompt”** on any call's free-text line (§1.1) opens the edit form prefilled with the call's kind and the typed question.
- **Chip suggestions from text.** When the same word or phrase shows up in the free text of ≥3 calls of one kind (“FOMC”), the library card offers “Add ‘FOMC’ as an Early take reason?”. Counting is code, not the model. Accepting creates a chip. It never rewrites old calls (UX-33). Old calls can be re-tagged one at a time from Trade Detail, and each re-tag is recorded as an edit.

### 3.6 Inside the playbook editor

`PlaybookEditor`'s `DraftForm` gains three things and keeps its current layout:

1. **A mode switch per rule** (Checkbox / Judgement call). Judgement rules show a “covers” chip row underneath. The 12-rule limit is shared (`OD-DP-03`), so the editor doesn't grow a second list.
2. **A “Review questions” disclosure**: the global prompts with an on/off toggle each (default on), and an “Add a playbook-only question” picker over `scope: "playbook"` prompts. Prompts are listed, not edited, here. Editing happens in Tune → Review prompts, so a prompt has one place it is defined.
3. Optional **Normal size** stepper (`OD-DP-08`). Hidden until the owner turns on the Size trigger.

`no-setup` keeps no rules (its validator stays). It does get the global prompts: an impulse trade that cut early is exactly the case worth asking about.

---

## 4. Links, filters and stats

### 4.1 The answer taxonomy

Four coded levels and one free level. Every filter works on the coded levels.

| Level | Values | Owner | Stable key |
| --- | --- | --- | --- |
| Kind | 7, closed | code | `kind` |
| Rule check | applied / not applied / no rule | playbook | `rule.id` + `verdict` |
| Reason | owner's chips | prompt library | `FrozenReason.id` |
| Reason family | market / plan / risk / state / other | library | `family` (frozen on the call) |
| Free text and voice | anything | trader | — (searchable, never a filter key) |

Conviction (1–3), after-the-fact (derived), grade (derived) and `origin` are filter facets too.

### 4.2 Filters

A trade-list filter predicate, shared by the Feed, Review stats and the assistant API (docs/11):

```typescript
export interface CallFilter {
  kinds?: CallKind[]
  reason_ids?: string[]          // "exited early — reason: news" → kinds: ["early_take","cut"], reason_ids: ["seed:shared:news-soon"]
  families?: ReasonChip["family"][]
  rule?: { id?: string; verdict?: "applied" | "not_applied" | "none" }
  playbook_ids?: string[]
  after_the_fact?: boolean
  grade?: CallGrade[]            // needs grades (§4.5)
  prompt_ids?: string[]
  unanswered?: boolean           // trades with pending asks
}
export function tradesMatchingCalls(trades: TradeRecord[], calls: DiscretionCallV2[], f: CallFilter, grades?: Map<string, CallGradeFact>): TradeRecord[]
```

In the UI, a reason chip on any call (Trade Detail, ledger, stats row) is tappable and opens the feed filtered by that chip. That's the “exited early — reason: news” path, one tap from wherever the trader sees it. Filters key on chip **id**. A renamed chip still finds its old calls, which show their frozen label with the current label as a subtitle (`OD-DP-10`).

### 4.3 Stats surfaces

All numbers come from code (guardrail 11). Calls never change R, P&L or the running stats (B-63, UX-52). After-the-fact calls are a separate column, never merged in. 03's interim minimum applies: ten observations per denominator before a rate is shown; counts appear immediately.

| View | Rows | Columns |
| --- | --- | --- |
| **Per playbook** (03's playbook hub, “Tagged trades” block) | Each kind with calls on this playbook | Calls · applied-rule / off-book split · Paid / Cost / Even · net ticks and R vs default (graded kinds) · after-the-fact count |
| **Per discretionary rule** (playbook hub, under the rule) | “Exit early if momentum stalls” | Times the departure happened · times the rule was the reason · paid of those · same for off-book departures of the same kind. *This is the question the feature exists for: does my judgement rule pay better than my improvising?* |
| **Per prompt** (Tune → Review prompts, row detail) | Each prompt | Fired · answered in-session · answered in review · dismissed “not a call” · still pending. A high “not a call” rate means the trigger is wrong (tolerance, or a stale stop on record). |
| **Per reason** (docs/25 reason leaderboard) | Each chip id, filterable by playbook | Uses · paid / cost · net R. “`News soon` early takes on VWAP Trend Push paid 1 of 6.” |
| **Discretion score** (docs/25 §5) | Per kind | Unchanged, plus a playbook filter. |

Shield hides money and keeps R and ticks, as 03 does for examples. Reason labels are the trader's own words, so they follow 03's free-text Shield rule on any share surface.

### 4.4 Examples whose teaching point is a call

03's example is a frozen moment with a decision cutoff. 03 assumes the decision is the **entry**. A discretionary call is a second kind of decision: the trade is already on, and the question is *hold or act?* Proposed extension:

```typescript
/** Frozen copy of a call, inside the example snapshot. No live link: the call can be edited later without changing the example. */
export interface ExampleCallRef {
  call_id: string                // provenance only, like ExampleSource.trade_id
  kind: CallKind
  prompt_question: string
  reasons: FrozenReason[]
  rule: { id: string; label: string; verdict: "applied" | "not_applied" } | null
  conviction: 1 | 2 | 3 | null
  made_at: number                // UTC ms
  made_at_basis: "exact" | "bound"
  after_the_fact: boolean        // frozen: computed at capture
  note: string                   // subject to 03's Shield free-text rule
}

export interface ExampleExecution /* 03, extended */ {
  /** Needed to regrade the call from the frozen bars. Prices only, no dollars (03 stores no dollar result). */
  plan?: { initial_stop_price: number | null; stop_at_exit_price: number | null; planned_target_price: number | null }
}

export interface PlaybookExampleSnapshot /* 03, extended */ {
  /** What the example teaches. Absent means "entry", which is 03's behaviour. */
  focus?: { on: "entry" } | { on: "call"; call: ExampleCallRef }
}
```

- **Capture.** From Trade Detail's call list or the after-session calls ledger: **Save as Playbook Example** on a call opens 03's Flow A sheet with `focus: call` preselected. `decision_time` defaults to the call's `made_at` instead of the entry. A call with `made_at_basis: "bound"` can't be a focus (its moment is unknown), and the sheet says why. The window must contain the entry, the call moment and 03's follow-through. 03's existing validation and the 1,500-bar cap apply unchanged.
- **Classification.** 03's `ExampleKind` keeps its meaning, applied to the call: an **A+ Exemplar** of “Exit early if momentum stalls” is a stall read correctly. A **Near-Miss** is a correct rule used too late. An **Anti-Example** is a `Scared` cut dressed up as the rule. The verdict text explains it. The frozen rubric (03's `ExampleRubric`) includes discretionary rules with their mode, so the teaching rule shows up as a rubric line. `ExampleRule.assessment` reads as “applied well / misapplied / unassessed” for judgement rules.
- **Grade on the example.** Derived at view time from the frozen bars and `execution.plan`, using the same `gradeCall`. Because the bars are frozen, the grade is stable without being stored. Coverage rules come from 03: missing follow-through means “Can't tell yet”.
- **Decision view for a call focus.** The sealed projection cuts at `made_at`. Unlike 03's entry-focused drill, the **entry and the working stop and target are decision-side facts** and stay visible. The exit, the grade and the call's reasons stay hidden. This is a precise change to 03's “withhold execution overlays before an answer” rule, scoped to `focus.on === "call"`.
- **Drill.** A call drill asks a different question (“Hold, cut or take?”) from 03's scored “How well did this meet the setup?”. Keep call drills out of 03's scored kind deck. They belong to docs/25's `DC-7` drill cards, which can draw from call-focused examples as well as raw calls (`OD-DP-14`; deck rules are `DC-7`'s to define).
- **Gallery filter.** 03's Examples list adds **Teaches a call** next to All / A+ / Near-Miss / Anti-Example, with a kind sub-filter. The header gains `focus_kind: "entry" | CallKind` so the list reads headers only (B-42, 03's list rule).

### 4.5 Grades for stats without loading bars in lists

Stats over many calls need a grade per call. Grades need candles, and list views never load bars (guardrail 9). Proposal: an IndexedDB **grade cache** `mogmine-call-grades-v1` keyed by `[call_id, candle_signature, GRADER_VERSION]`, filled whenever a trade's candles are loaded (Trade Detail, review card, the daily archive pass) and read by stats. It is a cache, not a record: wiping it loses nothing, and stats show “14 calls not yet graded — open them to grade” instead of guessing. This keeps docs/25's “grades are derived, never stored” true in spirit while making the leaderboard usable (`OD-DP-11`).

---

## 5. Guardrails this design keeps

- **Guardrail 11 / B-62.** Fact lines (“40 ticks before your target”) and grades are code. A model may *suggest* a chip from free text or voice, shown as a suggestion that never overwrites (UX-33).
- **Guardrail 4.** Every deviation comparison is in integer ticks via `toTicks`. A trade with no stop gets no R, so stop-based facts don't fire.
- **UX-50.** Prompt text, chip labels and rule labels are frozen on the call. Discretionary rules are frozen on the trade at selection.
- **Invariant 7.** `user_id` on the library, prompts, calls, dismissals and answers.
- **B-01.** Nothing here touches an order. “Judgement call” rules are records, never automation.
- **Build every state (guardrail 12).** Library not yet hydrated (asks wait; the close sheet shows no ask rather than a wrong one). Write failure (“Not saved on this device”, as the playbook store does). A prompt retired while an ask is open (the ask finishes with its frozen text). A trade edited after an answer (§2.2). A playbook archived (its prompt settings are kept and read-only).

---

## 6. Build slices (fit into docs/25 §8)

| Slice | What | Needs |
| --- | --- | --- |
| `DC-1b` | Calls store chip ids with frozen labels (`FrozenReason`). `validateCall` takes the library. Seeds derived from `CALL_KINDS` with stable ids. Tests. **Must land before `DC-2`.** | `DC-1` |
| `DP-1` | Pure `detectDeviations` + `pendingAsks` with golden cases: cut, early take, scratch, hold, trail, widen/tighten, pre-R-10 null stop, tolerance edges, long and short, broker vs inferred basis. | `DC-1b` |
| `DP-2` | `mogmine-review-prompts-v1` store: hydrate, sanitize, seed merge, backup round-trip. | `DP-1` |
| `DC-2` (extended) | `mogmine-calls-v1` with `DiscretionCallV2` and dismissals. | `DC-1b` |
| `DP-3` | Ask in the close sheet and the review queue card. | `DP-2`, `DC-2` |
| `DP-4` | Tune → Review prompts editor. | `DP-2` |
| `DP-5` | Discretionary rule mode in the playbook editor, `discretion_rules` freeze in Pit Stop, the rule step in asks. | `DP-3`, `R-07b` |
| `DP-6` | Call filters and per-prompt / per-rule / per-reason stats, grade cache. | `DC-5`/`DC-6` |
| `DP-7` | Call-focused examples (03 slice 4 or later) and their decision view. | 03 slices 1–3 |

---

## 7. Integration delta against 03-unified-design-v2.md

What Codex should merge, section by section. Everything is additive. No 03 decision is reversed.

**Data contract (03 “Proposed data contract”)**

1. `PlaybookV2` gains `checklist_rules: PlaybookRuleV2[]` (optional `mode`, `covers`), `prompt_settings?: PlaybookPromptSettings` and `normal_quantity?: number`. All round-trip through the same sanitizer, draft, update and backup paths 03 names for `thesis`. Absent fields mean today's behaviour.
2. `ExampleExecution` gains optional `plan: { initial_stop_price, stop_at_exit_price, planned_target_price }`.
3. `PlaybookExampleSnapshot` gains optional `focus: { on: "entry" } | { on: "call"; call: ExampleCallRef }`. `PlaybookExampleHeader` gains `focus_kind: "entry" | CallKind` (default `"entry"`).
4. `ExampleRule` (via `PlaybookRuleV2`) carries `mode`. For judgement rules, `assessment` reads as applied well / misapplied.
5. New types (in a new `lib/prompts.ts`, not in 03's example module): `ReasonChip`, `DeviationKind`, `PromptTrigger`, `ReviewPrompt`, `PromptLibraryV1`, `Deviation`, `PendingAsk`, `FrozenDiscretionRule`, `PromptDismissal`, `PromptAnswer`, `CallFilter`.
6. `TradeRecord` gains optional `discretion_rules` and `normal_quantity_at_selection`.
7. `DiscretionCall` → `DiscretionCallV2` (docs/25 §7 changes: `reasons` become `FrozenReason[]`; adds `prompt_id`, `prompt_question`, `origin`, `trigger`, `rule`, `made_at_basis`).

**Storage**

8. New localStorage key `mogmine-review-prompts-v1`. `mogmine-calls-v1` holds `{ calls, dismissals }`. New IndexedDB cache `mogmine-call-grades-v1` (derived). Journal backup gains `prompt_library` and `calls`. The example backup (03 “Recover”) carries `focus` and `plan` unchanged.

**Flows**

9. **Capture (03 Flow A):** a second entry point, **Save as Playbook Example** on a call. `decision_time` defaults to the call's `made_at`. Calls with a `bound` time can't be a focus.
10. **Decision view (03 “Decision cutoff”):** for `focus.on === "call"`, entry, working stop and target are decision-side and visible before the answer. Exit, grade and reasons stay sealed.
11. **Train (03):** call-focused examples are excluded from the scored kind deck. They feed docs/25 `DC-7` instead.
12. **Playbook detail (03):** the Examples filter gains **Teaches a call**. The hub's stats block gains per-kind discretion rows and a per-judgement-rule row (with 03's ten-observation minimum).
13. **Tune:** a new **Review prompts** card. `PlaybookEditor` gains the rule mode switch, the “Review questions” disclosure and an optional Normal size.
14. **Thin releases (03 table):** `DP-7` slots in after 03 slice 4 (“Annotate the rule”). It shares slice 4's rubric work.

**Owner decisions to add to 03's table** (recommended default in brackets)

| ID | Decision | Recommended default |
| --- | --- | --- |
| `OD-DP-01` | Reflection prompts (no kind, not graded) alongside call prompts? | **Calls only for now.** Add reflections when the first non-departure question is wanted. |
| `OD-DP-02` | Moved stops: a variant of **Stop here** or a new eighth kind? | **Stop here variant** with `stop_widened` / `stop_tightened` triggers. Revisit when broker stop paths give move times. |
| `OD-DP-03` | Discretionary rules: share the 12-rule list with a mode flag, frozen into a separate `discretion_rules` trade field, outside adherence? | **Yes.** |
| `OD-DP-04` | Does an applied judgement rule count as “followed the playbook” for adherence or Clean Run (docs/17)? | **No effect in v1.** Discretion stats only. |
| `OD-DP-05` | Which prompts ask on every trade? | **Only “Why is the stop here?”, on trades with a stop.** Everything else on departure. |
| `OD-DP-06` | Most asks shown per trade before collapsing? | **3.** |
| `OD-DP-07` | Tolerance for “at the plan”, and is a scratch exit a Cut? | **1 tick. Yes**, a scratch counts as a cut. |
| `OD-DP-08` | Where “normal size” comes from for the Size trigger | **Optional per-playbook `normal_quantity`**. Size stays manual until it is set. |
| `OD-DP-09` | Seed upgrades | **Append missing seeds. Never overwrite edits.** Per-prompt “Reset to default”. |
| `OD-DP-10` | Chip rename | **Past calls keep their frozen label. Stats and filters group by id under the current label.** |
| `OD-DP-11` | Grade cache for stats | **IndexedDB derived cache**, rebuildable, with “not yet graded” counts shown. |
| `OD-DP-12` | Can a prompt's kind change after it has answers? | **No.** Duplicate instead. |
| `OD-DP-13` | Where the library lives | **Tune card under Playbooks**, moving to `/tune/prompts` if it outgrows a card. |
| `OD-DP-14` | Call-focused examples and their decision view (entry visible before the answer) | **Allow**, after 03 slice 4. Drills stay with `DC-7`. |
