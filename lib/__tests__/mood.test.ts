// Mood Shape (docs/18): pure functions, fixtures, dynamic spokes and the AI-never-overwrites rule.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_MOOD_REGISTRY,
  MIN_MOOD_SAMPLE,
  ONE_TAP_MOOD_SCORE,
  acceptSuggestion,
  addSpoke,
  capturePhase,
  describeMood,
  dominantSpoke,
  isRetrospectiveMood,
  moodOutcomeStats,
  moodPath,
  moodSimilarity,
  moodVector,
  parseMoodSuggestion,
  readyCandidates,
  recordCandidates,
  rescoreForNewSpoke,
  sanitizeMoodRecords,
  sanitizeRegistry,
  scoreAtPoint,
  similarTrades,
  spokeChipLabel,
  suggestMoodFromText,
  userMoodRecord,
  userScoreRecord,
} from "../mood.ts";
import type { MoodRecord, MoodSpokeRegistry } from "../mood.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

const NOW = "2026-11-19T12:00:00.000Z";

interface FixtureDoc {
  id: string;
  events: Array<{ type: string; role?: string; t: string; text?: string }>;
  mood_records?: MoodRecord[];
}

function readDoc(name: string): FixtureDoc {
  return JSON.parse(readFileSync(new URL(`../../fixtures/trades/${name}.json`, import.meta.url), "utf8")) as FixtureDoc;
}

/** The few trade fields mood needs, read from a `mogmine.trade.v1` document. */
function moodTradeFromDoc(doc: FixtureDoc) {
  const exits = doc.events.filter((event) => event.type === "fill" && event.role === "exit");
  return {
    id: doc.id,
    exit_time: exits.length ? exits[exits.length - 1].t : null,
    quick_tags: [] as string[],
    text: doc.events.filter((event) => event.type === "note").map((event) => event.text ?? "").join("\n"),
  };
}

const registryV2 = JSON.parse(readFileSync(new URL("../../fixtures/mood/spokes-v2.json", import.meta.url), "utf8")) as MoodSpokeRegistry;

function trade(id: string, patch: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id,
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-12T15:30:00.000Z",
    exit_time: "2026-11-12T15:45:00.000Z",
    entry_price: 7600,
    exit_price: 7610,
    stop_loss_price: 7595,
    ...patch,
  });
}

function record(tradeId: string, scores: MoodRecord["scores"], patch: Partial<MoodRecord> = {}): MoodRecord {
  return {
    id: `${tradeId}-${Object.keys(scores).join("-")}-${patch.source ?? "user"}-${patch.created_at ?? NOW}`,
    trade_id: tradeId,
    spoke_set_version: 1,
    scores,
    evidence: {},
    source: "user",
    model: null,
    captured_at: NOW,
    created_at: NOW,
    ...patch,
  };
}

const valueOf = (vector: ReturnType<typeof moodVector>, spoke: string) => vector.values[vector.spokes.indexOf(spoke)];

test("moodVector: a user score wins over an AI score, even a newer one", () => {
  const t = trade("t1");
  const records = [
    record("t1", { fomo: 0.3 }, { source: "user", created_at: "2026-11-12T16:00:00.000Z" }),
    record("t1", { fomo: 0.9, fear: 0.6 }, { source: "voice_ai", model: "m", evidence: { fomo: "chased", fear: "scared" }, created_at: "2026-11-12T17:00:00.000Z" }),
  ];
  const vector = moodVector(t, records, DEFAULT_MOOD_REGISTRY);
  assert.equal(valueOf(vector, "fomo"), 0.3);
  assert.equal(vector.detail.find((item) => item.spoke.id === "fomo")?.origin, "user");
  assert.equal(valueOf(vector, "fear"), 0.6);
  assert.equal(vector.detail.find((item) => item.spoke.id === "fear")?.evidence, "scared");
});

test("moodVector: unknown is null, never 0; a user null sets a spoke back to unknown", () => {
  const t = trade("t2");
  const empty = moodVector(t, [], DEFAULT_MOOD_REGISTRY);
  assert.deepEqual(empty.values, [null, null, null, null, null, null]);
  const records = [
    record("t2", { calm: 0.7 }, { created_at: "2026-11-12T16:00:00.000Z" }),
    record("t2", { calm: null }, { created_at: "2026-11-12T16:05:00.000Z" }),
  ];
  assert.equal(valueOf(moodVector(t, records, DEFAULT_MOOD_REGISTRY), "calm"), null);
});

test("moodVector: execution tags seed defaults only where nothing is recorded", () => {
  const t = trade("t3", { quick_tags: ["Chased Entry", "A+ Patience", "Opening Drive"] });
  const vector = moodVector(t, [record("t3", { calm: 0.2 })], DEFAULT_MOOD_REGISTRY);
  assert.equal(valueOf(vector, "fomo"), 0.8);
  assert.equal(vector.detail.find((item) => item.spoke.id === "fomo")?.origin, "tag");
  assert.equal(valueOf(vector, "calm"), 0.2, "the trader's own score beats the A+ Patience default");
  assert.equal(valueOf(vector, "fear"), null);
});

test("moodVector pre_exit: only scores captured before the exit, and no tag defaults", () => {
  const t = trade("t4", { quick_tags: ["Revenge"] });
  const records = [
    record("t4", { fomo: 0.8 }, { source: "voice_ai", captured_at: "2026-11-12T15:35:00.000Z" }),
    record("t4", { fear: 0.6 }, { captured_at: "2026-11-12T16:00:00.000Z" }),
    record("t4", { hope: 0.6 }, { source: "voice_ai", captured_at: null }),
  ];
  assert.equal(capturePhase(records[0], t), "pre_exit");
  assert.equal(capturePhase(records[1], t), "post_exit");
  assert.equal(capturePhase(records[2], t), "unknown");
  const pre = moodVector(t, records, DEFAULT_MOOD_REGISTRY, { phase: "pre_exit" });
  assert.equal(valueOf(pre, "fomo"), 0.8);
  assert.equal(valueOf(pre, "fear"), null);
  assert.equal(valueOf(pre, "hope"), null);
  assert.equal(valueOf(pre, "frustration"), null);
  const open = trade("t5", { status: "open", exit_time: null, exit_price: null });
  assert.equal(capturePhase(record("t5", { calm: 1 }), open), "pre_exit");
});

test("moodPath: closed curve, one point per spoke, unknown spokes dashed", () => {
  assert.equal(moodPath([0.5, 0.5], { size: 40 }), null);
  const all = moodPath([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], { size: 100, padding: 0 });
  assert.ok(all);
  assert.equal(all.points.length, 6);
  assert.equal(all.dashed, "");
  assert.equal((all.fill.match(/C/g) ?? []).length, 6);
  assert.ok(all.fill.endsWith("Z"));
  // Balanced scores sit on one circle.
  const radii = all.points.map((point) => Math.hypot(point.x - 50, point.y - 50));
  assert.ok(Math.max(...radii) - Math.min(...radii) < 1e-9);
  // First spoke points straight up.
  assert.ok(Math.abs(all.points[0].x - 50) < 1e-9 && all.points[0].y < 50);

  const gap = moodPath([0.5, null, 0.5, 0.5, 0.5, 0.5], { size: 100 });
  assert.ok(gap);
  assert.equal((gap.dashed.match(/M/g) ?? []).length, 2, "both segments touching the unknown spoke are dashed");
  assert.equal((gap.solid.match(/M/g) ?? []).length, 4);
});

test("scoreAtPoint inverts the drawn point on each spoke", () => {
  const values = [0.1, 0.25, 0.5, 0.75, 0.9, 1];
  const geometry = moodPath(values, { size: 300, padding: 24 });
  assert.ok(geometry);
  geometry.points.forEach((point, index) => {
    assert.equal(scoreAtPoint(point.x, point.y, index, values.length, 300, { padding: 24 }), values[index]);
  });
  // Past the end clamps to 1; across the centre clamps to 0.
  assert.equal(scoreAtPoint(150, -500, 0, 6, 300, { padding: 24 }), 1);
  assert.equal(scoreAtPoint(150, 600, 0, 6, 300, { padding: 24 }), 0);
});

test("three fixture trades draw three different shapes: calm round, FOMO stretched, new spoke", () => {
  const docs = ["ex-tp", "ex-sl", "ex-trail"].map(readDoc);
  const records = docs.flatMap((doc) => doc.mood_records ?? []);
  assert.equal(sanitizeMoodRecords(records).length, records.length, "fixture records are valid");
  const vectors = docs.map((doc) => moodVector(moodTradeFromDoc(doc), records, registryV2));
  const [calm, fomo, bored] = vectors;

  // Calm: every starting spoke scored, nothing dominates, small spread. Boredom unknown (older version).
  assert.equal(dominantSpoke(calm), null);
  const calmKnown = calm.values.filter((value): value is number => value != null);
  assert.equal(calmKnown.length, 6);
  assert.ok(Math.max(...calmKnown) - Math.min(...calmKnown) < 0.2);
  assert.equal(valueOf(calm, "boredom"), null);

  // FOMO: pulled hard toward one spoke.
  assert.equal(dominantSpoke(fomo), "fomo");
  assert.equal(describeMood(fomo).startsWith("FOMO high"), true);

  // New spoke: boredom scored from the re-score, the only one of the three with it.
  assert.equal(valueOf(bored, "boredom"), 0.8);
  const geometries = vectors.map((vector) => moodPath(vector.values, { size: 120 }));
  assert.ok(geometries.every(Boolean));
  assert.notEqual(geometries[0]?.dashed, "", "calm shape shows the unscored boredom spoke as a gap");
  assert.equal(geometries[2]?.dashed, "", "the trade scored on every spoke has no gap");
  assert.equal(new Set(geometries.map((geometry) => geometry?.fill)).size, 3);

  // The FOMO shape reaches furthest along the FOMO spoke; the calm one is near round.
  const reach = (index: number, spoke: string) => {
    const point = geometries[index]?.points[registryV2.spokes.findIndex((item) => item.id === spoke)];
    return point ? Math.hypot(point.x - 60, point.y - 60) : 0;
  };
  assert.ok(reach(1, "fomo") > 1.5 * reach(0, "fomo") - 1);
  assert.ok(reach(1, "fomo") > reach(1, "calm") * 2);
});

test("fixture evidence quotes the fixture's own note text", () => {
  for (const name of ["ex-tp", "ex-sl", "ex-trail"]) {
    const doc = readDoc(name);
    const text = moodTradeFromDoc(doc).text.toLowerCase();
    for (const item of doc.mood_records ?? []) {
      for (const quote of Object.values(item.evidence)) assert.ok(text.includes(quote.toLowerCase()), `${name}: “${quote}”`);
    }
  }
});

test("suggestMoodFromText: scores what the text says, quotes it, skips negations, finds candidates", () => {
  const text = "Took MES long after the sweep. Got a little scared at VWAP and took everything off. I was not patient at all. Honestly bored before the entry.";
  const suggestion = suggestMoodFromText(text, DEFAULT_MOOD_REGISTRY, { trade_id: "t", now: NOW });
  assert.equal(suggestion.scores.fear, 0.8);
  assert.match(suggestion.evidence.fear, /scared at VWAP/);
  assert.equal(suggestion.scores.calm, undefined, "“not patient” is not a calm cue");
  assert.equal(suggestion.scores.fomo, undefined, "no cue: unknown, not 0");
  assert.deepEqual(suggestion.candidates.map((item) => item.label), ["Boredom"]);
  assert.equal(suggestion.model, "mogmine-phrases-v1");
  // "impatient" is a candidate, not calm.
  const impatient = suggestMoodFromText("Impatient all morning.", DEFAULT_MOOD_REGISTRY, { trade_id: "t", now: NOW });
  assert.equal(impatient.scores.calm, undefined);
  assert.deepEqual(impatient.candidates.map((item) => item.label), ["Impatience"]);
});

test("acceptSuggestion never overwrites a score the trader set (UX-33)", () => {
  const records = [record("t6", { fomo: 0.2 })];
  const suggestion = suggestMoodFromText("Chased it and got scared.", DEFAULT_MOOD_REGISTRY, { trade_id: "t6", now: NOW, captured_at: NOW });
  assert.equal(suggestion.scores.fomo, 0.85);
  const accepted = acceptSuggestion(suggestion, records, { id: "a1", now: NOW });
  assert.ok(accepted);
  assert.equal(accepted.source, "voice_ai");
  assert.equal(accepted.scores.fomo, undefined);
  assert.equal(accepted.scores.fear, 0.8);
  const vector = moodVector(trade("t6"), [...records, accepted], DEFAULT_MOOD_REGISTRY);
  assert.equal(valueOf(vector, "fomo"), 0.2);
  // Accepting only spokes the trader already set leaves nothing to write.
  assert.equal(acceptSuggestion(suggestion, records, { id: "a2", now: NOW, spokes: ["fomo"] }), null);
});

test("userScoreRecord rounds and clamps, and records the trader as the source", () => {
  const made = userScoreRecord({ id: "u1", trade_id: "t", now: NOW }, DEFAULT_MOOD_REGISTRY, "hope", 1.234);
  assert.deepEqual(made.scores, { hope: 1 });
  assert.equal(made.source, "user");
  assert.equal(made.model, null);
  assert.equal(made.spoke_set_version, 1);
});

test("parseMoodSuggestion: the AI contract rejects bad numbers and evidence that is not a quote", () => {
  const text = "Chased the push. Felt bored waiting for it.";
  const meta = { trade_id: "t", model: "ai-x", now: NOW };
  const ok = parseMoodSuggestion({ scores: { fomo: 0.8, boredom: 0.6 }, evidence: { fomo: "Chased the push", boredom: "felt bored" } }, DEFAULT_MOOD_REGISTRY, text, meta);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.suggestion.scores, { fomo: 0.8 });
    assert.deepEqual(ok.suggestion.candidates, [{ label: "boredom", evidence: "felt bored" }]);
  }
  assert.equal(parseMoodSuggestion({ scores: { fomo: 1.4 }, evidence: { fomo: "Chased the push" } }, DEFAULT_MOOD_REGISTRY, text, meta).ok, false);
  assert.equal(parseMoodSuggestion({ scores: { fomo: 0.8 }, evidence: {} }, DEFAULT_MOOD_REGISTRY, text, meta).ok, false);
  assert.equal(parseMoodSuggestion({ scores: { fomo: 0.8 }, evidence: { fomo: "I panicked" } }, DEFAULT_MOOD_REGISTRY, text, meta).ok, false);
  assert.equal(parseMoodSuggestion("nope", DEFAULT_MOOD_REGISTRY, text, meta).ok, false);
});

test("candidates are counted once per trade and offered at the threshold", () => {
  let list = recordCandidates([], ["Boredom"], "a", NOW);
  list = recordCandidates(list, ["Boredom"], "a", NOW);
  assert.equal(list[0].count, 1);
  list = recordCandidates(list, ["boredom"], "b", NOW);
  assert.deepEqual(readyCandidates(list, DEFAULT_MOOD_REGISTRY), []);
  list = recordCandidates(list, ["Boredom"], "c", NOW);
  assert.deepEqual(readyCandidates(list, DEFAULT_MOOD_REGISTRY).map((item) => item.id), ["boredom"]);
  assert.deepEqual(readyCandidates(list, DEFAULT_MOOD_REGISTRY, 4), []);
  assert.deepEqual(readyCandidates([{ ...list[0], dismissed: true }], DEFAULT_MOOD_REGISTRY), []);
  assert.deepEqual(readyCandidates(list, addSpoke(DEFAULT_MOOD_REGISTRY, "Boredom")), []);
});

test("adding a spoke bumps the version and re-scores past trades from their own text", () => {
  const trades = [
    trade("r1", { note: "Bored after an hour of chop and took it anyway." }),
    trade("r2", { note: "Clean entry, waited for the close." }),
    trade("r3", { note: "So bored I sized up." }),
    trade("r4", { note: "" }),
  ];
  const userSet = record("r3", { boredom: 0.3 }, { spoke_set_version: 2 });
  const before = [record("r1", { calm: 0.4, fomo: 0.5, fear: 0.3 }), record("r2", { calm: 0.8, fomo: 0.1, fear: 0.2 })];
  const registry = addSpoke(DEFAULT_MOOD_REGISTRY, "Boredom");
  assert.equal(registry.version, 2);
  assert.equal(registry.spokes.length, 7);
  assert.equal(registry.spokes[6].added_in_version, 2);
  assert.equal(addSpoke(registry, "boredom"), registry, "adding an existing spoke changes nothing");

  // Before the re-score the new spoke is unknown on every old trade.
  assert.equal(valueOf(moodVector(trades[0], before, registry), "boredom"), null);

  const rescored = rescoreForNewSpoke(trades, [...before, userSet], registry, "boredom", { now: NOW, makeId: (item) => `rs-${item.id}` });
  assert.deepEqual(rescored.map((item) => item.trade_id), ["r1"], "r2 has no cue, r3 was set by hand, r4 has no text");
  assert.equal(rescored[0].spoke_set_version, 2);
  assert.equal(rescored[0].source, "voice_ai");
  assert.equal(rescored[0].captured_at, null);
  assert.match(rescored[0].evidence.boredom, /Bored after an hour/);

  const all = [...before, userSet, ...rescored];
  const r1 = moodVector(trades[0], all, registry);
  assert.equal(valueOf(r1, "boredom"), 0.8);
  assert.equal(valueOf(r1, "calm"), 0.4, "old scores keep their values");
  assert.equal(valueOf(moodVector(trades[1], all, registry), "boredom"), null, "no evidence stays unknown");
  assert.equal(valueOf(moodVector(trades[2], all, registry), "boredom"), 0.3);
  // Old and new shapes compare over the spokes both scored.
  assert.ok(moodSimilarity(r1, moodVector(trades[1], all, registry)));
});

test("moodSimilarity: cosine over shared spokes; too little overlap or a zero vector is null", () => {
  const spokes = ["a", "b", "c", "d"];
  assert.equal(moodSimilarity({ spokes, values: [1, 0, 0, null] }, { spokes, values: [1, 0, 0, 1] })?.similarity, 1);
  const half = moodSimilarity({ spokes, values: [1, 0, 0, null] }, { spokes, values: [0, 1, 0, null] });
  assert.equal(half?.similarity, 0);
  assert.equal(half?.distance, 1);
  assert.equal(moodSimilarity({ spokes, values: [1, null, null, 1] }, { spokes, values: [1, 1, 1, 1] }), null);
  assert.equal(moodSimilarity({ spokes, values: [0, 0, 0, 0] }, { spokes, values: [1, 1, 1, 1] }), null);
  // Spokes are matched by id, not position.
  assert.equal(moodSimilarity({ spokes: ["a", "b", "c"], values: [1, 0.5, 0] }, { spokes: ["c", "b", "a"], values: [0, 0.5, 1] })?.similarity, 1);
});

test("similarTrades: nearest shapes first, samples kept apart, R summary flags small samples", () => {
  const target = trade("s0");
  const like = trade("s1", { exit_price: 7590 });
  const alsoLike = trade("s2");
  const unlike = trade("s3");
  const sample = { ...trade("s4"), is_sample: true };
  const noStop = trade("s5", { stop_loss_price: null });
  const records = [
    record("s0", { calm: 0.2, fomo: 0.9, fear: 0.3 }),
    record("s1", { calm: 0.2, fomo: 0.8, fear: 0.3 }),
    record("s2", { calm: 0.25, fomo: 0.9, fear: 0.4 }),
    record("s3", { calm: 0.9, fomo: 0.1, fear: 0.1 }),
    record("s4", { calm: 0.2, fomo: 0.9, fear: 0.3 }),
    record("s5", { calm: 0.2, fomo: 0.9, fear: 0.3 }),
  ];
  const result = similarTrades(target, [target, like, alsoLike, unlike, sample, noStop], records, DEFAULT_MOOD_REGISTRY);
  assert.deepEqual(new Set(result.matches.map((match) => match.trade.id)), new Set(["s1", "s2", "s5"]));
  assert.ok(result.matches[0].similarity >= result.matches[1].similarity);
  assert.equal(result.summary.n, 2);
  assert.equal(result.summary.skipped, 1, "a trade with no stop has no R and is skipped, not 0");
  assert.equal(result.summary.wins, 1);
  assert.equal(result.summary.losses, 1);
  assert.equal(result.summary.enough, false);
  assert.equal(MIN_MOOD_SAMPLE, 20);
});

test("moodOutcomeStats: winner and loser shapes, expectancy by dominant spoke, skips counted", () => {
  const trades: TradeRecord[] = [];
  const records: MoodRecord[] = [];
  for (let index = 0; index < 12; index += 1) {
    const win = index % 3 !== 0;
    trades.push(trade(`w${index}`, { exit_price: win ? 7610 : 7595 }));
    records.push(record(`w${index}`, win ? { calm: 0.8, fomo: 0.2 } : { calm: 0.2, fomo: 0.9 }));
  }
  trades.push({ ...trade("sample"), is_sample: true });
  trades.push(trade("open", { status: "open", exit_time: null, exit_price: null }));
  trades.push(trade("nostop", { stop_loss_price: null }));
  trades.push(trade("nomood"));
  const stats = moodOutcomeStats(trades, records, DEFAULT_MOOD_REGISTRY);
  assert.deepEqual(stats.skipped, { sample: 1, open: 1, noR: 1, noMood: 1 });
  assert.equal(stats.used, 12);
  assert.equal(stats.enough, false);
  assert.equal(stats.winners.n, 8);
  assert.equal(stats.losers.n, 4);
  const calmIndex = stats.spokes.indexOf("calm");
  assert.equal(stats.winners.shape[calmIndex], 0.8);
  assert.equal(stats.losers.shape[calmIndex], 0.2);
  assert.equal(stats.winners.shape[stats.spokes.indexOf("fear")], null, "nobody scored fear: unknown, not 0");
  const calmGroup = stats.byDominant.find((group) => group.spoke === "calm");
  const fomoGroup = stats.byDominant.find((group) => group.spoke === "fomo");
  assert.equal(calmGroup?.summary.meanR, 2);
  assert.equal(fomoGroup?.summary.meanR, -1);
  // Pre-exit only: these records were captured at NOW, after every exit, so nothing qualifies.
  assert.equal(moodOutcomeStats(trades, records, DEFAULT_MOOD_REGISTRY, { phase: "pre_exit" }).used, 0);
});

test("describeMood describes, never judges (UX-67)", () => {
  const t = trade("d1");
  assert.equal(describeMood(moodVector(t, [], DEFAULT_MOOD_REGISTRY)), "No mood recorded");
  const fomo = moodVector(t, [record("d1", { fomo: 0.9, calm: 0.2 })], DEFAULT_MOOD_REGISTRY);
  assert.equal(describeMood(fomo), "FOMO high · Calm / patience low · 4 not scored");
  const balanced = moodVector(t, [record("d1", { calm: 0.5, fomo: 0.5, fear: 0.5, hope: 0.5, confidence: 0.5, frustration: 0.5 })], DEFAULT_MOOD_REGISTRY);
  assert.match(describeMood(balanced), /^Balanced/);
  const twoHigh = moodVector(t, [record("d1", { fomo: 0.9, frustration: 0.8, calm: 0.2 })], DEFAULT_MOOD_REGISTRY);
  assert.equal(dominantSpoke(twoHigh), null);
  assert.equal(describeMood(twoHigh), "FOMO high · Frustration high · 3 not scored", "two strong feelings are not called balanced");
  assert.doesNotMatch(describeMood(fomo), /you|chased|panic/i);
});

test("stored data is sanitised, and the starting spokes can never be lost", () => {
  const good = record("x", { calm: 0.5 });
  const cleaned = sanitizeMoodRecords([good, { ...good, source: "robot" }, { ...good, scores: { calm: 3 } }, null, { ...record("y", { fear: null }, { source: "voice_ai" }) }]);
  assert.equal(cleaned.length, 3);
  assert.equal(cleaned[1].scores.calm, 1);
  assert.deepEqual(cleaned[2].scores, {}, "an AI record cannot store unknown");
  assert.deepEqual(sanitizeRegistry(null), DEFAULT_MOOD_REGISTRY);
  const damaged = sanitizeRegistry({ version: 2, spokes: [{ id: "boredom", label: "Boredom", short: "Bored", added_in_version: 2 }] });
  assert.equal(damaged.version, 2);
  assert.deepEqual(damaged.spokes.map((spoke) => spoke.id), ["calm", "confidence", "hope", "fomo", "fear", "frustration", "boredom"]);
});

test("backups carry mood data, and an older backup without it restores as before", async () => {
  const { buildBackup, parseBackupFile } = await import("../store.ts");
  const t = trade("b1");
  const mood = { registry: addSpoke(DEFAULT_MOOD_REGISTRY, "Boredom"), records: [record("b1", { fomo: 0.7 })], candidates: [] };
  const parsed = parseBackupFile(JSON.stringify(buildBackup([t], undefined, mood)));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.mood?.registry.version, 2);
    assert.deepEqual(parsed.mood?.records.map((item) => item.scores), [{ fomo: 0.7 }]);
  }
  const old = parseBackupFile(JSON.stringify(buildBackup([t])));
  assert.equal(old.ok && "mood" in old, false);
});

test("userMoodRecord and one-tap mood at entry / pre-exit (UI-3, docs/19 §4, OD-39 c)", () => {
  const meta = { id: "rec-1", trade_id: "trade-1", now: "2026-11-20T14:30:00.000Z", captured_at: "2026-11-20T14:00:00.000Z" };
  const rec = userMoodRecord(meta, DEFAULT_MOOD_REGISTRY, { calm: ONE_TAP_MOOD_SCORE, fomo: null });
  assert.equal(rec.id, "rec-1");
  assert.equal(rec.trade_id, "trade-1");
  assert.equal(rec.source, "user");
  assert.equal(rec.captured_at, "2026-11-20T14:00:00.000Z");
  assert.equal(rec.scores.calm, 0.8);
  assert.equal(rec.scores.fomo, null);

  // Closed trade: captured_at is before exit_time -> pre_exit
  const closed = trade("trade-1", { entry_time: "2026-11-20T14:00:00.000Z", exit_time: "2026-11-20T14:30:00.000Z" });
  assert.equal(capturePhase(rec, closed), "pre_exit");

  // Open trade: exit_time is null -> pre_exit
  const open = trade("trade-1", { status: "open", entry_time: "2026-11-20T14:00:00.000Z", exit_time: null, exit_price: null });
  assert.equal(capturePhase(rec, open), "pre_exit");

  // Pre-exit mood vector recognizes calm as dominant
  const vector = moodVector(closed, [rec], DEFAULT_MOOD_REGISTRY, { phase: "pre_exit" });
  assert.equal(dominantSpoke(vector), "calm");
  assert.equal(describeMood(vector), "Calm / patience high · 5 not scored");
});

test("spokeChipLabel formats concise labels for chips", () => {
  const calmSpoke = DEFAULT_MOOD_REGISTRY.spokes.find((s) => s.id === "calm")!;
  const confSpoke = DEFAULT_MOOD_REGISTRY.spokes.find((s) => s.id === "confidence")!;
  assert.equal(spokeChipLabel(calmSpoke), "Calm");
  assert.equal(spokeChipLabel(confSpoke), "Confidence");
});

test("mood recording distinguishes historical captured_at from true wall-clock recorded_at", () => {
  const wallClockNow = "2026-11-22T14:40:00.000Z";
  const historicalEntry = "2026-11-20T14:00:00.000Z";
  const historicalExit = "2026-11-20T14:30:00.000Z";
  const closed = trade("trade-retro", { entry_time: historicalEntry, exit_time: historicalExit });

  const retroRecord = userMoodRecord(
    { id: "rec-retro", trade_id: "trade-retro", now: wallClockNow, captured_at: historicalEntry, recorded_at: wallClockNow },
    DEFAULT_MOOD_REGISTRY,
    { fomo: ONE_TAP_MOOD_SCORE },
  );

  assert.equal(retroRecord.captured_at, historicalEntry);
  assert.equal(retroRecord.recorded_at, wallClockNow);
  assert.equal(retroRecord.created_at, wallClockNow);
  // Although the user says the feeling applied to the entry phase:
  assert.equal(capturePhase(retroRecord, closed), "pre_exit");
  // isRetrospectiveMood correctly detects that the recording happened post-exit (retrospective hindsight):
  assert.equal(isRetrospectiveMood(retroRecord, closed), true);

  // Contemporaneous record (entered during an open trade or before exit):
  const liveRecord = userMoodRecord(
    { id: "rec-live", trade_id: "trade-retro", now: "2026-11-20T14:15:00.000Z", captured_at: "2026-11-20T14:15:00.000Z", recorded_at: "2026-11-20T14:15:00.000Z" },
    DEFAULT_MOOD_REGISTRY,
    { calm: ONE_TAP_MOOD_SCORE },
  );
  assert.equal(isRetrospectiveMood(liveRecord, closed), false);
});
