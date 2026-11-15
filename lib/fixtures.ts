import { normalizeTrade } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";
import { checklistFor } from "./playbooks.ts";

type SeedTrade = Pick<TradeRecord, "id" | "symbol" | "direction" | "quantity" | "entry_time" | "exit_time" | "entry_price" | "exit_price" | "stop_loss_price" | "planned_target_price" | "key_level_price" | "note">
  & { playbook_id?: string; quick_tags?: string[]; followed?: number };

function makeTrade({ followed, ...seed }: SeedTrade): TradeRecord {
  const checklist = checklistFor(seed.playbook_id ?? null).map((item, index) => ({ ...item, checked: index < (followed ?? 0) }));
  return normalizeTrade({ ...seed, is_sample: true, checklist_state: checklist });
}

export const demoTrades: TradeRecord[] = [
  makeTrade({
    id: "mes-opening-scalp", symbol: "MES", direction: "LONG", quantity: 2,
    entry_time: "2026-11-10T15:43:00.000Z", exit_time: "2026-11-10T15:45:00.000Z",
    entry_price: 6844.25, exit_price: 6849, stop_loss_price: 6841.25,
    planned_target_price: 6850.25, key_level_price: 6839.5,
    playbook_id: "orb-reclaim", quick_tags: ["Opening Drive", "A+ Patience"], followed: 4,
    note: "Opening pullback held above the first impulse. Took the reclaim with buyers stepping back in. Next time: enter on the candle close instead of anticipating it.",
  }),
  makeTrade({
    id: "mnq-trend-hold", symbol: "MNQ", direction: "SHORT", quantity: 1,
    entry_time: "2026-11-12T16:12:00.000Z", exit_time: "2026-11-12T17:42:00.000Z",
    entry_price: 25784, exit_price: 25714, stop_loss_price: 25811,
    planned_target_price: 25690, key_level_price: 25750,
    playbook_id: "vwap-trend-push", quick_tags: ["Pushed w/ NQ", "Cut Early"], followed: 4,
    note: "Failed reclaim after the morning breakdown. Held through two pullbacks because lower highs stayed intact. I managed the stop well but took profit before the planned target.",
  }),
  makeTrade({
    id: "mes-failed-reclaim", symbol: "MES", direction: "LONG", quantity: 2,
    entry_time: "2026-11-13T15:51:00.000Z", exit_time: "2026-11-13T16:08:00.000Z",
    entry_price: 6827.5, exit_price: 6822.25, stop_loss_price: 6821.5,
    planned_target_price: 6836.5, key_level_price: 6832,
    playbook_id: "orb-reclaim", quick_tags: ["Chased Entry"], followed: 2,
    note: "Bought a reclaim before it was confirmed while volume was fading. The level never held. Next time: wait for a close above 6832 and a successful retest.",
  }),
  makeTrade({
    id: "mes-orb-fakeout", symbol: "MES", direction: "SHORT", quantity: 2,
    entry_time: "2026-11-13T15:34:00.000Z", exit_time: "2026-11-13T15:41:00.000Z",
    entry_price: 6835.25, exit_price: 6830.5, stop_loss_price: 6838.5,
    planned_target_price: 6828.75, key_level_price: 6834,
    note: "The opening-range break failed and price slipped back below the level. Next time: keep the first target at the prior low instead of reaching for the full extension.",
  }),
  makeTrade({
    id: "mnq-vwap-reclaim", symbol: "MNQ", direction: "LONG", quantity: 1,
    entry_time: "2026-11-12T15:47:00.000Z", exit_time: "2026-11-12T16:19:00.000Z",
    entry_price: 25736, exit_price: 25782, stop_loss_price: 25716,
    planned_target_price: 25800, key_level_price: 25740,
    playbook_id: "vwap-trend-push", quick_tags: ["VWAP Hold"], followed: 4,
    note: "VWAP reclaimed after the flush and held on the retest. I followed the plan, but could have left a small runner after the first push.",
  }),
  makeTrade({
    id: "mes-lunch-chop", symbol: "MES", direction: "LONG", quantity: 2,
    entry_time: "2026-11-11T17:18:00.000Z", exit_time: "2026-11-11T17:42:00.000Z",
    entry_price: 6819.75, exit_price: 6817.5, stop_loss_price: null,
    planned_target_price: 6826, key_level_price: 6820,
    note: "",
  }),
  makeTrade({
    id: "mnq-breakdown-scalp", symbol: "MNQ", direction: "SHORT", quantity: 1,
    entry_time: "2026-11-11T16:03:00.000Z", exit_time: "2026-11-11T16:08:00.000Z",
    entry_price: 25692, exit_price: 25654, stop_loss_price: 25708,
    planned_target_price: 25648, key_level_price: 25680,
    note: "",
  }),
  makeTrade({
    id: "mes-premarket-reversal", symbol: "MES", direction: "LONG", quantity: 2,
    entry_time: "2026-11-10T14:51:00.000Z", exit_time: "2026-11-10T15:28:00.000Z",
    entry_price: 6831.5, exit_price: 6838.25, stop_loss_price: 6827.5,
    planned_target_price: 6841.5, key_level_price: 6830,
    playbook_id: "onl-sweep-smt", quick_tags: ["Level Sweep", "SMT Divergence"], followed: 3,
    note: "Premarket low swept and immediately reclaimed. I reduced into the first resistance and kept risk controlled through the open.",
  }),
  makeTrade({
    id: "mnq-late-chase", symbol: "MNQ", direction: "LONG", quantity: 1,
    entry_time: "2026-11-09T16:26:00.000Z", exit_time: "2026-11-09T16:39:00.000Z",
    entry_price: 25588, exit_price: 25561, stop_loss_price: 25558,
    planned_target_price: 25633, key_level_price: 25580,
    playbook_id: "no-setup", quick_tags: ["Chased Entry", "Revenge"],
    note: "Chased the third push after the clean entry was gone. The pullback was normal, but my location made it unmanageable. Next time: let it go.",
  }),
  makeTrade({
    id: "mes-afternoon-hold", symbol: "MES", direction: "SHORT", quantity: 2,
    entry_time: "2026-11-09T18:22:00.000Z", exit_time: "2026-11-09T19:44:00.000Z",
    entry_price: 6846.75, exit_price: 6836, stop_loss_price: 6852.25,
    planned_target_price: 6833.5, key_level_price: 6844,
    note: "Afternoon lower high held below the morning balance. Stayed patient through the pullback and covered near the session low.",
  }),
];

export const DEMO_TRADE_IDS = new Set(demoTrades.map((trade) => trade.id));
