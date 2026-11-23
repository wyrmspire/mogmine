// #190: the fingerprint that decides whether a record changed since the server last saw it. It is a stable JSON text
// of the record without the fields that are not part of its content: `user_id` (the Supabase adapter rewrites
// `demo-owner` to the signed-in uid), `candles` (never stored), and the derived fields listed in the registry
// (recomputed on read). The text is hashed with cyrb53 and prefixed with its length, so equal records always match.
import { contractFor } from "./registry.ts";
import type { CollectionKey, SingletonKey } from "./contract.ts";

const ALWAYS_SKIPPED = ["user_id", "candles"];

/** Sorted keys at every depth; `undefined` properties are dropped (as JSON does); arrays keep their order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null"; // undefined and functions have no JSON form; they read as null
}

/** cyrb53: a 53-bit string hash (public domain). Good enough to detect edits; not a security hash. */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Content fingerprint of one record of `key`. Equal after the owner rewrite and derived-field stripping. */
export function fingerprint(key: CollectionKey | SingletonKey, record: unknown): string {
  const skipped = new Set<string>([...ALWAYS_SKIPPED, ...contractFor(key).derivedNeverStored]);
  const content: Record<string, unknown> = {};
  if (record && typeof record === "object" && !Array.isArray(record)) {
    for (const [field, value] of Object.entries(record)) {
      if (!skipped.has(field)) content[field] = value;
    }
  }
  const text = canonical(content);
  return `${text.length.toString(36)}-${cyrb53(text)}`;
}
