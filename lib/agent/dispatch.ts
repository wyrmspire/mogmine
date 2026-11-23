// #185a: maps one parsed agent route onto the journal command layer (#174). Pure over the command interface: no SDK,
// no Next. The command layer decides what is valid and what is forbidden; this file only shapes the HTTP answer.
import type { CollectionKey, ListQuery, PersistError, PersistResult, SingletonKey } from "../persistence/contract.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import { agentError, agentFail, agentOk, statusFor } from "./http.ts";

export type AgentRoute =
  | { kind: "me" }
  | { kind: "list"; type: CollectionKey; query: ListQuery }
  | { kind: "create"; type: CollectionKey; body: unknown }
  | { kind: "read" | "remove" | "archive"; type: CollectionKey; id: string }
  | { kind: "update"; type: CollectionKey; id: string; body: unknown }
  | { kind: "readSingleton"; key: SingletonKey }
  | { kind: "writeSingleton"; key: SingletonKey; body: unknown };

export interface AgentWho {
  userId: string;
  tokenId: string;
  scopes: string[];
}

/** What the route handler sends, and what the audit log records. Never contains a token or hash. */
export interface AgentDispatch {
  status: number;
  body: unknown;
  recordType?: string;
  recordId?: string;
  outcome: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function failure(error: PersistError, recordType: string, recordId: string | undefined): AgentDispatch {
  const { status, body } = agentError(error.code, error.message);
  return { status, body, recordType, recordId, outcome: error.code };
}

function settle<T>(
  result: PersistResult<T>,
  recordType: string,
  recordId: string | undefined,
  shape: (value: T) => unknown,
  status = 200,
): AgentDispatch {
  if (!result.ok) return failure(result.error, recordType, recordId);
  const { body } = agentOk(shape(result.value), status);
  return { status, body, recordType, recordId, outcome: "ok" };
}

function invalidBody(recordType: string, recordId: string | undefined, message: string): AgentDispatch {
  const { status, body } = agentFail(statusFor("invalid"), "invalid", message);
  return { status, body, recordType, recordId, outcome: "invalid" };
}

export async function dispatchAgentRoute(route: AgentRoute, commands: JournalCommands, who: AgentWho): Promise<AgentDispatch> {
  switch (route.kind) {
    case "me": {
      const { body } = agentOk({ user_id: who.userId, token: { id: who.tokenId, scopes: who.scopes } });
      return { status: 200, body, outcome: "ok" };
    }

    case "list":
      return settle(await commands.list(route.type, route.query), route.type, undefined, (records) => records);

    case "create": {
      const id = isPlainObject(route.body) && typeof route.body.id === "string" ? route.body.id : undefined;
      return settle(await commands.create(route.type, route.body), route.type, id, (stored) => stored, 201);
    }

    case "read":
      return settle(await commands.read(route.type, route.id), route.type, route.id, (stored) => stored);

    case "update":
      if (!isPlainObject(route.body)) return invalidBody(route.type, route.id, "Body must be a JSON object of fields to change.");
      return settle(await commands.update(route.type, route.id, route.body), route.type, route.id, (stored) => stored);

    case "remove": {
      const result = await commands.remove(route.type, route.id);
      return settle(result, route.type, route.id, () => null);
    }

    case "archive":
      return settle(await commands.archive(route.type, route.id), route.type, route.id, (stored) => stored);

    case "readSingleton":
      return settle(await commands.readSingleton(route.key), route.key, undefined, (stored) => stored);

    case "writeSingleton":
      return settle(await commands.writeSingleton(route.key, route.body), route.key, undefined, (stored) => stored);
  }
}
