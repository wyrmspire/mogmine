// #185a: agent key format, hashing, bearer parsing and scopes (lib/agent/tokens.ts). Pure, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AGENT_TOKEN_PATTERN, generateAgentToken, hasScope, hashAgentToken, parseBearer, requiredScope,
} from "../agent/tokens.ts";

test("generateAgentToken: mmk_ plus 43 base64url characters, prefix is the first 12", () => {
  const { token, prefix } = generateAgentToken();
  assert.match(token, AGENT_TOKEN_PATTERN);
  assert.equal(token.length, 47);
  assert.equal(prefix, token.slice(0, 12));
  assert.match(prefix, /^mmk_[A-Za-z0-9_-]{8}$/);
});

test("generateAgentToken: two tokens differ", () => {
  const seen = new Set(Array.from({ length: 50 }, () => generateAgentToken().token));
  assert.equal(seen.size, 50);
});

test("hashAgentToken: lowercase hex SHA-256 of the full token string", async () => {
  const token = `mmk_${"A".repeat(43)}`;
  const expected = createHash("sha256").update(token, "utf8").digest("hex");
  const hash = await hashAgentToken(token);
  assert.equal(hash, expected);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("parseBearer: accepts Bearer in any case and trims the outer whitespace", () => {
  const token = generateAgentToken().token;
  assert.equal(parseBearer(`Bearer ${token}`), token);
  assert.equal(parseBearer(`bearer ${token}`), token);
  assert.equal(parseBearer(`  BEARER ${token}  `), token);
});

test("parseBearer: rejects other schemes, missing headers, wrong length and inner spaces", () => {
  const token = generateAgentToken().token;
  assert.equal(parseBearer(`Basic ${token}`), null);
  assert.equal(parseBearer(null), null);
  assert.equal(parseBearer(undefined), null);
  assert.equal(parseBearer(""), null);
  assert.equal(parseBearer("Bearer"), null);
  assert.equal(parseBearer(`Bearer ${token.slice(0, -1)}`), null);
  assert.equal(parseBearer(`Bearer ${token}x`), null);
  assert.equal(parseBearer(`Bearer  ${token}`), null);
  assert.equal(parseBearer(`Bearer ${token.slice(0, 20)} ${token.slice(20)}`), null);
  assert.equal(parseBearer(`Bearer xyz_${"a".repeat(43)}`), null);
});

test("requiredScope: GET and HEAD read; every other method writes", () => {
  assert.equal(requiredScope("GET"), "read");
  assert.equal(requiredScope("get"), "read");
  assert.equal(requiredScope("HEAD"), "read");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(requiredScope(method), "write", method);
});

test("hasScope: write does not imply read", () => {
  assert.equal(hasScope(["write"], "read"), false);
  assert.equal(hasScope(["read"], "write"), false);
  assert.equal(hasScope(["read", "write"], "read"), true);
  assert.equal(hasScope(["read", "write"], "write"), true);
  assert.equal(hasScope([], "read"), false);
});
