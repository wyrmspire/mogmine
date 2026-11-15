// CLI for the M0 Yahoo 1m candle archive. No-ops with a clear message when env is missing.
// Never prints environment values or keys.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ARCHIVE_NOT_CONFIGURED_MESSAGE,
  isArchiveConfigured,
} from "../lib/archive-config.ts";
import { createConfiguredArchiveClient } from "../lib/candle-archive.ts";
import { formatIngestReport, ingestYahooArchive, notConfiguredReport, type IngestOptions } from "../lib/archive-ingest.ts";
import { YahooFinanceProvider } from "../lib/market-data/yahoo.ts";

function loadEnvLocal(cwd = process.cwd()) {
  const file = resolve(cwd, ".env.local");
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

function parseArgs(argv: string[]): IngestOptions {
  const options: IngestOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--backfill") options.backfill = true;
    else if (arg === "--from" && next) { options.from = new Date(next); i++; }
    else if (arg === "--to" && next) { options.to = new Date(next); i++; }
    else if (arg === "--days" && next) { options.days = Number(next); i++; }
    else if (arg === "--symbol" && next) { options.symbols = [next]; i++; }
  }
  if (options.from && Number.isNaN(options.from.getTime())) throw new Error("Invalid --from date");
  if (options.to && Number.isNaN(options.to.getTime())) throw new Error("Invalid --to date");
  if (options.days != null && (!Number.isFinite(options.days) || options.days <= 0)) throw new Error("Invalid --days");
  return options;
}

export async function runIngestCli(
  argv = process.argv.slice(2),
  env: NodeJS.Dict<string | undefined> = process.env,
  deps?: { archive?: ReturnType<typeof createConfiguredArchiveClient>; yahoo?: YahooFinanceProvider; log?: (message: string) => void },
) {
  const log = deps?.log ?? console.log;
  if (!isArchiveConfigured(env)) {
    log(ARCHIVE_NOT_CONFIGURED_MESSAGE);
    return { report: notConfiguredReport(), exitCode: 0 };
  }
  const archive = deps?.archive ?? createConfiguredArchiveClient(env);
  if (!archive) {
    log(ARCHIVE_NOT_CONFIGURED_MESSAGE);
    return { report: notConfiguredReport(), exitCode: 0 };
  }
  const options = parseArgs(argv);
  const report = await ingestYahooArchive(options, { archive, yahoo: deps?.yahoo ?? new YahooFinanceProvider() });
  log(formatIngestReport(report));
  const failed = report.batches.some((batch) => batch.status === "failed");
  return { report, exitCode: failed ? 1 : 0 };
}

const isMain = Boolean(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href);

if (isMain) {
  loadEnvLocal();
  runIngestCli().then(({ exitCode }) => process.exit(exitCode)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Ingest failed";
    console.error(message);
    process.exit(1);
  });
}
