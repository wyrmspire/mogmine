#!/usr/bin/env node
// R-size backfill (docs/design-2026-11-24/04 §5). Dry run by default; `--apply <csv>` is the only path that writes.
//
// The CLI reads a journal backup file (`--input`), never Supabase and never /api/v1. Apply writes a NEW backup file
// (`--out`, which must differ from `--input`). Live-store wiring is deliberately not here: Chris runs that step.
//
// Writes only r_size_cents (when the trade has none, D-B), risk_cents (computed by riskCents) and stated_risk_r
// (from the CSV column the trader confirmed). Note fields are never read for writing and never changed.
//
// Usage:
//   node scripts/r-size-backfill.mjs --input backup.json [--csv review.csv]        # dry run (default)
//   node scripts/r-size-backfill.mjs --input backup.json --apply review.csv --out backup-r-size.json

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildBackup, parseBackupFile } from "../lib/journal-backup.ts";
import { isValidRSizeCents, isValidStatedRiskR, resolveRSize, riskCents, riskR, resultR } from "../lib/r-size.ts";
import { DEFAULT_OWNER_USER_ID, riskMultiple } from "../lib/trades.ts";
import { EPOCH, createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../lib/persistence/local-adapter.ts";

export const CSV_COLUMNS = [
  "id", "account_id", "r_size_cents", "r_size_source", "risk_cents", "old_risk_multiple", "new_result_r", "new_risk_r",
  "current_stated_risk_r", "proposed_stated_risk_r", "notes_have_risk_text", "updated_at",
];

/** The note fields. Scanned for proposals only; this script never writes them. */
const NOTE_FIELDS = ["note", "pre_trade_thesis", "management_notes", "post_exit_notes"];
/** A number then R: "0.25R", ".25 R", "$75 = 0.25R". Lookbehind keeps "2:1R" and words from matching. */
const R_MENTION = /(?<![\w.$:])(\d*\.\d+|\d+)\s?R(?![\w:])/g;

const round2 = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const blankIfNull = (value) => (value == null ? "" : value);

/**
 * Proposal only (never written as-is). Scans the four note fields for R amounts. Null when no note mentions an R
 * amount. Otherwise `{ proposed_stated_risk_r, notes_have_risk_text: true }`, where the proposal is the single
 * distinct amount in (0, 1] or null when there are none or several (ambiguous: Chris picks).
 */
export function proposeStatedRiskFromNotes(trade) {
  const values = new Set();
  let mentioned = false;
  for (const field of NOTE_FIELDS) {
    const text = typeof trade?.[field] === "string" ? trade[field] : "";
    for (const match of text.matchAll(R_MENTION)) {
      mentioned = true;
      const value = Number(match[1]);
      if (value > 0 && value <= 1 && isValidStatedRiskR(value)) values.add(value);
    }
  }
  if (!mentioned) return null;
  const proposed = values.size === 1 ? [...values][0] : null;
  return { proposed_stated_risk_r: proposed, notes_have_risk_text: true };
}

/** Repositories read and written, plus the owner. `prefs` overrides the stored prefs (a backup file carries its own). */
async function loadContext(source) {
  const { repos, owner } = source;
  const accounts = await repos.accounts.list(owner);
  if (!accounts.ok) throw new Error(`accounts: ${accounts.error.message}`);
  const prefs = source.prefs ?? (await repos.prefs.get(owner))?.value?.record ?? null;
  return { accounts: accounts.value, prefs };
}

/**
 * Dry run: one row per real trade. Reads only; never calls `put`. Samples are skipped.
 * `source` is `{ repos: { trades, accounts, prefs }, owner, prefs? }`.
 */
export async function runBackfillDryRun(source) {
  const context = await loadContext(source);
  const listed = await source.repos.trades.list(source.owner);
  if (!listed.ok) throw new Error(`trades: ${listed.error.message}`);
  const rows = [];
  let skippedSamples = 0;
  for (const listedTrade of listed.value) {
    if (listedTrade.is_sample === true) { skippedSamples += 1; continue; }
    const stored = await source.repos.trades.get(source.owner, listedTrade.id);
    if (!stored.ok) { rows.push({ id: listedTrade.id, error: stored.error.message }); continue; }
    const trade = stored.value.record;
    const rSize = resolveRSize(trade, context.accounts, context.prefs);
    const proposal = trade.stated_risk_r == null ? proposeStatedRiskFromNotes(trade) : null;
    rows.push({
      id: trade.id,
      account_id: blankIfNull(trade.account_id),
      r_size_cents: rSize.cents,
      r_size_source: rSize.source,
      risk_cents: blankIfNull(riskCents(trade)),
      old_risk_multiple: round2(riskMultiple(trade)),
      new_result_r: round2(resultR(trade, rSize)),
      new_risk_r: round2(riskR(trade, rSize)),
      current_stated_risk_r: blankIfNull(trade.stated_risk_r),
      proposed_stated_risk_r: blankIfNull(proposal?.proposed_stated_risk_r ?? null),
      notes_have_risk_text: proposal != null,
      updated_at: stored.value.meta.updated_at,
    });
  }
  return { rows, skippedSamples };
}

/** Apply outcome per id: `written`, `unchanged` (already matches, so no write), `conflict`, `failed` or `missing`. */
export async function runBackfillApply(source, rows) {
  const results = [];
  for (const row of rows) {
    if (row.error) { results.push({ id: row.id, outcome: "failed", message: row.error }); continue; }
    const stored = await source.repos.trades.get(source.owner, row.id);
    if (!stored.ok) { results.push({ id: row.id, outcome: "missing", message: stored.error.message }); continue; }
    const trade = stored.value.record;
    if (trade.is_sample === true) { results.push({ id: row.id, outcome: "unchanged", message: "sample" }); continue; }
    // The frozen R size wins (D-B); the CSV value is used only where the trade has none.
    const rSizeCents = trade.r_size_cents ?? Number(row.r_size_cents);
    if (!isValidRSizeCents(rSizeCents)) { results.push({ id: row.id, outcome: "failed", message: "no valid R size for this trade" }); continue; }
    // An empty confirmed value keeps what is stored; a typed one must be a valid stated R.
    const statedText = String(row.proposed_stated_risk_r ?? "").trim();
    if (statedText !== "" && !isValidStatedRiskR(Number(statedText))) { results.push({ id: row.id, outcome: "failed", message: "stated risk is not a valid R" }); continue; }
    const stated = statedText === "" ? trade.stated_risk_r ?? null : Number(statedText);
    const next = { ...trade, r_size_cents: rSizeCents, risk_cents: riskCents(trade), stated_risk_r: stated };
    const sameRSize = trade.r_size_cents === next.r_size_cents;
    const sameRisk = trade.risk_cents === next.risk_cents;
    if (sameRSize && sameRisk && trade.stated_risk_r === next.stated_risk_r) { results.push({ id: row.id, outcome: "unchanged", message: "" }); continue; }
    if (!row.updated_at) { results.push({ id: row.id, outcome: "failed", message: "CSV row has no updated_at" }); continue; }
    const written = await source.repos.trades.put(source.owner, next, { expectedUpdatedAt: row.updated_at });
    if (written.ok) results.push({ id: row.id, outcome: "written", message: "" });
    else results.push({ id: row.id, outcome: written.error.code === "conflict" ? "conflict" : "failed", message: written.error.message });
  }
  return results;
}

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

/** Parse a CSV written by `toCsv` back into row objects. Quoted cells with commas and doubled quotes are handled. */
export function parseCsv(text) {
  const records = [];
  let cell = "";
  let record = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { record.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      record.push(cell); cell = "";
      if (record.some((value) => value !== "")) records.push(record);
      record = [];
    } else cell += char;
  }
  record.push(cell);
  if (record.some((value) => value !== "")) records.push(record);
  const [header, ...body] = records;
  return body.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])));
}

/**
 * A repository set over an in-memory adapter, seeded from a backup file. Owner is the device default. Every row's
 * `updated_at` is the backup's `exportedAt`, so a CSV reviewed against this file applies cleanly until the file
 * itself changes (the file-mode concurrency check).
 */
export async function sourceFromBackup(text) {
  const parsed = parseBackupFile(text);
  if (!parsed.ok) throw new Error(`backup: ${parsed.error}`);
  const stamp = parsed.exportedAt ?? EPOCH;
  const adapter = createLocalAdapter({ kind: "mock", store: createMemoryKeyValueStore(), candles: createMemoryCandleStore(), now: () => stamp });
  const repos = adapter.repositories;
  const owner = DEFAULT_OWNER_USER_ID;
  for (const trade of parsed.trades) {
    const put = await repos.trades.put(owner, trade);
    if (!put.ok) throw new Error(`trade ${trade.id}: ${put.error.message}`);
  }
  for (const account of parsed.accounts?.accounts ?? []) {
    const put = await repos.accounts.put(owner, account);
    if (!put.ok) throw new Error(`account ${account.id}: ${put.error.message}`);
  }
  return { repos, owner, prefs: parsed.prefs ?? null, parsed };
}

function parseArgs(argv) {
  const args = { input: null, apply: null, out: null, csv: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--dry-run") continue;
    if (!["--input", "--apply", "--out", "--csv"].includes(flag) || value == null) throw new Error(`unknown or incomplete argument: ${flag}`);
    args[flag.slice(2)] = value;
    i += 1;
  }
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args.input) throw new Error("usage: --input <backup.json> [--csv <review.csv>] | --apply <review.csv> --out <new-backup.json>");
  if (args.apply && (!args.out || resolve(args.out) === resolve(args.input))) throw new Error("--apply needs --out, a file other than --input");
  const source = await sourceFromBackup(readFileSync(args.input, "utf8"));
  if (!args.apply) {
    const { rows, skippedSamples } = await runBackfillDryRun(source);
    const csv = toCsv(rows);
    if (args.csv) writeFileSync(args.csv, csv);
    else process.stdout.write(csv);
    console.error(`dry run: ${rows.length} trade(s), ${skippedSamples} sample(s) skipped, no writes`);
    return;
  }
  const rows = parseCsv(readFileSync(args.apply, "utf8"));
  const results = await runBackfillApply(source, rows);
  const counts = Object.fromEntries(["written", "unchanged", "conflict", "failed", "missing"].map((key) => [key, results.filter((r) => r.outcome === key).length]));
  const backup = buildBackup(await readAll(source), source.prefs ?? undefined, undefined, { accounts: await readAccounts(source), checks: source.parsed?.accounts?.checks ?? [] });
  writeFileSync(args.out, `${JSON.stringify(backup, null, 2)}\n`);
  console.error(`apply: ${JSON.stringify(counts)} -> ${args.out}`);
  for (const result of results.filter((r) => r.outcome === "conflict" || r.outcome === "failed")) console.error(`  ${result.outcome} ${result.id}: ${result.message}`);
}

async function readAll(source) {
  const listed = await source.repos.trades.list(source.owner);
  return listed.ok ? listed.value : [];
}

async function readAccounts(source) {
  const listed = await source.repos.accounts.list(source.owner);
  return listed.ok ? listed.value : [];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
}
