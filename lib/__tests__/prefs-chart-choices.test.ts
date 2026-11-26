// IN-1: the four chart and review card choices persist through sanitize, setPrefs, hydration and the singleton
// command layer. Legacy stored prefs (without the new keys) fall back to the locked defaults (D-D, D-G, Q-5).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_PREFS, PREFS_KEY, getPrefs, hydratePrefs, resetPrefsForTests, sanitizePrefs, setPrefs } from "../prefs.ts";
import type { Prefs } from "../prefs.ts";
import { sanitize } from "../prefs-sanitize.ts";
import { createJournalCommands } from "../commands/journal-commands.ts";
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import { installDevice } from "./sync-test-helpers.ts";
import { createIndicatorInstance } from "../indicator-kit.ts";

const CHOICES = {
  vwapAnchor: "globex",
  vwapBands: true,
  vwapBandMultiples: [0.5, 1, 2],
  vwapBandFill: true,
  weeklyVwap: true,
  levelLabels: "always",
  ema200: true,
  reviewCardOrientation: "landscape",
  indicators: [createIndicatorInstance("ema", "ema-custom")],
} satisfies Partial<Prefs>;

const LEGACY = {
  shield: false,
  goldPreset: "amber",
  goldIntensity: 0.5,
  boxOpacity: 0.3,
  palette: "classic",
  showSamples: true,
  blindReview: false,
  riskBudgetUsd: 300,
};

let device: ReturnType<typeof installDevice> | null = null;

afterEach(() => {
  resetPrefsForTests();
  device?.uninstall();
  device = null;
});

test("defaults: empty and legacy prefs populate the locked defaults", () => {
  const expected = { vwapAnchor: "off", vwapBands: true, vwapBandMultiples: [1, 2], vwapBandFill: false, weeklyVwap: false, levelLabels: "tap", ema200: false, reviewCardOrientation: "portrait" };
  assert.equal(DEFAULT_PREFS.vwapAnchor, "off");
  assert.equal(DEFAULT_PREFS.levelLabels, "tap");
  assert.equal(DEFAULT_PREFS.ema200, false);
  assert.equal(DEFAULT_PREFS.reviewCardOrientation, "portrait");
  assert.deepEqual(DEFAULT_PREFS.indicators.map(({ instanceId }) => instanceId), ["session-levels-default", "vwap-session", "ema-200", "volume-default"]);
  assert.deepEqual(sanitizePrefs({}), DEFAULT_PREFS);
  assert.deepEqual(sanitizePrefs(LEGACY), { ...DEFAULT_PREFS, ...LEGACY, ...expected } as Prefs);
  assert.deepEqual(sanitizePrefs(null), DEFAULT_PREFS);
});

test("valid non-default choices survive sanitize", () => {
  assert.deepEqual(sanitizePrefs(CHOICES), { ...DEFAULT_PREFS, ...CHOICES } as Prefs);
  assert.equal(sanitizePrefs({ vwapAnchor: "rth" }).vwapAnchor, "rth");
  assert.equal(sanitize({ ...DEFAULT_PREFS, ...CHOICES }).reviewCardOrientation, "landscape");
  assert.equal(sanitizePrefs(CHOICES).indicators[0].instanceId, "ema-custom");
});

test("setPrefs stores the choices and getPrefs returns them", () => {
  resetPrefsForTests();
  setPrefs({ ...CHOICES });
  assert.equal(getPrefs().vwapAnchor, "globex");
  assert.deepEqual(getPrefs().vwapBandMultiples, [0.5, 1, 2]);
  assert.equal(getPrefs().weeklyVwap, true);
  assert.equal(getPrefs().levelLabels, "always");
  assert.equal(getPrefs().ema200, true);
  assert.equal(getPrefs().reviewCardOrientation, "landscape");
  assert.equal(getPrefs().indicators[0].instanceId, "ema-custom");
});

test("choices round-trip through localStorage hydration", () => {
  device = installDevice({ [PREFS_KEY]: JSON.stringify({ ...LEGACY, ...CHOICES }) });
  resetPrefsForTests();
  hydratePrefs();
  assert.equal(getPrefs().vwapAnchor, "globex");
  assert.equal(getPrefs().vwapBandFill, true);
  assert.equal(getPrefs().weeklyVwap, true);
  assert.equal(getPrefs().levelLabels, "always");
  assert.equal(getPrefs().ema200, true);
  assert.equal(getPrefs().reviewCardOrientation, "landscape");
  assert.equal(getPrefs().indicators[0].instanceId, "ema-custom");
});

test("choices round-trip through the singleton command layer", async () => {
  const adapter = createLocalAdapter({ kind: "local", store: createMemoryKeyValueStore(), candles: createMemoryCandleStore() });
  const commands = createJournalCommands(adapter.repositories);
  const result = await commands.writeSingleton("prefs", { ...LEGACY, ...CHOICES });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.record, { ...sanitizePrefs(LEGACY), ...CHOICES });
  const read = await adapter.repositories.prefs.get(DEFAULT_OWNER_USER_ID);
  assert.equal(read.ok && read.value?.record.vwapAnchor, "globex");
});

test("invalid values sanitize back to defaults", () => {
  const bad = sanitizePrefs({ vwapAnchor: "weekly", vwapBandMultiples: [0, -1, Infinity], levelLabels: "none", ema200: "yes", reviewCardOrientation: "square" } as unknown as Partial<Prefs>);
  assert.equal(bad.vwapAnchor, "off");
  assert.deepEqual(bad.vwapBandMultiples, [1, 2]);
  assert.equal(bad.levelLabels, "tap");
  assert.equal(bad.ema200, false);
  assert.equal(bad.reviewCardOrientation, "portrait");
});
