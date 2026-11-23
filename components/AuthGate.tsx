"use client";
// #182: wraps the app in the root layout. Gate off (`local`, `mock`): children render unchanged, as before.
// Gate on (`supabase`): /login always shows the login screen, and every other path renders the app only for an
// allow-listed user. AppShell is not mounted for anyone else, so no app data loads.
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { CSSProperties } from "react";
import { LoginScreen, NotAuthorized } from "./LoginScreen";
import { useAuth } from "./useAuth";
import type { AuthState } from "./useAuth";

const CENTER: CSSProperties = { minHeight: "100dvh", display: "grid", placeItems: "center", gap: 12, alignContent: "center", justifyItems: "center", padding: 24 };

function Splash() {
  return (
    <div role="status" style={CENTER}>
      <span className="brand-gem" aria-hidden="true">M</span>
      <p className="muted" style={{ margin: 0 }}>Checking sign-in…</p>
    </div>
  );
}

function ErrorView({ message, retry }: { message: string | null; retry(): void }) {
  return (
    <div style={CENTER}>
      <section className="card card-pad" style={{ display: "grid", gap: 12, width: "100%", maxWidth: 420 }}>
        <p role="alert" style={{ color: "var(--loss-text)", margin: 0 }}>{message}</p>
        <button type="button" className="btn-primary btn-block" style={{ minHeight: 44 }} onClick={retry}>Retry</button>
      </section>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth: AuthState & { retry(): void } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === "/login";
  const signedOut = auth.status === "signed-out";

  useEffect(() => {
    if (signedOut && !onLogin) router.replace("/login");
  }, [signedOut, onLogin, router]);

  if (auth.status === "off") return children;
  if (onLogin) return <LoginScreen auth={auth} />;
  if (auth.status === "allowed") return children;
  if (auth.status === "not-authorized") return <div style={CENTER}><NotAuthorized email={auth.email} /></div>;
  if (auth.status === "error") return <ErrorView message={auth.message} retry={auth.retry} />;
  return <Splash />;
}
