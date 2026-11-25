// #185b: the public discovery surface for the agent API. Pure: no SDK, no React, no Next. Nothing here reads data; the
// spec describes the routes in app/api/v1 and the discovery document says where they are. The route files import this.
import { COLLECTION_KEYS, SINGLETON_KEYS } from "./http.ts";
import type { AgentErrorCode } from "./http.ts";
import { HOUSE_RULES, HOUSE_RULES_VERSION, formatHouseRulesMarkdown } from "./house-rules.ts";

export const AGENT_API_VERSION = "1.0.0";

/** Every error code the API can return, with its status. `satisfies` fails to compile if a code is missing or unknown. */
const ERROR_CODES = {
  not_found: 404,
  conflict: 409,
  invalid: 422,
  unauthenticated: 401,
  forbidden: 403,
  unavailable: 503,
  unknown: 500,
  rate_limited: 429,
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

export function apiBaseUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/v1`;
}

export function specUrl(origin: string): string {
  return `${apiBaseUrl(origin)}/openapi.json`;
}

/** GET /api/v1/guide: the house rules with examples, and the workflows. Read before writing anything. */
export function guideUrl(origin: string): string {
  return `${apiBaseUrl(origin)}/guide`;
}

/** GET /api/v1/vocabulary: the names agents may use (playbooks, tags, accounts). Advertised here; built in API-2a. */
export function vocabularyUrl(origin: string): string {
  return `${apiBaseUrl(origin)}/vocabulary`;
}

/** Rule reminders repeated on record writes, so an agent meets the rules that matter where it writes (07 §2.1 item 2). */
const writeRuleReminder = (origin: string) =>
  "House rules to follow on this write: HR-1 notes are commentary only; HR-2 verify fill times against 1-minute candles; " +
  "HR-3 vocabulary names only; HR-4 stop moves carry times; HR-5 exit_reason must match the exit price; " +
  "HR-7 keep stated_risk_r as the trader said it; HR-9 daily reviews go in daily_reviews; HR-10 never write derived values. " +
  `Read the full rules at ${guideUrl(origin)}.`;

/** Trade writes (#API-2b): refusals are 422, and the saved trade's response carries non-blocking `warnings`. */
const TRADE_WRITE_NOTE =
  " Trades: refused with 422 when playbook_id or account_id is not the owner's (the message lists the valid ones), " +
  "when a quick_tags value is not in the vocabulary, when entry_time or exit_time is more than 5 minutes in the future, " +
  "or when risk_cents differs from the computed value. Saved trades also return `warnings` (never blocking): " +
  "playbook_missing, setup_tag_missing, notes_restate_fields (HR-1), stop_moved_without_time (HR-4), " +
  "exit_reason_mismatch (HR-5), stated_risk_differs (HR-7), price_out_of_range (only when cached bars exist).";

const ERROR_ENUM = Object.keys(ERROR_CODES);

const typeParam = {
  name: "type",
  in: "path",
  required: true,
  description: "The collection (journal record type).",
  schema: { type: "string", enum: [...COLLECTION_KEYS] },
};

const keyParam = {
  name: "key",
  in: "path",
  required: true,
  description: "The singleton document.",
  schema: { type: "string", enum: [...SINGLETON_KEYS] },
};

const idParam = {
  name: "id",
  in: "path",
  required: true,
  description: "The record id, URL-encoded (ids may contain `:`).",
  schema: { type: "string" },
};

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
          type: "object",
          required: ["ok", "data"],
          properties: {
            ok: { const: true },
            data: { description: "The record, list or document (see the operation)." },
            warnings: {
              type: "array",
              description: "Trade writes only. Non-blocking warnings about the saved trade; empty when there are none.",
              items: {
                type: "object",
                required: ["code", "message"],
                properties: { code: { type: "string" }, message: { type: "string" } },
              },
            },
          },
        },
        Error: {
          type: "object",
          required: ["ok", "error"],
          properties: {
            ok: { const: false },
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string", enum: ERROR_ENUM },
                message: { type: "string", description: "Plain-language message, safe to show." },
              },
            },
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
          success: { status: 200, description: "The stored document." }, errors: [...ERROR_STATUSES_WRITE, 404],
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
