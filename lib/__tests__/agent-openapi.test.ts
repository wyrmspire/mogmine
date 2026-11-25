// #185b: the OpenAPI 3.1 spec and the discovery document (docs/26 §6). The route list is read from the route files, so a
// route added or removed without updating the spec fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { AGENT_API_VERSION, apiBaseUrl, buildDiscovery, buildOpenApiSpec, guideUrl, setupBlock, specUrl } from "../agent/openapi.ts";
import { COLLECTION_KEYS, SINGLETON_KEYS } from "../agent/http.ts";

const ORIGIN = "https://mogmine.vercel.app";
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const ERROR_CODES = ["conflict", "forbidden", "invalid", "not_found", "rate_limited", "unauthenticated", "unavailable", "unknown"];

interface Param { name: string; in: string; schema?: { enum?: string[]; minimum?: number; maximum?: number } }
interface Op { operationId?: string; "x-mogmine-scope"?: string; parameters?: Param[]; responses?: Record<string, { content?: { "application/json"?: { schema?: { $ref?: string } } } }> }
interface Item { parameters?: Param[]; get?: Op; post?: Op; put?: Op; patch?: Op; delete?: Op }
interface Spec {
  openapi: string;
  info: { version: string };
  servers: Array<{ url: string }>;
  components: { securitySchemes: { bearerAuth: { type: string; scheme: string } }; schemas: { Error: { properties: { error: { properties: { code: { enum: string[] } } } } } } };
  security: unknown;
  paths: Record<string, Item>;
}

const spec = buildOpenApiSpec(ORIGIN) as unknown as Spec;
const opsOf = (): Array<[string, string, Op]> =>
  Object.entries(spec.paths).flatMap(([route, item]) => METHODS.filter((m) => item[m] !== undefined).map((m) => [m.toUpperCase(), route, item[m] as Op] as [string, string, Op]));

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

const API = path.join(process.cwd(), "app/api/v1");
const ROUTE_PAIRS = ["candles", "checks", "guide", "levels", "me", "records", "singletons", "strategy-lab", "vocabulary"]
  .flatMap((group) => routeFiles(path.join(API, group)))
  .flatMap((file) => {
    const rel = path.relative(API, path.dirname(file)).split(path.sep).join("/");
    const apiPath = `/${rel.replace(/\[(\w+)\]/g, "{$1}")}`;
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)].map((match) => `${match[1]} ${apiPath}`);
  })
  .sort();

test("spec: OpenAPI 3.1.0, version and server URL from the origin (with and without a trailing slash)", () => {
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.version, AGENT_API_VERSION);
  assert.equal(spec.servers[0].url, "https://mogmine.vercel.app/api/v1");
  assert.equal((buildOpenApiSpec(`${ORIGIN}/`) as unknown as Spec).servers[0].url, "https://mogmine.vercel.app/api/v1");
  assert.equal(apiBaseUrl(`${ORIGIN}///`), "https://mogmine.vercel.app/api/v1");
  assert.equal(specUrl(ORIGIN), "https://mogmine.vercel.app/api/v1/openapi.json");
});

test("spec: bearer auth is declared and applied to every operation by default", () => {
  assert.deepEqual(spec.components.securitySchemes.bearerAuth, { type: "http", scheme: "bearer", description: "Agent key mmk_… from MogMine → Agent keys" });
  assert.deepEqual(spec.security, [{ bearerAuth: [] }]);
});

test("spec: the (path, method) pairs are exactly the methods the route files export", () => {
  assert.equal(ROUTE_PAIRS.length, 16, "sanity: the v1 surface has sixteen operations");
  const specPairs = opsOf().map(([method, route]) => `${method} ${route}`).sort();
  assert.deepEqual(specPairs, ROUTE_PAIRS);
});

test("spec: operationIds are unique camelCase and exactly the agreed set", () => {
  const ids = opsOf().map(([, , op]) => op.operationId as string);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), ["archiveRecord", "checkTrade", "createRecord", "deleteRecord", "getCandles", "getGuide", "getLevels", "getMe", "getRecord", "getSingleton", "getStrategyLabSkills", "getVocabulary", "listRecords", "postStrategyLabContext", "putSingleton", "updateRecord"]);
});

test("spec: path enums come from the registry constants (type excludes candles, key lists the singletons)", () => {
  const typeItem = spec.paths["/records/{type}"];
  const typeParam = typeItem.parameters?.find((p) => p.name === "type");
  assert.deepEqual(typeParam?.schema?.enum, [...COLLECTION_KEYS]);
  const typeValues: readonly string[] = typeParam?.schema?.enum ?? [];
  assert.equal(typeValues.includes("candles"), false);
  const keyParam = spec.paths["/singletons/{key}"].parameters?.find((p) => p.name === "key");
  assert.deepEqual(keyParam?.schema?.enum, [...SINGLETON_KEYS]);
  for (const [route, item] of Object.entries(spec.paths)) {
    if (route.includes("{type}")) assert.deepEqual(item.parameters?.find((p) => p.name === "type")?.schema?.enum, [...COLLECTION_KEYS], route);
  }
});

// These POSTs compute answers without writing, so they require read scope.
const READ_SCOPE_POSTS = new Set(["POST /checks/trade", "POST /strategy-lab/context"]);

test("spec: every GET is read scope and every other method is write scope except read-only computation POSTs", () => {
  for (const [method, route, op] of opsOf()) {
    const readScope = method === "GET" || READ_SCOPE_POSTS.has(`${method} ${route}`);
    assert.equal(op["x-mogmine-scope"], readScope ? "read" : "write", `${method} ${route}`);
  }
  assert.equal(READ_SCOPE_POSTS.size, 2, "the exception list stays limited to documented read-only computations");
});

test("spec: list query parameters and limit bounds", () => {
  const list = spec.paths["/records/{type}"].get as Op;
  const names = (list.parameters ?? []).map((p) => p.name).sort();
  assert.deepEqual(names, [
    "account_id", "from", "include", "includeArchived", "includeSamples", "limit", "parentId", "playbook_id", "session_date", "to",
  ]);
  const limit = (list.parameters ?? []).find((p) => p.name === "limit");
  assert.deepEqual(limit?.schema && { minimum: limit.schema.minimum, maximum: limit.schema.maximum }, { minimum: 1, maximum: 500 });
});

test("spec: success and error responses use the shared envelopes; error codes are exactly the API's codes", () => {
  for (const [method, route, op] of opsOf()) {
    const responses = op.responses ?? {};
    const success = Object.keys(responses).filter((code) => code.startsWith("2"));
    assert.equal(success.length, 1, `${method} ${route} has one success response`);
    assert.equal(responses[success[0]].content?.["application/json"]?.schema?.$ref, "#/components/schemas/Ok");
    for (const code of Object.keys(responses).filter((c) => !c.startsWith("2"))) {
      assert.equal(responses[code].content?.["application/json"]?.schema?.$ref, "#/components/schemas/Error", `${method} ${route} ${code}`);
    }
  }
  assert.deepEqual([...spec.components.schemas.Error.properties.error.properties.code.enum].sort(), ERROR_CODES);
});

test("spec: JSON-serialisable, no user data, no key-shaped string, no token hash, no service-role wording", () => {
  const text = JSON.stringify(spec);
  assert.deepEqual(JSON.parse(text), spec);
  assert.doesNotMatch(text, /mmk_[A-Za-z0-9_-]{43}/);
  assert.equal(text.includes("token_hash"), false);
  assert.doesNotMatch(text, /service/i);
});

test("discovery: base URL, spec URL, bearer auth, scopes, version and the enabled flag", () => {
  const on = buildDiscovery(`${ORIGIN}/`, true);
  assert.equal(on.base_url, "https://mogmine.vercel.app/api/v1");
  assert.equal(on.openapi_url, "https://mogmine.vercel.app/api/v1/openapi.json");
  assert.equal((on.auth as { type: string }).type, "bearer");
  assert.equal(on.enabled, true);
  assert.equal(on.version, AGENT_API_VERSION);
  assert.match(String(on.docs), /^Create a key at https:\/\/mogmine\.vercel\.app\/settings\/agent$/);
  assert.equal(buildDiscovery(ORIGIN, false).enabled, false);
});

test("setupBlock: exact text, guide line, base URL and key on their own lines", () => {
  const token = `mmk_${"a".repeat(43)}`;
  assert.equal(guideUrl(ORIGIN), "https://mogmine.vercel.app/api/v1/guide");
  assert.equal(
    setupBlock(ORIGIN, token),
    [
      "MogMine agent API",
      "Base URL: https://mogmine.vercel.app/api/v1",
      "OpenAPI spec: https://mogmine.vercel.app/api/v1/openapi.json",
      "Before writing anything, read https://mogmine.vercel.app/api/v1/guide",
      `Auth header: Authorization: Bearer ${token}`,
      `Agent key: ${token}`,
    ].join("\n"),
  );
});

test("spec: vocabulary is a read operation, and include=derived is documented on record reads and lists", () => {
  const vocabulary = spec.paths["/vocabulary"].get as Op;
  assert.equal(vocabulary["x-mogmine-scope"], "read");
  assert.equal(vocabulary.operationId, "getVocabulary");
  const read = spec.paths["/records/{type}/{id}"].get as Op;
  const include = (read.parameters ?? []).find((p) => p.name === "include");
  assert.deepEqual(include?.schema?.enum, ["derived"]);
  const list = spec.paths["/records/{type}"].get as Op;
  const sessionDate = (list.parameters ?? []).find((p) => p.name === "session_date") as unknown as { schema?: { format?: string } } | undefined;
  assert.equal(sessionDate?.schema?.format, "date");
});

test("spec: trade writes document the 422 refusals and the non-blocking warnings (#API-2b)", () => {
  const ok = spec.components as unknown as { schemas: { Ok: { properties: { warnings: { type: string; items: { required: string[] } } } } } };
  const warnings = ok.schemas.Ok.properties.warnings;
  assert.equal(warnings.type, "array");
  assert.deepEqual(warnings.items.required, ["code", "message"]);
  const create = spec.paths["/records/{type}"].post as unknown as { description: string; responses: Record<string, unknown> };
  assert.match(create.description, /quick_tags value is not in the vocabulary/);
  assert.match(create.description, /more than 5 minutes in the future/);
  assert.match(create.description, /warnings/);
  assert.ok(Object.keys(create.responses).includes("422"));
});
