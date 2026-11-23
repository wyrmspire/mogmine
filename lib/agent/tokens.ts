// #185a: agent API keys (docs/26 §6, AGENTS.md §3b). Pure: Web Crypto only, no SDK, so the same module can run in the
// browser (185b creates keys client-side) and on the server (Node 24). The plaintext is shown once and never stored:
// only the SHA-256 hex hash of the full token string reaches `mogmine_agent_tokens.token_hash`.

/** `mmk_` followed by 43 base64url characters (32 random bytes, no padding). */
export const AGENT_TOKEN_PATTERN = /^mmk_[A-Za-z0-9_-]{43}$/;

export type AgentScope = "read" | "write";

/** The display prefix: `mmk_` plus 8 characters. Matches the `token_prefix` check in the migration. */
const PREFIX_LENGTH = 12;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateAgentToken(): { token: string; prefix: string } {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const token = `mmk_${base64url(bytes)}`;
  return { token, prefix: token.slice(0, PREFIX_LENGTH) };
}

/** Lowercase hex SHA-256 of the full token string (64 characters). This is what the server looks up. */
export async function hashAgentToken(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The token from `Authorization: Bearer <token>`, or null. The scheme is case-insensitive; nothing else is loosened. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^bearer (.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  return AGENT_TOKEN_PATTERN.test(token) ? token : null;
}

/** Reads need `read`; every other method needs `write`. */
export function requiredScope(method: string): AgentScope {
  const verb = method.toUpperCase();
  return verb === "GET" || verb === "HEAD" ? "read" : "write";
}

/** `write` does NOT imply `read`: a key carries exactly the scopes it was minted with. */
export function hasScope(scopes: readonly string[], needed: AgentScope): boolean {
  return scopes.includes(needed);
}
