// DR-2 · docs/design-2026-11-24/06 §2.2: move the 11/23 daily review (stored as a plan) into a `daily_reviews` record.
//
// Dry-run by default: prints the proposed DailyReview and writes nothing. `--apply` saves the DailyReview and
// NEVER modifies or deletes the source plan (deleting it is Chris's call).
//
// Pure core: proposeDailyReviewFromPlan(plan, trades). Side effects happen only through the injected `commands`
// object, so tests pass mocks. The CLI reads a FIXTURE file only; live repositories are not wired here, so the
// script cannot reach real accounts or /api/v1.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const DAILY_REVIEW_TEXT_LIMIT = 500;
const SESSION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Same id rule as lib/daily-review.ts `dailyReviewId`, kept local so this script imports nothing from lib/. */
export function dailyReviewIdFor(sessionDate, accountId = null) {
  return accountId ? `review-${sessionDate}-${accountId}` : `review-${sessionDate}`;
}

/**
 * Rule 1 (06 §2.2): trade ids typed into the legacy observations text are the proposed links, in the order they
 * appear. Ids that are not in `trades`, or are samples, are reported and not linked. Nothing is linked by time window.
 */
export function proposeDailyReviewFromPlan(plan, trades, opts = {}) {
  if (!plan || typeof plan !== "object") throw new Error("proposeDailyReviewFromPlan: plan is required");
  const sessionDate = plan.session_date;
  if (typeof sessionDate !== "string" || !SESSION_DATE_PATTERN.test(sessionDate)) {
    throw new Error(`proposeDailyReviewFromPlan: plan ${plan.id} has no YYYY-MM-DD session_date`);
  }
  const accountId = opts.accountId ?? null;
  const warnings = [];
  const text = typeof plan.observations === "string" ? plan.observations : "";

  const mentioned = trades
    .map((trade) => ({ trade, at: text.indexOf(trade.id) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at);
  const tradeIds = [];
  for (const { trade } of mentioned) {
    if (trade.is_sample) {
      warnings.push(`trade ${trade.id} is a sample: not linked`);
      continue;
    }
    if (accountId != null && trade.account_id !== accountId) {
      warnings.push(`trade ${trade.id} is on another account: not linked`);
      continue;
    }
    tradeIds.push(trade.id);
  }
  const idsNotFound = [...text.matchAll(/\b(?:trade|tr)[-_][A-Za-z0-9-]+/g)].map((m) => m[0]).filter((id) => !trades.some((t) => t.id === id));
  for (const id of [...new Set(idsNotFound)]) warnings.push(`text mentions ${id}, which is not in the trades: not linked`);

  const body = text.trim();
  if (body.length > DAILY_REVIEW_TEXT_LIMIT) warnings.push(`observations are ${body.length} characters: truncated to ${DAILY_REVIEW_TEXT_LIMIT}`);
  const points = body
    ? [{ id: `${plan.id}-obs-1`, kind: "observation", text: body.slice(0, DAILY_REVIEW_TEXT_LIMIT), trade_id: null }]
    : [];

  const lessonRaw = typeof plan.lesson === "string" ? plan.lesson.trim() : "";
  if (lessonRaw.length > DAILY_REVIEW_TEXT_LIMIT) warnings.push(`lesson is ${lessonRaw.length} characters: truncated to ${DAILY_REVIEW_TEXT_LIMIT}`);

  const review = {
    id: dailyReviewIdFor(sessionDate, accountId),
    user_id: plan.user_id,
    session_date: sessionDate,
    account_id: accountId,
    trade_ids: tradeIds,
    plan_ids: [], // the legacy plan stays a plan; the review does not re-link it
    points,
    lesson: lessonRaw.slice(0, DAILY_REVIEW_TEXT_LIMIT),
    status: "draft",
    recorded_at: plan.created_at,
  };
  return { review, warnings };
}

/**
 * Dry-run (default) or apply. `commands` must provide:
 *   getPlan(id) -> plan | undefined
 *   listTrades() -> trade[]
 *   findDailyReview(sessionDate, accountId) -> review | undefined   (rule 5: one per scope)
 *   saveDailyReview(review) -> saved review                          (only called with apply: true)
 * The source plan is read, never written.
 */
export async function migratePlanReview(commands, planId, opts = {}) {
  const apply = opts.apply === true;
  const accountId = opts.accountId ?? null;
  const plan = await commands.getPlan(planId);
  if (!plan) return { status: "missing-plan", planId, writes: 0 };

  const trades = await commands.listTrades();
  const { review, warnings } = proposeDailyReviewFromPlan(plan, trades, { accountId });
  const existing = await commands.findDailyReview(review.session_date, accountId);
  if (existing) return { status: "exists", existingId: existing.id, review, warnings, writes: 0 };

  if (!apply) return { status: "dry-run", review, warnings, writes: 0 };
  const saved = await commands.saveDailyReview(review);
  return { status: "applied", review: saved, warnings, writes: 1 };
}

function fixtureCommands(fixture, outPath) {
  const reviews = [...(fixture.daily_reviews ?? [])];
  const plans = fixture.plans ?? [];
  const trades = fixture.trades ?? [];
  return {
    getPlan: async (id) => plans.find((plan) => plan.id === id),
    listTrades: async () => trades,
    findDailyReview: async (sessionDate, accountId) => reviews.find((r) => r.session_date === sessionDate && (r.account_id ?? null) === accountId),
    saveDailyReview: async (review) => {
      reviews.push(review);
      writeFileSync(outPath, `${JSON.stringify({ ...fixture, daily_reviews: reviews }, null, 2)}\n`);
      return review;
    },
  };
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      fixture: { type: "string" },
      plan: { type: "string" },
      account: { type: "string" },
      out: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  if (!values.fixture) {
    console.error("Refusing to run: pass --fixture <file.json>. This script never reads live accounts or /api/v1.");
    return 2;
  }
  if (values.apply && !values.out) {
    console.error("--apply writes only to a fixture copy: pass --out <file.json>. The fixture input is never modified.");
    return 2;
  }
  const fixture = JSON.parse(readFileSync(values.fixture, "utf8"));
  const planId = values.plan ?? "review-2026-11-23";
  const commands = fixtureCommands(fixture, values.out ?? "/dev/null");
  const result = await migratePlanReview(commands, planId, { apply: values.apply, accountId: values.account ?? null });
  console.log(JSON.stringify({ mode: values.apply ? "apply" : "dry-run", ...result }, null, 2));
  return result.status === "missing-plan" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
