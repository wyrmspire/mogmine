import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFS, GOLD_PRESETS, getPrefs, getTuneRiskBudgetDisplay, setPrefs } from "../prefs.ts";
import { withSamples } from "../selectors.ts";
import { normalizeTrade } from "../trades.ts";

test("DEFAULT_PREFS defines documented default settings", () => {
  assert.equal(DEFAULT_PREFS.boxOpacity, 0.28);
  assert.equal(DEFAULT_PREFS.goldPreset, "bullion");
  assert.equal(DEFAULT_PREFS.goldIntensity, 0.76);
  assert.equal(DEFAULT_PREFS.palette, "classic");
  assert.equal(DEFAULT_PREFS.riskBudgetUsd, 250);
  assert.equal(DEFAULT_PREFS.showSamples, true);
  assert.equal(DEFAULT_PREFS.shield, false);
});

test("GOLD_PRESETS exports all four distinct gold presets", () => {
  assert.deepEqual(GOLD_PRESETS, ["bullion", "champagne", "amber", "platinum"]);
});

test("setPrefs sanitizes and clamps boxOpacity between 0.15 and 0.65 (Invariant 5)", () => {
  setPrefs({ boxOpacity: 0.10 });
  assert.equal(getPrefs().boxOpacity, 0.15);

  setPrefs({ boxOpacity: 0.85 });
  assert.equal(getPrefs().boxOpacity, 0.65);

  setPrefs({ boxOpacity: 0.45 });
  assert.equal(getPrefs().boxOpacity, 0.45);
});

test("setPrefs sanitizes and clamps goldIntensity between 0.0 and 1.0", () => {
  setPrefs({ goldIntensity: -0.2 });
  assert.equal(getPrefs().goldIntensity, 0);

  setPrefs({ goldIntensity: 1.5 });
  assert.equal(getPrefs().goldIntensity, 1);

  setPrefs({ goldIntensity: 0.5 });
  assert.equal(getPrefs().goldIntensity, 0.5);
});

test("setPrefs sanitizes and clamps riskBudgetUsd between 10 and 100,000", () => {
  setPrefs({ riskBudgetUsd: 0 });
  assert.equal(getPrefs().riskBudgetUsd, 10);

  setPrefs({ riskBudgetUsd: 250_000 });
  assert.equal(getPrefs().riskBudgetUsd, 100_000);

  setPrefs({ riskBudgetUsd: 500 });
  assert.equal(getPrefs().riskBudgetUsd, 500);
});

test("setPrefs handles goldPreset and falls back on unknown preset", () => {
  setPrefs({ goldPreset: "champagne" });
  assert.equal(getPrefs().goldPreset, "champagne");

  setPrefs({ goldPreset: "amber" });
  assert.equal(getPrefs().goldPreset, "amber");

  setPrefs({ goldPreset: "platinum" });
  assert.equal(getPrefs().goldPreset, "platinum");

  // @ts-expect-error test invalid preset
  setPrefs({ goldPreset: "neon-pink" });
  assert.equal(getPrefs().goldPreset, "bullion");
});

test("setPrefs switches palette between classic and blue-orange (UX-80)", () => {
  setPrefs({ palette: "blue-orange" });
  assert.equal(getPrefs().palette, "blue-orange");

  setPrefs({ palette: "classic" });
  assert.equal(getPrefs().palette, "classic");

  // @ts-expect-error test invalid palette
  setPrefs({ palette: "monochrome" });
  assert.equal(getPrefs().palette, "classic");
});

test("showSamples controls filtering of sample fixtures across journal views", () => {
  const dummyReal = normalizeTrade({
    id: "real-1",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: "2026-11-10T14:30:00Z",
    exit_time: "2026-11-10T14:45:00Z",
    entry_price: 6000,
    exit_price: 6010,
    stop_loss_price: 5990,
    planned_target_price: 6020,
    is_sample: false,
  });

  const dummySample = normalizeTrade({
    id: "sample-1",
    symbol: "MES",
    direction: "SHORT",
    quantity: 1,
    entry_time: "2026-11-10T15:00:00Z",
    exit_time: "2026-11-10T15:10:00Z",
    entry_price: 6010,
    exit_price: 6005,
    stop_loss_price: 6020,
    planned_target_price: 5995,
    is_sample: true,
  });

  const list = [dummyReal, dummySample];

  setPrefs({ showSamples: true });
  assert.equal(getPrefs().showSamples, true);
  assert.equal(withSamples(list, true).length, 2);

  setPrefs({ showSamples: false });
  assert.equal(getPrefs().showSamples, false);
  const filtered = withSamples(list, false);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "real-1");
  assert.equal(filtered[0].is_sample, false);
});

test("shield toggle updates prefs correctly", () => {
  setPrefs({ shield: true });
  assert.equal(getPrefs().shield, true);

  setPrefs({ shield: false });
  assert.equal(getPrefs().shield, false);

  // Restore defaults
  setPrefs(DEFAULT_PREFS);
});

test("getTuneRiskBudgetDisplay masks amounts and disables editing when Shield is on", () => {
  const shielded = getTuneRiskBudgetDisplay(true, 250);
  assert.equal(shielded.isEditable, false);
  assert.equal(shielded.label, "Default R size");
  assert.equal(shielded.valueText, "Hidden");
  assert.equal(shielded.inputValue, "Hidden");
  assert.equal(shielded.inputAriaLabel, "Default R size (hidden while Shield mode is on)");
  assert.equal(
    shielded.hint,
    "Used for accounts without their own R size. Turn Shield mode off to change the dollar amount."
  );

  // Strict check: no dollar signs, no numbers (e.g. 250), and no "USD"
  const allShieldedText = [
    shielded.label,
    shielded.valueText,
    shielded.inputValue,
    shielded.inputAriaLabel,
    shielded.hint,
  ].join(" ");
  assert.doesNotMatch(allShieldedText, /\$|\b250\b|usd/i);
});

test("getTuneRiskBudgetDisplay preserves editable dollar amounts when Shield is off", () => {
  const unshielded = getTuneRiskBudgetDisplay(false, 250);
  assert.equal(unshielded.isEditable, true);
  assert.equal(unshielded.label, "Default R size ($ USD)");
  assert.equal(unshielded.valueText, "$250");
  assert.equal(unshielded.inputValue, "250");
  assert.equal(unshielded.inputAriaLabel, "Default R size in US dollars");
  assert.equal(
    unshielded.hint,
    "Used for accounts without their own R size and trades with no account (default $250)."
  );

  const custom = getTuneRiskBudgetDisplay(false, 500);
  assert.equal(custom.valueText, "$500");
  assert.equal(custom.inputValue, "500");
});
