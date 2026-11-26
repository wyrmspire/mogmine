import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import type { ResolvedRSize } from "../r-size.ts";

const require = createRequire(import.meta.url);
const { createJiti } = require("jiti");
const jiti = createJiti(fileURLToPath(import.meta.url), { jsx: true });

const { buildPartialsCardView } = jiti("../../components/PartialsCard.tsx") as typeof import("../../components/PartialsCard.tsx");

const ZONE = "America/New_York";
const RSIZE_300: ResolvedRSize = { cents: 30_000, source: "prefs", account_id: null };

// Fixture 7: 2 MES LONG at 7600, stop 7595, T1 7605 x1, T2 7612.50 x1, exits at 7605 and 7612.50.
function fixtureSevenTrade(): TradeRecord {
  return normalizeTrade({
    id: "partials-card-7",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-12T15:34:00Z",
    exit_time: "2026-11-12T16:05:00Z",
    entry_price: 7600,
    exit_price: 7612.5,
    initial_stop_price: 7595,
    stop_loss_price: 7595,
    quantity: 2,
    partial_targets: [
      { key: "t1", price: 7605, qty: 1 },
      { key: "t2", price: 7612.5, qty: 1 },
    ],
    partial_exits: [
      { time: "2026-11-12T15:42:00Z", price: 7605, qty: 1, reason: "target", targetKey: "t1" },
      { time: "2026-11-12T16:05:00Z", price: 7612.5, qty: 1, reason: "target", targetKey: "t2" },
    ],
  });
}

test("buildPartialsCardView returns null for an ordinary single-exit trade", () => {
  const trade = normalizeTrade({
    id: "partials-card-plain",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-12T15:34:00Z",
    exit_time: "2026-11-12T16:05:00Z",
    entry_price: 7600,
    exit_price: 7605,
    initial_stop_price: 7595,
    stop_loss_price: 7595,
    quantity: 1,
  });
  assert.equal(buildPartialsCardView(trade, RSIZE_300, false, ZONE), null);
});

test("buildPartialsCardView formats Fixture 7 averages, targets, account R and risk multiple", () => {
  const view = buildPartialsCardView(fixtureSevenTrade(), RSIZE_300, false, ZONE);
  assert.ok(view);
  assert.equal(view.status, "Closed");
  assert.equal(view.avgEntry, "7600.00");
  assert.equal(view.avgExit, "7608.75");
  assert.equal(view.resultLabel, "Result");
  assert.equal(view.result, "+0.29R"); // $87.50 / $300
  assert.equal(view.riskMultiple, "1.75× risk"); // 70 ticks / (20 ticks x 2 contracts)

  assert.deepEqual(view.targets.map((t) => [t.key, t.price, t.rewardRisk, t.qty]), [
    ["T1", "7605.00", "1.0×", "1×"],
    ["T2", "7612.50", "2.5×", "1×"],
  ]);
  assert.equal(view.exits.length, 2);
  assert.equal(view.exits[0].price, "7605.00");
  assert.equal(view.exits[0].reason, "Target");
  assert.equal(view.exits[0].points, "+5.00 pts");
  assert.equal(view.exits[1].points, "+12.50 pts");
});

test("buildPartialsCardView under Shield exposes no dollars and no contract quantities", () => {
  const view = buildPartialsCardView(fixtureSevenTrade(), RSIZE_300, true, ZONE);
  assert.ok(view);
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("$"), false, "no dollar figures under Shield");
  for (const token of ["1×", "2×", "ct", "contracts"]) {
    assert.equal(serialized.includes(token), false, `no "${token}" under Shield`);
  }
  // Account R, price, R:R and points stay visible under Shield.
  assert.equal(view.result, "+0.29R");
  assert.equal(view.targets[1].rewardRisk, "2.5×");
});

test("TradeDetail: R ruler gate and account-R options are wired", () => {
  const source = readFileSync(join(process.cwd(), "components/TradeDetail.tsx"), "utf8");
  assert.ok(source.includes('showRuler: detailLevel === "high"'), "ruler only in high detail");
  assert.ok(source.includes("calculateExitEfficiency(trade, mfe, { accounts: accountsState.accounts, prefs })"));
  assert.ok(source.includes("derivePlanVsActual(trade, { accounts: accountsState.accounts, prefs })"));
  assert.ok(source.includes("<PartialsCard trade={trade} rSize={rSize} shield={prefs.shield} zone={zone} />"));
});
