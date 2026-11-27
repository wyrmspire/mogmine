// #API-1: the house rules are one source. Every rule id must appear in discovery, the OpenAPI spec (description and
// x-mogmine-house-rules), the guide payload and the setup block, all at the same version. Also the /guide scope rule.
import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_WORKFLOWS, HOUSE_RULES, HOUSE_RULES_VERSION, buildGuidePayload, formatHouseRulesMarkdown } from "../agent/house-rules.ts";
import { buildDiscovery, buildOpenApiSpec, guideUrl, setupBlock, vocabularyUrl } from "../agent/openapi.ts";
import { hasScope, requiredScope } from "../agent/tokens.ts";

const ORIGIN = "https://mogmine.vercel.app";
const EXPECTED_IDS = Array.from({ length: 13 }, (_, i) => `HR-${i + 1}`);
const token = `mmk_${"a".repeat(43)}`;

interface SpecShape {
  info: { description: string };
  "x-mogmine-house-rules": { version: string; guide_url: string; rules: Array<{ id: string; title: string; summary: string }> };
  paths: Record<string, { get?: { operationId?: string; "x-mogmine-scope"?: string }; post?: { description?: string }; patch?: { description?: string } }>;
}

test("house rules: exactly HR-1..HR-13, in order, each with the full field set", () => {
  assert.deepEqual(HOUSE_RULES.map((rule) => rule.id), EXPECTED_IDS);
  for (const rule of HOUSE_RULES) {
    for (const field of ["title", "summary", "rule", "why", "badExample", "goodExample"] as const) {
      assert.ok(rule[field].trim().length > 0, `${rule.id} ${field}`);
    }
  }
});

test("house rules: the four workflows exist in the agreed order, each with steps", () => {
  assert.deepEqual(AGENT_WORKFLOWS.map((workflow) => workflow.id), ["log_trade", "review_day", "plan_session", "pretend_session"]);
  for (const workflow of AGENT_WORKFLOWS) assert.ok(workflow.steps.length > 0, workflow.id);
});

test("house rules: D-A wording states r_size_cents and stated_risk_r directly (HR-6, HR-7)", () => {
  const hr6 = HOUSE_RULES.find((rule) => rule.id === "HR-6");
  const hr7 = HOUSE_RULES.find((rule) => rule.id === "HR-7");
  assert.match(hr6?.rule ?? "", /r_size_cents/);
  assert.match(hr7?.rule ?? "", /stated_risk_r: 0\.25/);
});

test("house rules: no journal text leaks in (the examples are generic)", () => {
  const text = JSON.stringify(HOUSE_RULES) + JSON.stringify(AGENT_WORKFLOWS);
  assert.doesNotMatch(text, /trade-2026/);
  assert.doesNotMatch(text, /\bshowmob\b/i);
  assert.doesNotMatch(text, /mmk_/);
  assert.doesNotMatch(text, /service/i);
});

test("discovery: house_rules_version, guide_url, vocabulary_url and every rule id + summary", () => {
  const discovery = buildDiscovery(ORIGIN, true);
  assert.equal(discovery.house_rules_version, HOUSE_RULES_VERSION);
  assert.equal(discovery.guide_url, "https://mogmine.vercel.app/api/v1/guide");
  assert.equal(discovery.vocabulary_url, "https://mogmine.vercel.app/api/v1/vocabulary");
  const listed = discovery.house_rules as Array<{ id: string; summary: string }>;
  assert.deepEqual(listed.map((rule) => rule.id), EXPECTED_IDS);
  assert.deepEqual(listed.map((rule) => rule.summary), HOUSE_RULES.map((rule) => rule.summary));
});

test("openapi: every rule id is in info.description and in x-mogmine-house-rules at the same version", () => {
  const spec = buildOpenApiSpec(ORIGIN) as unknown as SpecShape;
  for (const id of EXPECTED_IDS) assert.match(spec.info.description, new RegExp(`${id} `), id);
  assert.ok(spec.info.description.includes(formatHouseRulesMarkdown().trim()));
  const extension = spec["x-mogmine-house-rules"];
  assert.equal(extension.version, HOUSE_RULES_VERSION);
  assert.equal(extension.guide_url, "https://mogmine.vercel.app/api/v1/guide");
  assert.deepEqual(extension.rules.map((rule) => rule.id), EXPECTED_IDS);
  assert.deepEqual(extension.rules.map((rule) => Object.keys(rule).sort()), EXPECTED_IDS.map(() => ["id", "summary", "title"]));
});

test("openapi: GET /guide is a read operation named getGuide", () => {
  const spec = buildOpenApiSpec(ORIGIN) as unknown as SpecShape;
  assert.equal(spec.paths["/guide"].get?.operationId, "getGuide");
  assert.equal(spec.paths["/guide"].get?.["x-mogmine-scope"], "read");
});

test("openapi: record writes repeat the rule reminders that apply to them, with the guide URL", () => {
  const spec = buildOpenApiSpec(ORIGIN) as unknown as SpecShape;
  for (const op of [spec.paths["/records/{type}"].post, spec.paths["/records/{type}/{id}"].patch]) {
    const description = op?.description ?? "";
    for (const id of ["HR-1", "HR-2", "HR-3", "HR-4", "HR-5", "HR-7", "HR-9", "HR-10"]) assert.match(description, new RegExp(id), id);
    assert.ok(description.includes(guideUrl(ORIGIN)));
  }
});

test("guide payload: the same version, all thirteen rules, the workflows and the vocabulary URL", () => {
  const payload = buildGuidePayload(`${ORIGIN}/`);
  assert.equal(payload.version, HOUSE_RULES_VERSION);
  assert.deepEqual(payload.rules.map((rule) => rule.id), EXPECTED_IDS);
  assert.deepEqual(payload.workflows.map((workflow) => workflow.id), ["log_trade", "review_day", "plan_session", "pretend_session"]);
  assert.equal(payload.vocabulary_url, vocabularyUrl(ORIGIN));
  assert.equal(payload.vocabulary_url, "https://mogmine.vercel.app/api/v1/vocabulary");
});

test("setup block: points the assistant at the guide before any write", () => {
  assert.ok(setupBlock(ORIGIN, token).includes("Before writing anything, read https://mogmine.vercel.app/api/v1/guide"));
});

test("guide scope: GET needs read; a write-only key is refused; a read key is allowed", () => {
  assert.equal(requiredScope("GET"), "read");
  assert.equal(hasScope(["write"], requiredScope("GET")), false, "write-only key refused (403 path)");
  assert.equal(hasScope(["read"], requiredScope("GET")), true, "read key allowed (200 path)");
  assert.equal(hasScope([], requiredScope("GET")), false, "no scopes refused");
});
