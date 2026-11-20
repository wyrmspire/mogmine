"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";
import { AddTradeSheet } from "./AddTradeSheet";
import { HomeScreenHint } from "./HomeScreenHint";
import { hydratePrefs, setPrefs, usePrefs } from "@/lib/prefs";
import { withSamples } from "@/lib/selectors";
import { hydrateJournal, useJournal } from "@/lib/store";
import { hydrateMood } from "@/lib/mood-store";
import { hydrateAccounts } from "@/lib/accounts-store";
import { dismissToast, useToast } from "@/lib/toast";
import { openAddTrade, useOnline, useUi } from "@/lib/ui";

const SAVE_TEXT = { idle: "On this device", saving: "Saving…", saved: "Saved on this device", error: "Not saved — storage is blocked" } as const;

const icons = {
  today: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  feed: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>,
  review: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="3.5" width="12" height="15" rx="2.5" /><path d="M9 21h6M9.5 11l2 2 3.5-4" /></svg>,
  tune: <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>,
  shield: <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 3l7 3v5.5c0 4.3-2.9 7.6-7 9.5-4.1-1.9-7-5.2-7-9.5V6l7-3z" /></svg>,
};

const NAV = [
  { href: "/", label: "Today", icon: icons.today },
  { href: "/feed", label: "Feed", icon: icons.feed },
  { href: "/review", label: "Review", icon: icons.review },
  { href: "/tune", label: "Tune", icon: icons.tune },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const journal = useJournal();
  const prefs = usePrefs();
  const ui = useUi();
  const toast = useToast();
  const online = useOnline();

  useLayoutEffect(() => { hydratePrefs(); hydrateJournal(); hydrateMood(); hydrateAccounts(); }, []);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const waiting = journal.hydrated ? withSamples(journal.trades, prefs.showSamples).filter((trade) => trade.review_status === "new").length : 0;
  const reviewBadge = waiting > 0 ? <span className="badge"><span aria-hidden="true">{waiting}</span><span className="visually-hidden">{`, ${waiting} ${waiting === 1 ? "trade needs" : "trades need"} tags`}</span></span> : null;

  return (
    <div className="shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="topbar">
        <Link href="/" className="brand" aria-label="MogMine, Today"><span className="brand-gem" aria-hidden="true">M</span><span>MOGMINE</span></Link>
        <nav className="topnav" aria-label="Main">
          {NAV.map((item) => <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>{item.label}{item.href === "/review" && reviewBadge}</Link>)}
        </nav>
        <span className="topbar-spacer" />
        <span className="save-status" data-state={journal.saveState} role="status"><i aria-hidden="true" /><span>{SAVE_TEXT[journal.saveState]}</span></span>
        <button type="button" className="icon-button" aria-pressed={prefs.shield} aria-label={prefs.shield ? "Shield mode on: dollars hidden. Tap to show dollars." : "Shield mode off. Tap to hide dollars."} title="Shield mode: hide dollars and size" onClick={() => setPrefs({ shield: !prefs.shield })}>{icons.shield}</button>
        <button type="button" className="icon-button" onClick={openAddTrade} aria-label="Add trade">＋</button>
      </header>

      <HomeScreenHint />
      {!online && <div className="banner warn" role="status">You are offline. Trades and notes on this device stay readable; new market data waits.</div>}

      <main id="main-content" tabIndex={-1}>{children}</main>

      <nav className="dock" aria-label="Main">
        {NAV.slice(0, 2).map((item) => <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>{item.icon}<span>{item.label}</span></Link>)}
        <button type="button" className="dock-add" onClick={openAddTrade} aria-label="Add trade"><span className="plus" aria-hidden="true">＋</span></button>
        {NAV.slice(2).map((item) => <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>{item.icon}<span>{item.label}</span>{item.href === "/review" && reviewBadge}</Link>)}
      </nav>

      {ui.addOpen && <AddTradeSheet />}
      {toast && (
        <div className={`toast ${toast.actionLabel ? "" : "plain"}`} role="status" key={toast.id}>
          {toast.message}
          {toast.actionLabel && <button onClick={() => { toast.onAction?.(); dismissToast(); }}>{toast.actionLabel}</button>}
        </div>
      )}
    </div>
  );
}
