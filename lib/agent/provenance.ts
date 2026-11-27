/** Minimal, non-secret provenance attached to records written through the agent API. */
export interface AgentWriteProvenance {
  token_prefix: string;
  at: string;
}

export interface AgentProvenancedRecord {
  agent_provenance?: AgentWriteProvenance;
  /** Note fields written by the agent. Omitted on older record-level provenance. */
  agent_provenance_fields?: string[];
}

export const AGENT_NOTE_FIELDS = ["note", "pre_trade_thesis", "management_notes", "post_exit_notes"] as const;
export type AgentNoteField = (typeof AGENT_NOTE_FIELDS)[number];

const SAFE_PREFIX_LENGTH = 8;

/** Keep the audit marker useful without persisting a token, hash, or credential-shaped text. */
export function safeTokenPrefix(tokenId: string): string {
  const prefix = tokenId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, SAFE_PREFIX_LENGTH);
  return prefix || "agent";
}

export function agentWriteProvenance(tokenId: string, at = new Date().toISOString()): AgentWriteProvenance {
  return { token_prefix: safeTokenPrefix(tokenId), at };
}

export function agentNoteFields(value: unknown): AgentNoteField[] {
  if (!Array.isArray(value)) return [];
  return AGENT_NOTE_FIELDS.filter((field) => value.includes(field));
}

export function agentAuthoredNoteFields(record: AgentProvenancedRecord): AgentNoteField[] {
  if (!isAgentWriteProvenance(record.agent_provenance)) return [];
  // Legacy record-level provenance is retained for compatibility but is not displayed because its
  // original write may have changed a non-note field.
  return agentNoteFields(record.agent_provenance_fields);
}

export function isAgentWriteProvenance(value: unknown): value is AgentWriteProvenance {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AgentWriteProvenance>;
  return typeof candidate.token_prefix === "string" && candidate.token_prefix.length > 0 &&
    candidate.token_prefix.length <= SAFE_PREFIX_LENGTH && typeof candidate.at === "string" &&
    Number.isFinite(Date.parse(candidate.at));
}
