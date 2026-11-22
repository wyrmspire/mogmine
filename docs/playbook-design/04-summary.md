# 04 — Discretionary prompts × playbooks: summary

Full note: [04-discretionary-prompts-integration.md](04-discretionary-prompts-integration.md). It adds to [03](03-unified-design-v2.md) and [docs/25](../25-discretionary-calls.md) and changes nothing they decided.

**Model.** There are three layers. The seven **kinds** stay a closed list in code, because grading depends on them. **Prompts** become an owner-edited library in `mogmine-review-prompts-v1`: a question with reason chips that keep stable ids, a trigger, and a scope. The library is seeded from `CALL_KINDS`. **Playbooks** choose which prompts to ask and can hold **judgement-call rules**. **Calls** are the answers. Each one freezes the question, chip labels and rule label it was answered with, the same way a trade freezes its checklist (UX-50). One change is needed before the calls store (`DC-2`) ships: calls must store chip ids plus frozen labels instead of bare labels (new slice `DC-1b`). Otherwise renaming a chip makes old calls invalid.

**Triggers.** A pure `detectDeviations(trade)` works in integer ticks on the trade fields that already exist (exit vs stop and target, `initial_stop_price` vs `stop_loss_price`). It is upgraded by the trade document's `exit_reason` and `stop_path` when those exist. It finds six departures: leaving before the target (at a loss or in profit), holding past it, widening or tightening the stop, an off-normal size, going against the signal, and skipping a planned setup. `pendingAsks()` maps departures to prompts: one per kind, at most 3 per trade, and none when a call made during the session already answers it. A playbook rule switched to **Judgement call** (for example “Exit early if momentum stalls”) names the departures it covers. When one happens, the question opens with “Your rule: … Is that why?” (yes, the rule / no, another reason) before the reason chips. That splits allowed departures from improvised ones. Judgement rules are frozen in a new `discretion_rules` field on the trade, so adherence and Clean Run don't change. Questions appear in the close sheet (the honest, in-the-moment answer), the review card, Trade Detail and the after-session ledger.

**Settings.** A new **Tune → Review prompts** card under Playbooks, built like `PlaybookEditor`. Prompts are grouped by kind and reordered with ↑/↓. The owner edits each question, when it fires (on a departure / every trade / only from the call sheet) and which playbooks ask it. Chips can be renamed, reordered and retired; a used chip is retired, never deleted. Prompts retire with Undo, seeded ones have “Reset to default”, and new seeds are appended without overwriting edits. In the playbook editor, each rule gets a Checkbox / Judgement call switch, and each playbook gets a “Review questions” list of prompts it can turn on or off.

**Filters and links.** Answers are coded at four levels: kind → rule applied or not → reason chip id → chip family, with free text kept searchable. One `CallFilter` drives the feed, stats and the assistant API, and tapping any chip opens the matching trades. Stats are shown per playbook, per judgement rule (does the rule pay better than improvising?), per prompt (fired / answered / “not a call”) and per reason. A derived IndexedDB grade cache means lists never load bars. A playbook example can **teach a call**: `focus: { on: "call" }` with a frozen `ExampleCallRef`. Its decision cutoff is the moment of the call, and the entry stays visible in the decision view. Call drills go to `DC-7`, not 03's scored deck.

**Owner decisions (recommended default):**
- **OD-DP-01** Reflection prompts (no kind, ungraded)? → calls only for now.
- **OD-DP-02** Moved stop: Stop here variant or an eighth kind? → Stop here variant.
- **OD-DP-03** Judgement rules share the 12-rule list and freeze into `discretion_rules`, outside adherence? → yes.
- **OD-DP-04** Does an applied judgement rule count as “followed” for adherence or Clean Run? → no, in v1.
- **OD-DP-05** Every-trade prompts → only “Why is the stop here?” on trades with a stop.
- **OD-DP-06** Most questions per trade before the rest collapse → 3.
- **OD-DP-07** “At the plan” tolerance; is a scratch exit a Cut? → 1 tick; yes.
- **OD-DP-08** Source of “normal size” → optional per-playbook `normal_quantity`.
- **OD-DP-09** Seed upgrades → add missing seeds at the end, never overwrite edits.
- **OD-DP-10** Chip rename → past calls keep their frozen label; stats group by id.
- **OD-DP-11** Grade cache for stats → derived IndexedDB cache, rebuildable.
- **OD-DP-12** Change a prompt's kind after it has answers? → no; duplicate it instead.
- **OD-DP-13** Where the library lives → Tune card, moving to `/tune/prompts` if it grows.
- **OD-DP-14** Call-focused examples, with the entry visible before the answer → allow, after 03 slice 4.
