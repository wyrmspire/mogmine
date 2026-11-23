"use client";
// #182: the /login screen. Standalone (no AppShell), phone-first. Handles every auth status on /login: the form,
// the "check your email" view, the signed-in view, the not-authorized view, the hash error from an expired link,
// and the gate-off message for `local` and `mock`.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { GENERIC_SEND_MESSAGE, parseAuthHashError, sendMagicLink } from "@/lib/auth/auth";
import { chooseAdapter } from "@/lib/persistence/select";
import { getAuthClient, signOutToLogin } from "./useAuth";
import type { AuthState } from "./useAuth";

export type LoginAuth = AuthState & { retry(): void };

const PAGE: CSSProperties = { minHeight: "100dvh", display: "grid", placeItems: "center", padding: "24px 16px" };
const PANEL: CSSProperties = { width: "100%", maxWidth: 420, display: "grid", gap: 14 };
const TOUCH: CSSProperties = { minHeight: 44 };
const ALERT: CSSProperties = { color: "var(--loss-text)", fontSize: "0.8125rem", margin: 0 };

export function LoginScreen({ auth }: { auth?: LoginAuth }) {
  const router = useRouter();
  const status = auth?.status ?? "off";
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);
  const fromLink = useRef(false);
  const redirected = useRef(false);

  // Runs before the auth hook's effect (children first), so the access token is still in the hash.
  useEffect(() => {
    const hash = window.location.hash;
    fromLink.current = hash.includes("access_token");
    const failed = parseAuthHashError(hash);
    if (failed) {
      // The URL fragment is only known in the browser, so it is read after mount (no server/client markup mismatch).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHashError(failed);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // A session that arrived from a magic link goes straight into the app, once.
  useEffect(() => {
    if (status === "allowed" && fromLink.current && !redirected.current) {
      redirected.current = true;
      router.replace("/");
    }
  }, [status, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setFormError(null);
    let result: Awaited<ReturnType<typeof sendMagicLink>>;
    try {
      result = await sendMagicLink(await getAuthClient(), email, window.location.origin);
    } catch {
      result = { ok: false, message: GENERIC_SEND_MESSAGE };
    }
    setSending(false);
    if (result.ok) setSentTo(result.email);
    else setFormError(result.message);
  }

  let body: React.ReactNode;
  if (status === "off") {
    const storage = chooseAdapter(process.env.NEXT_PUBLIC_PERSISTENCE_ADAPTER) === "mock" ? "mock" : "local";
    body = (
      <section className="card card-pad" aria-labelledby="login-title">
        <h1 id="login-title" style={{ fontSize: "1.125rem", margin: "0 0 8px" }}>Sign in</h1>
        <p className="muted" style={{ margin: "0 0 14px" }}>Sign-in is off. MogMine is running on {storage} storage, so no login is needed.</p>
        <Link href="/" className="btn-secondary btn-block" style={TOUCH}>Open MogMine</Link>
      </section>
    );
  } else if (status === "loading" || status === "checking") {
    body = <p role="status" className="muted">Checking sign-in…</p>;
  } else if (status === "error") {
    body = (
      <section className="card card-pad" style={{ display: "grid", gap: 12 }}>
        <p role="alert" style={ALERT}>{auth?.message}</p>
        <button type="button" className="btn-primary btn-block" style={TOUCH} onClick={() => auth?.retry()}>Try again</button>
      </section>
    );
  } else if (status === "not-authorized") {
    body = <NotAuthorized email={auth?.email ?? null} />;
  } else if (status === "allowed") {
    body = (
      <section className="card card-pad" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: "1.125rem", margin: 0 }}>Signed in</h1>
        <p className="muted" style={{ margin: 0 }}>Signed in as {auth?.email}</p>
        <button type="button" className="btn-primary btn-block" style={TOUCH} onClick={() => router.replace("/")}>Open MogMine</button>
        <button type="button" className="btn-secondary btn-block" style={TOUCH} onClick={() => void signOutToLogin()}>Sign out</button>
      </section>
    );
  } else if (sentTo) {
    body = (
      <section className="card card-pad" style={{ display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: "1.125rem", margin: 0 }}>Check your email</h1>
        <p style={{ margin: 0 }}>We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this phone. Any browser works.</p>
        <p className="muted" style={{ margin: 0 }}>Supabase sends at most 2 sign-in emails an hour.</p>
        <button type="button" className="btn-ghost btn-block" style={TOUCH} onClick={() => { setSentTo(null); setFormError(null); }}>Use a different email</button>
      </section>
    );
  } else {
    body = (
      <section className="card card-pad" style={{ display: "grid", gap: 12 }} aria-labelledby="login-title">
        <h1 id="login-title" style={{ fontSize: "1.125rem", margin: 0 }}>Sign in</h1>
        <p className="muted" style={{ margin: 0 }}>We&apos;ll email you a sign-in link. No password.</p>
        <form onSubmit={onSubmit} noValidate style={{ display: "grid", gap: 12 }}>
          <div className="field">
            <label>
              <span>Email</span>
              <input
                type="email"
                name="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                style={TOUCH}
                required
              />
            </label>
          </div>
          {formError && <p role="alert" style={ALERT}>{formError}</p>}
          <button type="submit" className="btn-primary btn-block" style={TOUCH} disabled={sending}>{sending ? "Sending…" : "Email me a sign-in link"}</button>
        </form>
      </section>
    );
  }

  const content = (
    <div style={PANEL}>
      <div className="brand" style={{ justifyContent: "center" }}><span className="brand-gem" aria-hidden="true">M</span><span>MOGMINE</span></div>
      {hashError && <p role="alert" style={ALERT}>{hashError}</p>}
      {body}
    </div>
  );
  // Gate off: this renders inside AppShell, which already owns <main>.
  return auth ? <main style={PAGE}>{content}</main> : <div style={PAGE}>{content}</div>;
}

/** Shown when the user is signed in but not on the allow-list. No app data loads. */
export function NotAuthorized({ email }: { email: string | null }) {
  return (
    <section className="card card-pad" style={{ display: "grid", gap: 12 }}>
      <h1 style={{ fontSize: "1.125rem", margin: 0 }}>Not authorized</h1>
      <p style={{ margin: 0 }}>Signed in as {email ?? "this account"}, but this account isn&apos;t on MogMine&apos;s allow-list.</p>
      <button type="button" className="btn-secondary btn-block" style={TOUCH} onClick={() => void signOutToLogin()}>Sign out</button>
    </section>
  );
}
