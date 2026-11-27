// Validated starter MES recipe templates for Strategy Lab using only registered skills in `lib/strategy-lab/registry.ts`.
import { validateRecipe } from "./recipe.ts";
import { saveRecipe, type RecipeStore } from "./recipes-store.ts";
import { SKILLS, type SkillRegistry } from "./registry.ts";
import type { Recipe } from "./types.ts";

const RAW_STARTERS: readonly Omit<Recipe, "playbookId">[] = [
  {
    schema: "mogmine.strategy-recipe.v1",
    id: "starter-mes-rth-vwap-reclaim",
    version: 1,
    name: "MES RTH VWAP Reclaim (Starter)",
    notes: "Starter template: RTH morning reclaim of session VWAP with 1m confirmation and RVOL >= 1.2.",
    symbol: "MES",
    side: "long",
    window: { startEt: "09:35", endEt: "11:30", days: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
    trigger: {
      all: [
        { skill: "vwapRelation", params: { anchor: "rth", farTicks: 12 }, out: "event", op: "==", value: "reclaim" },
        { skill: "confirm1m", params: { lookbackBars: 15, side: "long" }, out: "reclaim", op: "==", value: true },
        { skill: "rvol", params: { windowMinutes: 5, sessions: 10, minSessions: 5 }, out: "rvol", op: ">=", value: 1.2 },
      ],
    },
    entry: { at: "trigger-close" },
    stop: { type: "beyond-swing", ticks: 2, lookbackBars: 15, maxPoints: 8 },
    target: { type: "rr", multiple: 2 },
    maxHoldMinutes: 60,
    flatAtEt: "16:59",
    sizing: { mode: "risk-r", riskR: 0.25 },
    account: { accountId: null },
    slippageTicks: { stop: 1, market: 1 },
    dedupe: { maxPerSession: 2, cooldownMinutes: 20, oneAtATime: true },
    sliceBy: [
      { skill: "openingRange", params: { minutes: 15 }, out: "widthBucket" },
      { skill: "rangeRegime", out: "regime" },
      { skill: "emaRelation", params: { minutes: 5 }, out: "side200" },
      { skill: "deltaProxy", params: { method: "clv", bars: 10 }, out: "sign" },
      { skill: "sessionClock", out: "todBucket" },
    ],
    measure: { levelReach: ["pdh", "onh", "or_high"], forwardMinutes: [15, 30, 60] },
  },
  {
    schema: "mogmine.strategy-recipe.v1",
    id: "starter-mes-or-failed-break-short",
    version: 1,
    name: "MES OR Failed Breakup (Starter)",
    notes: "Starter template: fade a failed break above the 15m opening range back toward RTH VWAP.",
    symbol: "MES",
    side: "short",
    window: { startEt: "09:46", endEt: "11:30", days: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
    trigger: {
      all: [
        { skill: "openingRange", params: { minutes: 15, failBars: 5 }, out: "failedBreakUp", op: "==", value: true },
        { skill: "confirm1m", params: { lookbackBars: 15, side: "short" }, out: "reclaim", op: "==", value: true },
      ],
    },
    entry: { at: "trigger-close" },
    stop: { type: "beyond-swing", ticks: 2, lookbackBars: 15, maxPoints: 8 },
    target: { type: "level", level: "vwap_rth", fallbackPoints: 6 },
    maxHoldMinutes: 60,
    flatAtEt: "16:59",
    sizing: { mode: "risk-r", riskR: 0.25 },
    account: { accountId: null },
    slippageTicks: { stop: 1, market: 1 },
    dedupe: { maxPerSession: 2, cooldownMinutes: 20, oneAtATime: true },
    sliceBy: [
      { skill: "openingRange", params: { minutes: 15 }, out: "widthBucket" },
      { skill: "vwapRelation", params: { anchor: "rth" }, out: "side" },
      { skill: "rvol", params: { windowMinutes: 5, sessions: 10 }, out: "rvolBucket" },
      { skill: "rangeRegime", out: "regime" },
      { skill: "sessionClock", out: "todBucket" },
    ],
    measure: { levelReach: ["vwap_rth", "or_low", "pdl"], forwardMinutes: [15, 30, 60] },
  },
];

export function buildStarterRecipes(playbookId: string | null = null, registry: SkillRegistry = SKILLS): Recipe[] {
  const out: Recipe[] = [];
  for (const raw of RAW_STARTERS) {
    const checked = validateRecipe({ ...raw, playbookId }, registry);
    if (checked.ok) out.push(checked.recipe);
  }
  return out;
}

export function loadStarterRecipesIntoStore(
  store: RecipeStore,
  playbookId: string | null = null,
  registry: SkillRegistry = SKILLS,
): { store: RecipeStore; added: Recipe[] } {
  let next = store;
  const added: Recipe[] = [];
  for (const starter of buildStarterRecipes(playbookId, registry)) {
    const res = saveRecipe(next, starter, { newVersion: false }, registry);
    if (res.ok) {
      next = res.store;
      added.push(res.recipe);
    }
  }
  return { store: next, added };
}
