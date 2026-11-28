// #185b: the public discovery surface for the agent API. Pure: no SDK, no React, no Next. Nothing here reads data; the
// spec describes the routes in app/api/v1 and the discovery document says where they are. The route files import this.
import { COLLECTION_KEYS, SINGLETON_KEYS } from "./http.ts";
import type { AgentErrorCode } from "./http.ts";
import { HOUSE_RULES, HOUSE_RULES_VERSION, formatHouseRulesMarkdown } from "./house-rules.ts";

export const AGENT_API_VERSION = "1.0.0";

/** Every error code the API can return, with its status. `satisfies` fails to compile if a code is missing or unknown. */
const ERROR_CODES = {
  not_found: 404, conflict: 409, invalid: 422, unauthenticated: 401,
  forbidden: 403, unavailable: 503, unknown: 500, rate_limited: 429,
} as const satisfies Record<AgentErrorCode, number>;

const STATUS_TEXT: Record<number, string> = {
  400: "The body is not JSON.",
  401: "No valid agent key, or the key was revoked.",
  403: "The key lacks the scope this request needs, or the command layer refused the change.",
  404: "No such record, or no such collection or singleton.",
  409: "The record clashes with another one (a conflict).",
  413: "The body is larger than 256 KB.",
  422: "The record failed validation. Nothing was saved.",
  429: "Too many requests from this key. Wait for Retry-After seconds.",
  500: "Something went wrong on the server.",
  503: "The agent API is off on this deployment, or storage is unavailable.",
};

const ERROR_STATUSES_READ = [401, 403, 429, 500, 503];
const ERROR_STATUSES_WRITE = [400, 401, 403, 413, 422, 429, 500, 503];

export const apiBaseUrl = (origin: string): string => `${origin.replace(/\/+$/, "")}/api/v1`;
export const specUrl = (origin: string): string => `${apiBaseUrl(origin)}/openapi.json`;
/** GET /api/v1/guide: the house rules with examples, and the workflows. Read before writing anything. */
export const guideUrl = (origin: string): string => `${apiBaseUrl(origin)}/guide`;
/** GET /api/v1/vocabulary: the names agents may use (playbooks, tags, accounts). Advertised here; built in API-2a. */
export const vocabularyUrl = (origin: string): string => `${apiBaseUrl(origin)}/vocabulary`;

/** Rule reminders repeated on record writes, so an agent meets the rules that matter where it writes (07 §2.1 item 2). */
const writeRuleReminder = (origin: string) =>
  "House rules to follow on this write: HR-1 notes are commentary only (note = 1-line Pit Stop takeaway, pre_trade_thesis = pre-entry why, management_notes = in-trade decisions, post_exit_notes = reflection/lesson); " +
  "HR-2 verify fill times against 1-minute candles; HR-3 vocabulary names only; HR-4 timed stop moves carry times (unknown move times stay empty stop_moves = untimed); " +
  "HR-5 stop and trail mean the working stop triggered (the fill may slip); HR-6 $300 (30000 cents) is the standard R unit and whole-micro ceiling rounding is expected; " +
  "HR-7 keep stated_risk_r as the trader said it; HR-9 daily reviews go in daily_reviews; HR-10 never write derived values. " +
  `Read the full rules at ${guideUrl(origin)}.`;

/** Trade writes (#API-2b): refusals are 422, and the saved trade's response carries non-blocking `warnings`. */
const TRADE_WRITE_NOTE =
  " Trades: refused with 422 when playbook_id or account_id is not the owner's (the message lists the valid ones), " +
  "when a quick_tags value is not in the vocabulary, when entry_time or exit_time is more than 5 minutes in the future, " +
  "or when risk_cents differs from the computed value. Saved trades also return `warnings` (never blocking): " +
  "playbook_missing, setup_tag_missing, stated_risk_missing, notes_restate_fields (HR-1), notes_duplicate_thesis (HR-1), " +
  "notes_restate_exit_reason (HR-1), stop_moved_without_time (HR-4), exit_reason_mismatch (HR-5), stated_risk_differs (HR-7), " +
  "price_out_of_range (only when cached bars exist). See components.schemas.TradeRecord for note-field roles.";

const ERROR_ENUM = Object.keys(ERROR_CODES);
const idempotencyParam = { name: "Idempotency-Key", in: "header", required: false, description: "Send on every create: 1–128 visible ASCII characters, new for each record. Reuse it when retrying, and the first response is returned instead of a second record.", schema: { type: "string", maxLength: 128 } };
const ifMatchParam = { name: "If-Match", in: "header", required: false, description: "Send on every update: the meta.updated_at from your last read. If the stored version differs, the write is refused with 409.", schema: { type: "string" } };
const typeParam = { name: "type", in: "path", required: true, description: "The collection (journal record type).", schema: { type: "string", enum: [...COLLECTION_KEYS] } };
const keyParam = { name: "key", in: "path", required: true, description: "The singleton document.", schema: { type: "string", enum: [...SINGLETON_KEYS] } };
const idParam = { name: "id", in: "path", required: true, description: "The record id, URL-encoded (ids may contain `:`).", schema: { type: "string" } };

/** `?include=derived` on trades and accounts. The block is computed on read and never stored (docs/07 §3.5). */
const includeParam = {
  name: "include",
  in: "query",
  required: false,
  schema: { type: "string", enum: ["derived"] },
  description:
    "`derived` adds a `derived` block, computed on read and never stored. On trades: pnl_cents, result_r (gross P&L ÷ R size), " +
    "risk_cents, risk_r, r_size_cents, r_size_source, stated_risk_r, hold_seconds (null while open), session_date. On accounts: " +
    "balance_cents, realized_cents, adjustments_cents, drawdown_cents, closed_trades, open_trades, from_journal_gross. " +
    "Other collections ignore it.",
};

const listParams = [
  { name: "includeSamples", in: "query", required: false, schema: { type: "boolean" }, description: "Include sample (fixture) rows. Default false." },
  { name: "includeArchived", in: "query", required: false, schema: { type: "boolean" }, description: "Include archived rows. Default false." },
  { name: "parentId", in: "query", required: false, schema: { type: "string" }, description: "Only children of this parent record." },
  { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 100 }, description: "Rows to return (1 to 500)." },
  includeParam,
  {
    name: "session_date", in: "query", required: false, schema: { type: "string", format: "date" },
    description: "Trades: the trading day of the entry (18:00 ET rollover). Plans: the plan's session date. YYYY-MM-DD; malformed is 422.",
  },
  {
    name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" },
    description: "Trades only: entry time at or after this instant. ISO-8601 with a zone (for example 2026-11-23T14:00:00Z); malformed is 422.",
  },
  {
    name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" },
    description: "Trades only: entry time at or before this instant. ISO-8601 with a zone; malformed is 422.",
  },
  { name: "account_id", in: "query", required: false, schema: { type: "string" }, description: "Trades only: trades on this account." },
  { name: "playbook_id", in: "query", required: false, schema: { type: "string" }, description: "Trades only: trades filed under this playbook." },
];

/** Filters are applied after the read, so `limit` counts matching rows. A filter a collection does not support is 422. */
const FILTER_NOTE = " Filters: `session_date`, `from`, `to`, `account_id`, `playbook_id` (trades); `session_date` (plans).";

function ok(description: string) {
  return { description, content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } };
}

function errorResponses(statuses: number[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const status of statuses) {
    out[String(status)] = {
      description: STATUS_TEXT[status],
      content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
    };
  }
  return out;
}

const jsonBody = (description: string) => ({
  required: true,
  description,
  content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
});

interface OpInput {
  operationId: string;
  summary: string;
  scope: "read" | "write";
  description?: string;
  success: { status: 200 | 201; description: string };
  errors: number[];
  parameters?: unknown[];
  requestBody?: unknown;
}

function operation(input: OpInput): Record<string, unknown> {
  const op: Record<string, unknown> = {
    operationId: input.operationId,
    summary: input.summary,
    ...(input.description ? { description: input.description } : {}),
    "x-mogmine-scope": input.scope,
    responses: {
      [String(input.success.status)]: ok(input.success.description),
      ...errorResponses(input.errors),
    },
  };
  if (input.parameters) op.parameters = input.parameters;
  if (input.requestBody) op.requestBody = input.requestBody;
  return op;
}

export function buildOpenApiSpec(origin: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "MogMine Agent API",
      version: AGENT_API_VERSION,
      description:
        "Each request acts as the owner of the agent key. A key has read scope, write scope, or both: GET needs read, " +
        "every other method needs write. Records are the journal types listed in the `type` parameter. Record ids are " +
        "strings the client generates. Never send derived fields (such as PnL, R or ticks): the server computes them." +
        formatHouseRulesMarkdown(),
    },
    "x-mogmine-house-rules": {
      version: HOUSE_RULES_VERSION,
      guide_url: guideUrl(origin),
      rules: HOUSE_RULES.map(({ id, title, summary }) => ({ id, title, summary })),
    },
    servers: [{ url: apiBaseUrl(origin) }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Agent key mmk_… from MogMine → Agent keys",
        },
      },
      schemas: {
        Ok: {
          type: "object", required: ["ok", "data"],
          properties: {
            ok: { const: true },
            data: { description: "The record, list or document (see the operation)." },
            warnings: {
              type: "array", description: "Trade writes only. Non-blocking warnings about the saved trade; empty when there are none.",
              items: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } },
            },
          },
        },
        Error: {
          type: "object", required: ["ok", "error"],
          properties: {
            ok: { const: false },
            error: {
              type: "object", required: ["code", "message"],
              properties: { code: { type: "string", enum: ERROR_ENUM }, message: { type: "string", description: "Plain-language message, safe to show." } },
            },
          },
        },
        Account: {
          type: "object",
          description: "Trading account shape for /records/accounts. Use mode \"replay\" for pretend / bar-replay sessions so replay trades stay isolated from real running stats and Drawdown Defender.",
          required: ["id", "name", "starting_balance_cents"],
          properties: {
            id: { type: "string" },
            name: { type: "string", example: "Pretend Replay" },
            mode: {
              type: "string",
              enum: ["eval", "live", "sim", "replay"],
              default: "eval",
              description: "Account mode. Defaults to \"eval\" when omitted; \"replay\" isolates pretend/bar-replay sessions.",
            },
            starting_balance_cents: { type: "integer", description: "Whole cents.", example: 5000000 },
            r_size_cents: { type: "integer", nullable: true, description: "Fixed 1R dollar unit in whole cents (standard $300 = 30000).", example: 30000 },
            archived: { type: "boolean", default: false },
            created_at: { type: "string", format: "date-time" },
            rules: {
              type: "object",
              properties: {
                max_loss_cents: { type: "integer", nullable: true },
                drawdown: { type: "string", enum: ["static", "trailing", "trailing_eod"], default: "trailing" },
                daily_loss_cents: { type: "integer", nullable: true },
                profit_target_cents: { type: "integer", nullable: true },
              },
            },
          },
        },
        TradeRecord: {
          type: "object",
          description:
            "Journal trade shape for /records/trades and /checks/trade. Commentary-only note fields (HR-1): never restate prices, " +
            "stop distance, contract count, dollar risk, R, or exit_reason. Standard R unit is $300 (r_size_cents = 30000); " +
            "whole-micro ceiling rounding up by less than 1 micro over target is expected (HR-6).",
          properties: {
            note: { type: "string", description: "Short 1-line Pit Stop takeaway shown on cards/feed (optional; never duplicate pre_trade_thesis).", example: "Clean ONL reclaim, slightly early entry." },
            pre_trade_thesis: { type: "string", description: "Pre-entry reasoning — why this setup was worth taking before entry.", example: "VWAP reclaim after ONL sweep held higher low against 15m demand." },
            management_notes: { type: "string", description: "Decisions made during the trade (holds, trails, scratches, hesitation).", example: "Held through mid-bar chop; trailed under higher swing low once momentum expanded." },
            post_exit_notes: { type: "string", description: "Post-exit reflection/lesson — what to repeat or change next time (never restate exit_reason, prices, contracts, or R).", example: "Wait for 1m close above the reclaim level next time instead of anticipating." },
            stop_moves: {
              type: "array",
              description: "Timed stop updates [{ price, time }] (UTC ISO-8601 inside the hold). Leave empty with initial_stop_price != stop_loss_price when the exact move minute is unknown (treated as \"untimed\"); never fabricate an exit-time move (HR-4).",
              items: { type: "object", required: ["price", "time"], properties: { price: { type: "number" }, time: { type: "string", format: "date-time" } } },
            },
            stated_risk_r: { type: "number", nullable: true, description: "Trader's stated target risk in R (e.g. 0.25) against the account's r_size_cents (standard $300 = 30000 cents). Whole-micro ceiling rounding is expected (HR-6, HR-7).", example: 0.25 },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/me": {
        get: operation({
          operationId: "getMe", summary: "The owner and scopes behind this key", scope: "read",
          success: { status: 200, description: "The owner id and the key's scopes." }, errors: ERROR_STATUSES_READ,
        }),
      },
      "/guide": {
        get: operation({
          operationId: "getGuide", summary: "The house rules and workflows (read before writing)", scope: "read",
          success: { status: 200, description: "The house rules with examples, the workflows and the vocabulary URL." },
          errors: ERROR_STATUSES_READ,
        }),
      },
      "/records/{type}": {
        parameters: [typeParam],
        get: operation({
          operationId: "listRecords", summary: "List records in a collection", scope: "read",
          description: "Records, newest first. With `?include=derived` each row gains `derived`." + FILTER_NOTE,
          success: { status: 200, description: "An array of records (each with `derived` when asked)." },
          errors: [...ERROR_STATUSES_READ, 404, 422],
          parameters: listParams,
        }),
        post: operation({
          operationId: "createRecord", summary: "Create a record", scope: "write", description: writeRuleReminder(origin) + TRADE_WRITE_NOTE,
          success: { status: 201, description: "The stored record. Trades add `warnings` (possibly empty)." }, errors: [...ERROR_STATUSES_WRITE, 404, 409],
          requestBody: jsonBody("The full record, with a client-generated `id`. Derived fields are refused."),
          parameters: [idempotencyParam],
        }),
      },
      "/records/{type}/{id}": {
        parameters: [typeParam, idParam],
        get: operation({
          operationId: "getRecord", summary: "Read one record", scope: "read",
          success: { status: 200, description: "The record, or `{ record, meta, derived }` with `?include=derived`." },
          errors: [...ERROR_STATUSES_READ, 404],
          parameters: [includeParam],
        }),
        patch: operation({
          operationId: "updateRecord", summary: "Change some fields of a record", scope: "write", description: writeRuleReminder(origin) + TRADE_WRITE_NOTE,
          success: { status: 200, description: "The stored record. Trades add `warnings` (possibly empty)." }, errors: [...ERROR_STATUSES_WRITE, 404, 409],
          requestBody: jsonBody("The fields to change. Other fields keep their values."),
          parameters: [ifMatchParam],
        }),
        delete: operation({
          operationId: "deleteRecord", summary: "Delete one record", scope: "write",
          success: { status: 200, description: "`null` once the record is removed." }, errors: [...ERROR_STATUSES_WRITE, 404],
        }),
      },
      "/vocabulary": {
        get: operation({
          operationId: "getVocabulary",
          summary: "The names to use: playbooks, setup and execution tags, accounts with R sizes, symbols, exit reasons, plan presets, time rules",
          description:
            "Read this before naming a playbook or a tag. Playbooks are the owner's live list (active first; archived are flagged). " +
            "Setup tags are not playbooks. Accounts are active only, each with its resolved r_size_cents and r_size_source.",
          scope: "read",
          success: { status: 200, description: "The vocabulary, with house_rules_version." },
          errors: ERROR_STATUSES_READ,
        }),
      },
      "/candles": {
        get: operation({
          operationId: "getCandles",
          summary: "Cleaned 1m, 5m or 15m bars for a window, with Central Time labels and coverage",
          description:
            "symbol MES, MNQ or another supported contract (MES reads MES=F, never ES=F). from and to are ISO times with a zone, " +
            "from before to. The window is at most 26 hours for 1m and 7 days for 5m and 15m (422 otherwise). Each bar has time (UTC ms), " +
            "iso, ct (Central Time, e.g. \"14:13\"), open, high, low, close, volume. Bars with null or NaN prices, a range that does not hold " +
            "open and close, or a time outside the window are dropped. A future window is 200 with no bars and reason \"future\"; a window " +
            "with no regular trading time (a weekend) is 200 with no bars and reason \"closed\". coverage: expected bars, present bars, and gaps " +
            "(runs of missing expected bars). Upstream Yahoo calls are capped at 15 a minute per key (429 when exceeded); cache hits are free. " +
            "Nothing is stored.",
          scope: "read",
          parameters: [
            { name: "symbol", in: "query", required: true, schema: { type: "string", example: "MES" } },
            { name: "from", in: "query", required: true, schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", required: true, schema: { type: "string", format: "date-time" } },
            { name: "timeframe", in: "query", schema: { type: "string", enum: ["1m", "5m", "15m"], default: "1m" } },
          ],
          success: { status: 200, description: "The bars, ticker, provider, coverage and reason (when set)." },
          errors: [...ERROR_STATUSES_READ, 422],
        }),
      },
      "/strategy-lab/skills": {
        get: operation({
          operationId: "getStrategyLabSkills", summary: "List the Strategy Lab skills: id, version, kind, params, outputs, needs", scope: "read",
          success: { status: 200, description: "skills: the registry metadata (no bars are read)." }, errors: ERROR_STATUSES_READ,
        }),
      },
      "/strategy-lab/context": {
        post: operation({
          operationId: "postStrategyLabContext", summary: "Context Card for one MES mark, every value computed by the server (read scope)", scope: "read",
          description: "Body: { symbol: \"MES\", time (ISO-8601 with zone, floored to the minute, not in the future), price (multiple of 0.25), side: long|short, account_id? }. R is the account's fixed R size. Facts after the mark are in after-mark rows only.",
          requestBody: jsonBody("{ symbol, time, price, side, account_id? }"),
          success: { status: 200, description: "state, card (header, basis, groups of rows, missing) and provenance." },
          errors: [...ERROR_STATUSES_READ, 422],
        }),
      },
      "/levels": {
        get: operation({
          operationId: "getLevels",
          summary: "Session levels, planned levels and Session VWAP as they stood at as_of (point-in-time, nothing stored)",
          description:
            "symbol MES or MNQ (MES reads MES=F). session_date is the trading day (YYYY-MM-DD). as_of is an ISO time with a zone, not in " +
            "the future; it defaults to now. Only 1m bars that had closed by as_of are used, so nothing after it can leak in. " +
            "computed: the LV-1 levels (PDH, PDL, RTH open/high/low, 3 PM close, Globex open, ONH, ONL, week high and low), each with " +
            "value, formed_at and the coverage of its window. withheld: each candle level that cannot be stated yet, with a reason " +
            "(gaps, no-bars, not-loaded, needs-1m, not-yet) and missing_bars; a withheld level has no value. PDC, pivots and ADR are not " +
            "computed here (no settlement or ADR input is loaded). session_so_far: today's RTH high and low up to as_of. planned: the " +
            "owner's plan levels for the date as they stood at as_of, with plan_id, plan_name, revision_id (null when the current levels " +
            "were in force) and role (level, zone_low or zone_high). vwap.rth: Session VWAP from 09:30 ET, strict (approximate is always " +
            "false). vwap.globex: VWAP from 18:00 ET, approximate true when small overnight gaps were tolerated (at most 3% of expected " +
            "bars, a single gap of at most 15 minutes, none after 09:30 ET). A value is null with unavailable_reason not-yet or gaps. " +
            "provenance: provider, timeframe, levels_calc_version (lv-1), indicators_calc_version, as_of and session_date. " +
            "Upstream Yahoo calls share the candle limit (429 when exceeded). Nothing is stored.",
          scope: "read",
          parameters: [
            { name: "symbol", in: "query", required: true, schema: { type: "string", enum: ["MES", "MNQ"] } },
            { name: "session_date", in: "query", required: true, schema: { type: "string", format: "date", example: "2026-11-25" } },
            { name: "as_of", in: "query", schema: { type: "string", format: "date-time" } },
          ],
          success: { status: 200, description: "computed, withheld, session_so_far, planned, vwap and provenance." },
          errors: [...ERROR_STATUSES_READ, 422],
        }),
      },
      "/checks/trade": {
        post: operation({
          operationId: "checkTrade",
          summary: "Check a draft (or stored) trade against the 1m bars before saving: fills, stop moves, findings, warnings and R",
          description:
            "Read scope although it is a POST: it writes nothing and has a generous pre-flight rate limit, so call it as often as needed (HR-2). " +
            "Body: a draft trade in the create shape (see TradeRecord), or { \"id\": \"…\" } for a stored trade. Each fill is matched within 5 minutes " +
            "(match: stated, shifted, outside, no-bars); a shifted fill carries matched (UTC ISO), offset_min and a message to ask the trader. " +
            "stop_moves are checked against the hold and tick grid (leave stop_moves empty when the move minute is unknown so it stays \"untimed\", HR-4). " +
            "findings come from the post-entry bar check (the entry bar is never inside the hold). warnings are the non-blocking write checks (including note hygiene). " +
            "refusal is the message a save would be refused with, or null. derived gives risk_cents, risk_r, result_r, r_size_cents (standard $300 = 30000 cents; " +
            "whole-micro ceiling rounding up by <1 micro is expected, HR-6), r_size_source and stated_risk_r. The window is the trade's 1m bars from 10 minutes before the entry to 10 minutes after the exit (or the entry, when open).",
          scope: "read",
          requestBody: jsonBody("A draft trade (the create shape), or { \"id\": \"…\" } for a stored trade."),
          success: { status: 200, description: "fills, stop_moves, findings, warnings, refusal, derived and window." },
          errors: [...ERROR_STATUSES_READ, 404, 422],
        }),
      },
      "/records/{type}/{id}/archive": {
        parameters: [typeParam, idParam],
        post: operation({
          operationId: "archiveRecord", summary: "Archive a record (accounts and playbooks only)", scope: "write",
          success: { status: 200, description: "The archived record." }, errors: [...ERROR_STATUSES_WRITE, 404],
        }),
      },
      "/singletons/{key}": {
        parameters: [keyParam],
        get: operation({
          operationId: "getSingleton", summary: "Read a singleton document", scope: "read",
          success: { status: 200, description: "The document, or its default when none is saved." }, errors: [...ERROR_STATUSES_READ, 404],
        }),
        put: operation({
          operationId: "putSingleton", summary: "Replace a singleton document", scope: "write",
          success: { status: 200, description: "The stored document." }, errors: [...ERROR_STATUSES_WRITE, 404, 409],
          parameters: [ifMatchParam],
          requestBody: jsonBody("The whole document. It replaces the saved one."),
        }),
      },
    },
  };
}

export function buildDiscovery(origin: string, enabled: boolean): Record<string, unknown> {
  const base = origin.replace(/\/+$/, "");
  return {
    name: "MogMine",
    version: AGENT_API_VERSION,
    enabled,
    base_url: apiBaseUrl(origin),
    openapi_url: specUrl(origin),
    auth: { type: "bearer", header: "Authorization", format: "Bearer mmk_<43 chars>" },
    house_rules_version: HOUSE_RULES_VERSION,
    guide_url: guideUrl(origin),
    vocabulary_url: vocabularyUrl(origin),
    house_rules: HOUSE_RULES.map((rule) => ({ id: rule.id, summary: rule.summary })),
    scopes: {
      read: "Read records, singletons and /me (GET requests).",
      write: "Create, change, archive and delete records, and replace singletons. Write does not include read.",
    },
    docs: `Create a key at ${base}/settings/agent`,
  };
}

/** The copy-ready block for an assistant, a Custom GPT Action or an MCP config. `token` is the plaintext key (shown once). */
export function setupBlock(origin: string, token: string): string {
  return [
    "MogMine agent API",
    `Base URL: ${apiBaseUrl(origin)}`,
    `OpenAPI spec: ${specUrl(origin)}`,
    `Before writing anything, read ${guideUrl(origin)}`,
    `Auth header: Authorization: Bearer ${token}`,
    `Agent key: ${token}`,
  ].join("\n");
}
