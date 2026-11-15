import { normalizeTrade } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";
import { checklistFor } from "./playbooks.ts";

type SeedTrade = Pick<TradeRecord, "id" | "symbol" | "direction" | "quantity" | "entry_time" | "exit_time" | "entry_price" | "exit_price" | "stop_loss_price" | "planned_target_price" | "key_level_price" | "note">
  & { playbook_id?: string; quick_tags?: string[]; followed?: number };

function makeTrade({ followed, ...seed }: SeedTrade): TradeRecord {
  const checklist = checklistFor(seed.playbook_id ?? null).map((item, index) => ({ ...item, checked: index < (followed ?? 0) }));
  return normalizeTrade({ ...seed, is_sample: true, checklist_state: checklist });
}

/** Short chip on sample rows. Not a broker-confirmed fill. */
export const SAMPLE_CHIP = "SCENARIO";
/** One-line provenance shown on the trade detail, not on the chart. */
export const SAMPLE_CAPTION = "Historical market-based scenario — not a broker-confirmed fill.";

/**
 * Sample trades are historical market-based scenarios, not executed fills. Each plan (stop,
 * target, size) was fixed at entry from structure, independent of the outcome: about $250 risk,
 * targets 1.5R to 3R. The outcome was then found by walking real Yahoo 1m bars (MES=F / MNQ=F)
 * from the entry bar's open: stop touched first -> exit at the stop, target first -> exit at the
 * target, otherwise a manual exit at a bar close. A 1m bar touching a level shows that the price
 * traded there; it does not prove a particular order would have filled. The bars are in
 * fixtures/sample-bars.json and a test checks every sample against them.
 */
export const demoTrades: TradeRecord[] = [
  makeTrade({
    id: "mes-opening-scalp", symbol: "MES", direction: "LONG", quantity: 8,
    entry_time: "2026-11-10T15:58:00.000Z", exit_time: "2026-11-10T16:05:59.000Z",
    entry_price: 7517.5, exit_price: 7517.5, stop_loss_price: 7511.5,
    planned_target_price: 7529.5, key_level_price: 7515.5,
    playbook_id: "orb-reclaim", quick_tags: ["Opening Drive", "A+ Patience"], followed: 4,
    note: "Bought the pullback after the opening reclaim with a 6-point stop under the level and a 2R target. It stalled at entry for eight minutes, so I flattened at my price instead of waiting for the stop.",
  }),
  makeTrade({
    id: "mnq-trend-hold", symbol: "MNQ", direction: "SHORT", quantity: 2,
    entry_time: "2026-11-12T16:12:00.000Z", exit_time: "2026-11-12T17:21:30.000Z",
    entry_price: 28622.25, exit_price: 28442.25, stop_loss_price: 28682.25,
    planned_target_price: 28442.25, key_level_price: 28640.25,
    playbook_id: "vwap-trend-push", quick_tags: ["Pushed w/ NQ", "A+ Patience"], followed: 4,
    note: "Shorted the failed reclaim with the stop above the morning lower high and a 3R target at the next level down. Held through two pullbacks and let the target fill.",
  }),
  makeTrade({
    id: "mes-failed-reclaim", symbol: "MES", direction: "LONG", quantity: 10,
    entry_time: "2026-11-13T15:51:00.000Z", exit_time: "2026-11-13T15:54:30.000Z",
    entry_price: 7550.75, exit_price: 7545.75, stop_loss_price: 7545.75,
    planned_target_price: 7560.75, key_level_price: 7548.75,
    playbook_id: "orb-reclaim", quick_tags: ["Chased Entry"], followed: 2,
    note: "Bought the reclaim before it was confirmed while volume was fading. 5-point stop under the level, 2R target. The level never held and the stop filled inside four minutes.",
  }),
  makeTrade({
    id: "mes-orb-fakeout", symbol: "MES", direction: "SHORT", quantity: 4,
    entry_time: "2026-11-13T15:34:00.000Z", exit_time: "2026-11-13T16:05:30.000Z",
    entry_price: 7554.25, exit_price: 7530.25, stop_loss_price: 7566.25,
    planned_target_price: 7530.25, key_level_price: 7558.25,
    note: "Faded the opening-range break once it slipped back under the high. 12-point stop above the high, 2R target at the opening low. Took half an hour to get there.",
  }),
  makeTrade({
    id: "mnq-vwap-reclaim", symbol: "MNQ", direction: "LONG", quantity: 2,
    entry_time: "2026-11-12T15:47:00.000Z", exit_time: "2026-11-12T15:57:30.000Z",
    entry_price: 28356.5, exit_price: 28476.5, stop_loss_price: 28296.5,
    planned_target_price: 28476.5, key_level_price: 28338.5,
    playbook_id: "vwap-trend-push", quick_tags: ["VWAP Hold"], followed: 4,
    note: "VWAP reclaimed after the flush and held on the retest. 60-point stop under the flush low, 2R target, filled in ten minutes.",
  }),
  makeTrade({
    id: "mes-lunch-chop", symbol: "MES", direction: "LONG", quantity: 5,
    entry_time: "2026-11-11T17:18:00.000Z", exit_time: "2026-11-11T18:27:59.000Z",
    entry_price: 7649.25, exit_price: 7667.25, stop_loss_price: 7639.25,
    planned_target_price: 7679.25, key_level_price: 7646.25,
    note: "Long into lunch with a 10-point stop and a 3R target. It ran to about 2R, then stalled under the high, so I took it off manually short of the target.",
  }),
  makeTrade({
    id: "mnq-breakdown-scalp", symbol: "MNQ", direction: "SHORT", quantity: 5,
    entry_time: "2026-11-11T16:03:00.000Z", exit_time: "2026-11-11T16:08:30.000Z",
    entry_price: 28518.25, exit_price: 28480.75, stop_loss_price: 28543.25,
    planned_target_price: 28480.75, key_level_price: 28526.25,
    note: "Short the breakdown retest with a 25-point stop above the retest high and a 1.5R target. Target filled in five minutes.",
  }),
  makeTrade({
    id: "mes-premarket-reversal", symbol: "MES", direction: "LONG", quantity: 5,
    entry_time: "2026-11-10T14:51:00.000Z", exit_time: "2026-11-10T14:58:30.000Z",
    entry_price: 7524.5, exit_price: 7544.5, stop_loss_price: 7514.5,
    planned_target_price: 7544.5, key_level_price: 7521.5,
    playbook_id: "onl-sweep-smt", quick_tags: ["Level Sweep", "SMT Divergence"], followed: 3,
    note: "The premarket low swept and reclaimed with SMT against NQ. 10-point stop under the sweep, 2R target at the overnight high. Filled in under ten minutes.",
  }),
  makeTrade({
    id: "mnq-late-chase", symbol: "MNQ", direction: "LONG", quantity: 5,
    entry_time: "2026-11-09T16:26:00.000Z", exit_time: "2026-11-09T16:28:30.000Z",
    entry_price: 27883.75, exit_price: 27858.75, stop_loss_price: 27858.75,
    planned_target_price: 27933.75, key_level_price: 27875.75,
    playbook_id: "no-setup", quick_tags: ["Chased Entry", "Revenge"],
    note: "Chased the third push after the clean entry was gone. Normal 25-point stop and 2R target, but my location was bad and the first pullback took the stop. Next time: let it go.",
  }),
  makeTrade({
    id: "mes-afternoon-hold", symbol: "MES", direction: "SHORT", quantity: 4,
    entry_time: "2026-11-09T18:22:00.000Z", exit_time: "2026-11-09T18:48:30.000Z",
    entry_price: 7567.25, exit_price: 7579.25, stop_loss_price: 7579.25,
    planned_target_price: 7543.25, key_level_price: 7571.25,
    note: "Shorted under the afternoon balance with a 12-point stop above it and a 2R target. Price never got going lower and the stop filled after about 25 minutes.",
  }),
];

export const DEMO_TRADE_IDS = new Set(demoTrades.map((trade) => trade.id));
