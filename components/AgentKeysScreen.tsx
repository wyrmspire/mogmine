"use client";
// #185b: /settings/agent. Create, list and revoke agent keys, show the one-time key with a copy-ready setup block, and
// show recent agent activity. AuthGate keeps this page to allow-listed owners. The key is held in component state only:
// never in browser storage, the URL or logs, and Done clears it. Gate off (local, mock): a notice, no SDK loaded.
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { isAuthGateOn } from "@/lib/auth/auth";
import { chooseAdapter } from "@/lib/persistence/select";
import { createAgentKey, listAgentKeys, listRecentAudit, revokeAgentKey } from "@/lib/agent/keys-client";
import type { AgentKeyRow, AuditRow, KeysClientLike } from "@/lib/agent/keys-client";
import { apiBaseUrl, setupBlock, specUrl } from "@/lib/agent/openapi";
import { getAuthClient } from "./useAuth";

// NEXT_PUBLIC_* values are inlined at build time, so these are constants in the browser bundle.
const GATE_ON = isAuthGateOn(process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER);
const STORAGE = chooseAdapter(process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER) === "mock" ? "mock" : "local";

const PAGE: CSSProperties = { maxWidth: 560, margin: "0 auto", padding: "16px", display: "grid", gap: 16 };
const SECTION: CSSProperties = { display: "grid", gap: 12 };
const HEAD: CSSProperties = { fontSize: "1rem", margin: 0 };
const TOUCH: CSSProperties = { minHeight: 44, minWidth: 44 };
const ALERT: CSSProperties = { color: "var(--loss-text)", fontSize: "0.8125rem", margin: 0 };
const MONO: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", wordBreak: "break-all" };
const TAG: CSSProperties = { fontSize: "0.6875rem", border: "1px solid var(--border-strong)", borderRadius: 6, padding: "2px 6px", color: "var(--text-muted)", justifySelf: "start" };
const ONE_TIME: CSSProperties = { border: "1px solid var(--gold-mid)", borderRadius: 12, padding: 12, display: "grid", gap: 10, background: "var(--bg-inset)" };
const REVOKE_WINDOW_MS = 4000;

type Panel<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; rows: T[] };
type Session = { db: KeysClientLike; userId: string };
type Issued = { token: string; label: string };
type Choice = "read" | "read-write";

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const scopeText = (scopes: string[]) => (scopes.includes("write") ? "Read and write" : "Read only");

export function AgentKeysScreen() {
  if (!GATE_ON) {
    return (
      <div style={PAGE}>
        <section className="card card-pad" style={SECTION}>
          <h1 style={HEAD}>Agent keys</h1>
          <p className="muted" style={{ margin: 0 }}>Agent keys need the Supabase adapter. This deployment runs on {STORAGE} storage.</p>
        </section>
      </div>
    );
  }
  return <AgentKeys />;
}

function AgentKeys() {
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [keys, setKeys] = useState<Panel<AgentKeyRow>>({ state: "loading" });
  const [audit, setAudit] = useState<Panel<AuditRow>>({ state: "loading" });
  // Read in the browser only; AuthGate renders no children on the server, so this is never server markup.
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [choice, setChoice] = useState<Choice>("read-write");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  const loadPanels = useCallback(async (current: Session) => {
    const [keyList, activity] = await Promise.all([
      listAgentKeys(current.db, current.userId),
      listRecentAudit(current.db, current.userId),
    ]);
    setKeys(keyList.ok ? { state: "ready", rows: keyList.rows } : { state: "error", message: keyList.message });
    setAudit(activity.ok ? { state: "ready", rows: activity.rows } : { state: "error", message: activity.message });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const client = await getAuthClient();
        const { data, error } = await client.auth.getSession();
        const userId = data.session?.user.id;
        if (!alive) return;
        if (error || !userId) {
          setAuthError("Sign in again to manage agent keys.");
          return;
        }
        const current: Session = { db: client as unknown as KeysClientLike, userId };
        setSession(current);
        void loadPanels(current);
      } catch {
        if (alive) setAuthError("Couldn't reach your account. Check your connection and try again.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadPanels]);

  // The revoke confirmation lapses after a few seconds, so a stray tap later cannot revoke by accident.
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), REVOKE_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${what} copied.`);
    } catch {
      setNotice("Copy didn't work here. Select the text and copy it by hand.");
    }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || creating) return;
    setCreating(true);
    setCreateError(null);
    setNotice(null);
    const result = await createAgentKey(session.db, session.userId, label, choice);
    setCreating(false);
    if (!result.ok) {
      setCreateError(result.message);
      return;
    }
    setIssued({ token: result.token, label: result.row.label });
    setLabel("");
    void loadPanels(session);
  }

  async function onRevoke(row: AgentKeyRow) {
    if (!session) return;
    if (armed !== row.id) {
      setArmed(row.id);
      return;
    }
    setArmed(null);
    const result = await revokeAgentKey(session.db, session.userId, row.id, new Date().toISOString());
    setNotice(result.ok ? `Revoked ${row.label}.` : (result.message ?? "Couldn't revoke the key. Try again."));
    void loadPanels(session);
  }

  const base = origin ? apiBaseUrl(origin) : "";
  const spec = origin ? specUrl(origin) : "";

  return (
    <div style={PAGE}>
      <h1 style={{ fontSize: "1.125rem", margin: 0 }}>Agent keys</h1>
      <p role="status" className="muted" style={{ margin: 0, minHeight: 20 }}>{notice}</p>
      {authError && <p role="alert" style={ALERT}>{authError}</p>}

      <section className="card card-pad" style={SECTION} aria-labelledby="agent-connect">
        <h2 id="agent-connect" style={HEAD}>Connect an assistant</h2>
        <p className="muted" style={{ margin: 0 }}>Give your assistant these two things: the spec URL and a key.</p>
        <CopyRow label="Base URL" value={base} onCopy={() => copy(base, "Base URL")} />
        <CopyRow label="OpenAPI spec URL" value={spec} onCopy={() => copy(spec, "Spec URL")} />
      </section>

      <section className="card card-pad" style={SECTION} aria-labelledby="agent-new">
        <h2 id="agent-new" style={HEAD}>New key</h2>
        <form onSubmit={onCreate} noValidate style={SECTION}>
          <div className="field">
            <label>
              <span>Label</span>
              <input
                name="label"
                value={label}
                maxLength={60}
                placeholder="Grok Bot"
                autoComplete="off"
                onChange={(event) => setLabel(event.target.value)}
                style={TOUCH}
              />
            </label>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
            <legend className="muted" style={{ fontSize: "0.8125rem", marginBottom: 4 }}>Access</legend>
            <ScopeOption value="read" label="Read only" checked={choice === "read"} onPick={setChoice} />
            <ScopeOption value="read-write" label="Read and write" checked={choice === "read-write"} onPick={setChoice} />
          </fieldset>
          {createError && <p role="alert" style={ALERT}>{createError}</p>}
          <button type="submit" className="btn-primary btn-block" style={TOUCH} disabled={!session || creating}>
            {creating ? "Creating…" : "Create key"}
          </button>
        </form>

        {issued && (
          <div role="region" aria-label="New key, shown once" style={ONE_TIME}>
            <p style={{ margin: 0, fontWeight: 700 }}>{issued.label}: your key</p>
            <p style={{ margin: 0, color: "var(--gold-mid)" }}>This key is shown once. Store it now.</p>
            <label className="field">
              <span>Agent key</span>
              <input readOnly value={issued.token} onFocus={(event) => event.currentTarget.select()} style={{ ...MONO, ...TOUCH }} />
            </label>
            <button type="button" className="btn-secondary btn-block" style={TOUCH} onClick={() => copy(issued.token, "Key")}>Copy key</button>
            <pre style={{ ...MONO, whiteSpace: "pre-wrap", fontSize: "0.8125rem", margin: 0 }}>{setupBlock(origin, issued.token)}</pre>
            <button type="button" className="btn-secondary btn-block" style={TOUCH} onClick={() => copy(setupBlock(origin, issued.token), "Setup block")}>Copy setup block</button>
            <button type="button" className="btn-primary btn-block" style={TOUCH} onClick={() => { setIssued(null); setNotice(null); }}>Done</button>
          </div>
        )}
      </section>

      <section className="card card-pad" style={SECTION} aria-labelledby="agent-keys">
        <h2 id="agent-keys" style={HEAD}>Your keys</h2>
        {keys.state === "loading" && <p role="status" className="muted" style={{ margin: 0 }}>Loading keys…</p>}
        {keys.state === "error" && (
          <div style={SECTION}>
            <p role="alert" style={ALERT}>{keys.message}</p>
            <button type="button" className="btn-secondary" style={TOUCH} onClick={() => session && void loadPanels(session)}>Try again</button>
          </div>
        )}
        {keys.state === "ready" && keys.rows.length === 0 && <p className="muted" style={{ margin: 0 }}>No keys yet. Create one above.</p>}
        {keys.state === "ready" && keys.rows.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {keys.rows.map((row) => (
              <li key={row.id} style={{ borderTop: "1px solid var(--border-strong)", paddingTop: 10, display: "grid", gap: 6 }}>
                <strong>{row.label}</strong>
                <span className="muted" style={MONO}>{row.token_prefix}…</span>
                <span className="muted" style={{ fontSize: "0.8125rem" }}>
                  {scopeText(row.scopes)} · Created {fmt(row.created_at)} · {row.last_used_at ? `Last used ${fmt(row.last_used_at)}` : "Never used"}
                </span>
                {row.revoked_at ? (
                  <span style={TAG}>Revoked</span>
                ) : (
                  <button type="button" className="btn-secondary" style={{ ...TOUCH, justifySelf: "start" }} onClick={() => void onRevoke(row)}>
                    {armed === row.id ? "Tap again to revoke" : "Revoke"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad" style={SECTION} aria-labelledby="agent-activity">
        <h2 id="agent-activity" style={HEAD}>Recent agent activity</h2>
        {audit.state === "loading" && <p role="status" className="muted" style={{ margin: 0 }}>Loading activity…</p>}
        {audit.state === "error" && (
          <div style={SECTION}>
            <p role="alert" style={ALERT}>{audit.message}</p>
            <button type="button" className="btn-secondary" style={TOUCH} onClick={() => session && void loadPanels(session)}>Try again</button>
          </div>
        )}
        {audit.state === "ready" && audit.rows.length === 0 && <p className="muted" style={{ margin: 0 }}>No agent activity yet.</p>}
        {audit.state === "ready" && audit.rows.length > 0 && (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {audit.rows.map((row) => (
              <li key={row.id} style={{ fontSize: "0.8125rem", display: "grid", gap: 2 }}>
                <span className="muted">{fmt(row.at)}</span>
                <span style={MONO}>{row.method} {row.path}</span>
                <span className="muted">{row.status} · {row.outcome}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy(): void }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span className="muted" style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 750 }}>{label}</span>
      <code style={{ ...MONO, fontSize: "0.8125rem" }}>{value || "…"}</code>
      <button type="button" className="btn-secondary" style={{ ...TOUCH, justifySelf: "start" }} aria-label={`Copy ${label}`} onClick={onCopy}>Copy</button>
    </div>
  );
}

function ScopeOption({ value, label, checked, onPick }: { value: Choice; label: string; checked: boolean; onPick(value: Choice): void }) {
  return (
    <label style={{ ...TOUCH, display: "flex", alignItems: "center", gap: 10 }}>
      <input type="radio" name="scope" value={value} checked={checked} onChange={() => onPick(value)} style={{ width: 20, height: 20 }} />
      <span>{label}</span>
    </label>
  );
}
