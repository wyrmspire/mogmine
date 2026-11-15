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
    entry_price: 7528, exit_price: 7519.25, stop_loss_price: 7519.25,
    planned_target_price: 7532.5, key_level_price: 7523.25,
    playbook_id: "orb-reclaim", quick_tags: ["Opening Drive", "A+ Patience"], followed: 4,
    note: "The opening pullback did not hold after the reclaim. The planned stop was the first level touched.",
  }),
  makeTrade({
    id: "mnq-trend-hold", symbol: "MNQ", direction: "SHORT", quantity: 1,
    entry_time: "2026-11-12T16:12:00.000Z", exit_time: "2026-11-12T17:22:00.000Z",
    entry_price: 28616.5, exit_price: 28433.5, stop_loss_price: 28652.5,
    planned_target_price: 28433.5, key_level_price: 28582.5,
    playbook_id: "vwap-trend-push", quick_tags: ["Pushed w/ NQ", "A+ Patience"], followed: 4,
    note: "Failed reclaim after the morning breakdown. Lower highs stayed intact until the planned target traded.",
  }),
  makeTrade({
    id: "mes-failed-reclaim", symbol: "MES", direction: "LONG", quantity: 2,
    entry_time: "2026-11-13T15:51:00.000Z", exit_time: "2026-11-13T16:05:00.000Z",
    entry_price: 7555, exit_price: 7528.5, stop_loss_price: 7528.5,
    planned_target_price: 7558.5, key_level_price: 7559.5,
    playbook_id: "orb-reclaim", quick_tags: ["Chased Entry"], followed: 2,
    note: "Bought a reclaim before it was confirmed while volume was fading. The level never held; the planned stop was the first level touched.",
  }),
  makeTrade({
    id: "mes-orb-fakeout", symbol: "MES", direction: "SHORT", quantity: 2,
    entry_time: "2026-11-13T15:34:00.000Z", exit_time: "2026-11-13T15:36:00.000Z",
    entry_price: 7545.25, exit_price: 7533.25, stop_loss_price: 7555,
    planned_target_price: 7533.25, key_level_price: 7544,
    note: "The opening-range break failed and price slipped back below the level into the planned target.",
  }),
  makeTrade({
    id: "mnq-vwap-reclaim", symbol: "MNQ", direction: "LONG", quantity: 1,
    entry_time: "2026-11-12T15:47:00.000Z", exit_time: "2026-11-12T16:19:00.000Z",
    entry_price: 28338.5, exit_price: 28639, stop_loss_price: 28312.75,
    planned_target_price: 28639, key_level_price: 28342.5,
    playbook_id: "vwap-trend-push", quick_tags: ["VWAP Hold"], followed: 4,
    note: "VWAP reclaimed after the flush and held on the retest until the planned target traded.",
  }),
  makeTrade({
    id: "mes-lunch-chop", symbol: "MES", direction: "LONG", quantity: 2,
    entry_time: "2026-11-11T17:18:00.000Z", exit_time: "2026-11-11T17:42:00.000Z",
    entry_price: 7650.5, exit_price: 7660.25, stop_loss_price: 7649,
    planned_target_price: 7660.25, key_level_price: 7650.75,
    note: "",
  }),
  makeTrade({
    id: "mnq-breakdown-scalp", symbol: "MNQ", direction: "SHORT", quantity: 1,
    entry_time: "2026-11-11T16:03:00.000Z", exit_time: "2026-11-11T16:08:00.000Z",
    entry_price: 28527.5, exit_price: 28470, stop_loss_price: 28534.5,
    planned_target_price: 28470, key_level_price: 28515.5,
    note: "",
  }),
  makeTrade({
    id: "mes-premarket-reversal", symbol: "MES", direction: "LONG", quantity: 2,
    entry_time: "2026-11-10T14:51:00.000Z", exit_time: "2026-11-10T15:45:00.000Z",
    entry_price: 7526, exit_price: 7519.25, stop_loss_price: 7519.25,
    planned_target_price: 7566.5, key_level_price: 7524.5,
    playbook_id: "onl-sweep-smt", quick_tags: ["Level Sweep", "SMT Divergence"], followed: 3,
    note: "The premarket low reclaimed, but the move failed later and the planned stop was the first level touched.",
  }),
  makeTrade({
    id: "mnq-late-chase", symbol: "MNQ", direction: "LONG", quantity: 1,
    entry_time: "2026-11-09T16:26:00.000Z", exit_time: "2026-11-09T16:36:00.000Z",
    entry_price: 27875.25, exit_price: 27820, stop_loss_price: 27820,
    planned_target_price: 27887, key_level_price: 27867.25,
    playbook_id: "no-setup", quick_tags: ["Chased Entry", "Revenge"],
    note: "Chased the third push after the clean entry was gone. The pullback was normal, but my location made it unmanageable. Next time: let it go.",
  }),
  makeTrade({
    id: "mes-afternoon-hold", symbol: "MES", direction: "SHORT", quantity: 2,
    entry_time: "2026-11-09T18:22:00.000Z", exit_time: "2026-11-09T19:42:00.000Z",
    entry_price: 7566.5, exit_price: 7598, stop_loss_price: 7598,
    planned_target_price: 7561.75, key_level_price: 7563.75,
    note: "The afternoon short did not hold below the balance. The planned stop was the first level touched.",
  }),
];

export const DEMO_TRADE_IDS = new Set(demoTrades.map((trade) => trade.id));
