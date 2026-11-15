"use client";

import { useEffect } from "react";
import { dismissHomeScreenHint, initializeHomeScreenHint, useHomeScreenHint } from "@/lib/install";

export function HomeScreenHint() {
  const visible = useHomeScreenHint();

  useEffect(() => { initializeHomeScreenHint(); }, []);

  if (!visible) return null;

  return (
    <aside className="home-screen-hint specular-card" aria-label="Add MogMine to your Home Screen">
      <span className="home-screen-hint-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 15V3m0 0L8 7m4-4 4 4" />
          <path d="M7 10H5.5A2.5 2.5 0 0 0 3 12.5v6A2.5 2.5 0 0 0 5.5 21h13a2.5 2.5 0 0 0 2.5-2.5v-6a2.5 2.5 0 0 0-2.5-2.5H17" />
        </svg>
      </span>
      <span className="home-screen-hint-copy">
        <strong>Keep MogMine one tap away</strong>
        <span>Tap Share, then <b>Add to Home Screen</b>.</span>
      </span>
      <button type="button" onClick={dismissHomeScreenHint} aria-label="Dismiss Add to Home Screen hint">Done</button>
    </aside>
  );
}
