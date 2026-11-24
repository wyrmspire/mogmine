// #API-1: the agent house rules and workflows, one pure source (docs/design-2026-11-24/07-agent-api.md §2). Pure data plus
// renderers: no Next, no SDK, no DOM, no journal text. The discovery document, the OpenAPI spec, the setup block and
// GET /api/v1/guide all read from here, so the rules cannot drift between them.

export const HOUSE_RULES_VERSION = "2026-11-24.1";

export interface HouseRule {
  id: `HR-${number}`;
  title: string;
  summary: string;
  rule: string;
  why: string;
  badExample: string;
  goodExample: string;
  appliesTo?: readonly ("trades" | "plans" | "daily_reviews" | "accounts" | "playbooks" | "all")[];
}

export interface AgentWorkflow {
  id: "log_trade" | "review_day" | "plan_session";
  title: string;
  steps: readonly string[];
}

export const HOUSE_RULES: readonly HouseRule[] = [
  {
    id: "HR-1",
    title: "Notes are commentary only",
    summary: "Notes hold reasoning, mistakes and lessons. Never restate prices, stop distance, risk, R or size.",
    rule:
      "`note`, `pre_trade_thesis`, `management_notes`, `post_exit_notes` and review points hold reasoning, mistakes, lessons and what to do differently. Never restate entry, stop, stop distance, target, exit price or time, risk dollars, R or size. Those fields already hold them.",
    why: "Notes repeated the stop, the risk and the entry that the record already stored, so the two copies could disagree.",
    badExample: "note: \"Entered at 5012.25 with a 12-point stop, risked $75 (0.25R). Should have waited.\"",
    goodExample: "note: \"Chased the first push instead of waiting for the retest. Next time wait for a close back above the level.\"",
    appliesTo: ["trades", "plans", "daily_reviews"],
  },
  {
    id: "HR-2",
    title: "Verify every stated time against 1-minute candles",
    summary: "Before saving, check each fill price traded in that minute's bar. If not, look ±5 minutes and propose the match.",
    rule:
      "Verify every stated time against the 1-minute candles before saving: the fill price must trade inside that minute's bar. If it does not, look up to 5 minutes either side and propose the matching minute to the trader. Use POST /api/v1/checks/trade for the check.",
    why: "An entry was placed on the next minute's bar, but the price printed one minute earlier, so the chart marker sat in the wrong place.",
    badExample: "entry_time: \"14:14\" with an entry price that only traded at 14:13",
    goodExample: "Check finds the price at 14:13 (shifted -1 min). Ask the trader, then store the confirmed time.",
    appliesTo: ["trades"],
  },
  {
    id: "HR-3",
    title: "Vocabulary names come from the vocabulary only",
    summary: "Playbook, setup and execution tags come from GET /api/v1/vocabulary. Never invent a name or leave one blank silently.",
    rule:
      "Playbook, setup tags and execution tags come from GET /api/v1/vocabulary only. Never invent a name. Ask the trader, or propose the best match and get a yes. Never leave them blank silently.",
    why: "Playbooks and setups were written with names that did not exist, and several trades had no setup at all.",
    badExample: "playbook: \"News Impulse\" (not in the vocabulary)",
    goodExample: "Read the vocabulary, propose the closest playbook, and store it only after the trader confirms.",
    appliesTo: ["trades", "plans", "playbooks"],
  },
  {
    id: "HR-4",
    title: "Record stop moves with times",
    summary: "Stop moves go in stop_moves as [{price, time}]. The first stop is initial_stop_price; the last is stop_loss_price.",
    rule:
      "Record stop moves with times in `stop_moves` as `[{price, time}]`. `initial_stop_price` is the first stop and `stop_loss_price` is the last. Never set `initial_stop_set_at` to stand in for a move time.",
    why: "A trailed stop was treated as live from the entry, which produced a false stop touch on the chart.",
    badExample: "stop_loss_price: 4998.00 with no stop_moves, after the stop was trailed up",
    goodExample: "initial_stop_price: 4990.00, stop_moves: [{price: 4996.00, time: \"2026-11-23T15:02:00Z\"}], stop_loss_price: 4996.00",
    appliesTo: ["trades"],
  },
  {
    id: "HR-5",
    title: "exit_reason must match the exit price",
    summary: "stop and trail exit at the working stop; target at the target; breakeven at the entry; manual at market.",
    rule:
      "`exit_reason` changes the chart. `stop` and `trail` mean the exit filled at the working stop; `target` means the target; `breakeven` means the entry; `manual` means market. Pick the reason that happened, and the exit price must agree with it.",
    why: "Exit reasons did not match the exit prices, so the chart drew the exit in the wrong place.",
    badExample: "exit_reason: \"target\" with exit_price equal to the stop",
    goodExample: "exit_reason: \"stop\" with exit_price equal to the working stop at the time of exit",
    appliesTo: ["trades"],
  },
  {
    id: "HR-6",
    title: "R is measured against the account's R size",
    summary: "R uses the account's R size (r_size_cents), not the stop width. Never write R; the app computes it.",
    rule:
      "R is measured against the account's R size, stored in dollars as `r_size_cents` on the account. It is never the stop width. Do not write R anywhere in notes or fields; the app computes `resultR` and `riskR` from the fills and the account's `r_size_cents`. Until `r_size_cents` is stored, do not write risk or R into notes.",
    why: "Risk was shown as 1R, measured against the stop width, instead of the fixed dollar R of the account.",
    badExample: "note: \"Risked 1R on a 12-point stop.\"",
    goodExample: "Store the dollars the trader risked in the account's terms; leave R out of the notes and let the app compute it.",
    appliesTo: ["trades", "accounts"],
  },
  {
    id: "HR-7",
    title: "Stated risk is kept as the trader said it",
    summary: "When the trader says .25R, write stated_risk_r: 0.25. Never replace it with stop math or move the stop to match.",
    rule:
      "Stated vs actual risk. When the trader says \".25R\", write `stated_risk_r: 0.25`. Never replace it with stop math, and never \"correct\" the stop to match it. The app shows both the stated and the actual risk.",
    why: "A stated sizing of a quarter R lived only in the notes, so the app never saw it.",
    badExample: "stated_risk_r omitted; note says \"sized to .25R\"",
    goodExample: "stated_risk_r: 0.25 and a note that says nothing about the R number",
    appliesTo: ["trades"],
  },
  {
    id: "HR-8",
    title: "Times are UTC ISO-8601; sessions roll at 17:00 Central",
    summary: "The API takes UTC ISO-8601. The trader speaks Central Time; the session date rolls at 17:00 CT (18:00 ET).",
    rule:
      "Times are UTC ISO-8601 in the API. The trader speaks Central Time (America/Chicago). The session date rolls at 17:00 CT (18:00 ET): an evening trade belongs to the next day's session.",
    why: "Evening trades were filed under the wrong session day because local times were stored without an offset.",
    badExample: "entry_time: \"2026-11-23 18:30\"",
    goodExample: "entry_time: \"2026-11-24T00:30:00Z\" (an evening Central trade that belongs to the next session day)",
    appliesTo: ["trades", "daily_reviews", "plans"],
  },
  {
    id: "HR-9",
    title: "Daily reviews go in daily_reviews",
    summary: "Daily reviews are stored in daily_reviews with explicit trade_ids, never in plans. Plans are pre-session checkpoints.",
    rule:
      "Daily reviews go in `daily_reviews` with explicit `trade_ids`, not in `plans`. Plans are pre-session checkpoints.",
    why: "A day's review was stored as a plan with a hand-patched anchor, so it never linked to the day's trades.",
    badExample: "POST /records/plans with the day's review text",
    goodExample: "POST /records/daily_reviews with trade_ids listing the day's trades",
    appliesTo: ["daily_reviews", "plans"],
  },
  {
    id: "HR-10",
    title: "Never write derived values",
    summary: "Never write net_pnl, r_multiple, hold_seconds, mae_price, mfe_price or risk_cents. Read them back, do not send them.",
    rule:
      "Never write derived values: `net_pnl`, `r_multiple`, `hold_seconds`, `mae_price`, `mfe_price`, `risk_cents`, `resultR` or `riskR`. The server computes them. Read them back from the record once the app returns them; until then, do not expect them in responses.",
    why: "Hand-typed derived values disagreed with the fills and the app's own math.",
    badExample: "{\"net_pnl\": 75, \"r_multiple\": 0.25}",
    goodExample: "{\"entry_price\": 5012.25, \"exit_price\": 5010.00} and let the app compute the PnL",
    appliesTo: ["trades", "daily_reviews"],
  },
  {
    id: "HR-11",
    title: "Read back after every write",
    summary: "After every write, GET the record, compare it with what you sent and report any difference to the trader.",
    rule:
      "Read back after every write: GET the record, compare it with what you sent, and report any difference to the trader.",
    why: "Writes were assumed to have saved exactly as sent, and differences were found only days later.",
    badExample: "POST the trade and report \"saved\" without a GET",
    goodExample: "POST the trade, GET it back, compare the fields, and report \"saved; stop matches; time shifted by one minute\"",
    appliesTo: ["all"],
  },
  {
    id: "HR-12",
    title: "Ask before deleting; archive instead",
    summary: "Accounts and playbooks are archived, never deleted. Ask the trader before any delete.",
    rule:
      "Ask before deleting. Accounts and playbooks archive; they are never deleted.",
    why: "A playbook was deleted while trades still pointed to it, which left those trades without a name.",
    badExample: "DELETE /records/playbooks/{id} to tidy up",
    goodExample: "POST /records/playbooks/{id}/archive after the trader agrees",
    appliesTo: ["accounts", "playbooks", "all"],
  },
];

export const AGENT_WORKFLOWS: readonly AgentWorkflow[] = [
  {
    id: "log_trade",
    title: "Log a trade",
    steps: [
      "GET the vocabulary (playbooks, setup tags, execution tags, accounts and their R sizes).",
      "Collect symbol, side, quantity, entry and exit prices and times (CT), initial stop, stop moves with times, target, exit reason, stated risk, and account.",
      "Propose the playbook and tags from the vocabulary and get a yes from the trader.",
      "POST /checks/trade with the draft. Resolve every shifted or outside time with the trader before saving.",
      "Create the trade with a client-generated id.",
      "GET the trade back and compare it with what you sent.",
      "Add notes last, as commentary only (HR-1).",
    ],
  },
  {
    id: "review_day",
    title: "Review a day",
    steps: [
      "List the day's trades with ?session_date=.",
      "Create a daily_reviews record with the explicit trade ids.",
      "Add review points, commentary only.",
      "GET the review back and compare it with what you sent.",
    ],
  },
  {
    id: "plan_session",
    title: "Plan a session",
    steps: [
      "Create a plan with its preset and anchor.",
      "Levels from GET /levels are computed by the app, so only add typed levels the trader states.",
      "GET the plan back and compare it with what you sent.",
    ],
  },
];

/** The rules as a markdown list, for `info.description` in the OpenAPI spec. One line per rule, plus the title. */
export function formatHouseRulesMarkdown(): string {
  const lines = HOUSE_RULES.map((rule) => `- **${rule.id} ${rule.title}.** ${rule.summary}`);
  return ["", "", `House rules (version ${HOUSE_RULES_VERSION}). Read them before writing anything:`, ...lines].join("\n");
}

/** The payload for GET /api/v1/guide: the full rules with examples, and the workflows. */
export function buildGuidePayload(origin: string): {
  version: string;
  vocabulary_url: string;
  rules: readonly HouseRule[];
  workflows: readonly AgentWorkflow[];
} {
  // Built here rather than imported from openapi.ts: openapi.ts imports this module, so importing back would be a cycle.
  return {
    version: HOUSE_RULES_VERSION,
    vocabulary_url: `${origin.replace(/\/+$/, "")}/api/v1/vocabulary`,
    rules: HOUSE_RULES,
    workflows: AGENT_WORKFLOWS,
  };
}
