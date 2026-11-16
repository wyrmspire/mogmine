// Issue #83: data-quality notes collapse into one chip. Amber only for missing or partial coverage.
// Hindsight ("After the exit") is never a data note. Pure: never changes R, P&L, or stats.
import assert from "node:assert/strict";
import { test } from "node:test";
import { collectDataNotes, dataNoteCountLabel, hasUntrustedDataNote } from "../data-notes.ts";
import type { DataNoteInput } from "../data-notes.ts";

const clean: DataNoteInput = {
  noCandles: false,
  base: "1m",
  misaligned: false,
  ticker: "MES=F",
  coverage: "complete",
  chronologyUnresolved: false,
  issueCodes: [],
};

const ids = (input: DataNoteInput) => collectDataNotes(input).map((note) => note.id);

test("no data notes when everything is clean: the chip renders nothing", () => {
  assert.deepEqual(collectDataNotes(clean), []);
  assert.equal(hasUntrustedDataNote(collectDataNotes(clean)), false);
});

test("base timeframe other than 1m is a quiet note, and not shown while loading", () => {
  const notes = collectDataNotes({ ...clean, base: "5m" });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, "not_1m");
  assert.equal(notes[0].tone, "quiet");
  assert.match(notes[0].text, /showing 5m bars/);
  assert.deepEqual(collectDataNotes({ ...clean, base: null }), []);
});

test("missing coverage is the only amber case and makes the chip untrusted", () => {
  const notes = collectDataNotes({ ...clean, coverage: "missing" });
  assert.deepEqual(notes.map((note) => [note.id, note.tone]), [["coverage_missing", "untrusted"]]);
  assert.equal(hasUntrustedDataNote(notes), true);
});

test("partial coverage is amber and makes the chip untrusted", () => {
  const notes = collectDataNotes({ ...clean, coverage: "partial" });
  assert.deepEqual(notes.map((note) => [note.id, note.tone]), [["coverage_partial", "untrusted"]]);
  assert.equal(hasUntrustedDataNote(notes), true);
});

test("continuous-contract misalignment names the ticker and stays quiet", () => {
  const notes = collectDataNotes({ ...clean, misaligned: true });
  assert.equal(notes[0].id, "continuous_contract");
  assert.equal(notes[0].tone, "quiet");
  assert.match(notes[0].text, /MES=F continuous contract/);
  assert.equal(hasUntrustedDataNote(notes), false);
});

test("same-bar chronology counts only when coverage is complete", () => {
  assert.deepEqual(ids({ ...clean, chronologyUnresolved: true }), ["same_bar_unresolved"]);
  assert.deepEqual(ids({ ...clean, coverage: "partial", chronologyUnresolved: true }), ["coverage_partial"]);
  assert.deepEqual(ids({ ...clean, coverage: null, chronologyUnresolved: true }), []);
});

test("stop, target and exit-outside-bar issues are each one quiet note", () => {
  const notes = collectDataNotes({
    ...clean,
    issueCodes: ["stop_crossed_before_exit", "target_crossed_before_exit", "exit_outside_bar"],
  });
  assert.deepEqual(notes.map((note) => note.id), ["stop_crossed", "target_crossed", "exit_outside_bar"]);
  assert.ok(notes.every((note) => note.tone === "quiet"));
  assert.equal(hasUntrustedDataNote(notes), false);
});

test("no candles yields exactly one coverage-missing note, never a duplicate", () => {
  const notes = collectDataNotes({
    noCandles: true,
    base: null,
    misaligned: true,
    ticker: "MES=F",
    coverage: "missing",
    chronologyUnresolved: true,
    issueCodes: ["exit_outside_bar"],
  });
  assert.deepEqual(notes.map((note) => [note.id, note.tone]), [["coverage_missing", "untrusted"]]);
});

test("counts and labels: the chip shows the number of notes", () => {
  const notes = collectDataNotes({
    ...clean,
    base: "5m",
    misaligned: true,
    coverage: "partial",
    issueCodes: ["stop_crossed_before_exit"],
  });
  assert.equal(notes.length, 4);
  assert.equal(dataNoteCountLabel(notes.length), "4 data notes");
  assert.equal(dataNoteCountLabel(1), "1 data note");
  assert.equal(hasUntrustedDataNote(notes), true);
});

test("hindsight is never a data note, even with a later touch on the trade", () => {
  // Hindsight is not an input to this helper. Its fact text must not appear among the notes.
  const notes = collectDataNotes({ ...clean, issueCodes: ["stop_crossed_before_exit"] });
  assert.ok(notes.every((note) => !/after the exit|hindsight|held to plan/i.test(note.text)));
});
