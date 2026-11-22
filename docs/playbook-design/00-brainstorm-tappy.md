# Playbook Dynamics — Brainstorm Seed (Tappy, 2026-11-21)

Owner's ask: brainstorm the dynamics of playbooking — charts inside playbooks,
examples, saving examples. Data is the known hard part. Two Antigravity design
sessions work from this seed (data architecture / UX dynamics), then Codex
reviews and improves the unified design.

## Where the code actually is today (verified 2026-11-21)

- A Playbook (lib/playbooks.ts) is only: name, default_style, checklist_rules
  (max 12 text labels), archived flag, user_id. Store is localStorage
  `mogmine-playbooks-v1` (R-07a); an editor exists in Tune (R-07b).
  NO examples, NO charts, NO entry model, NO images anywhere in a playbook.
- A trade copies the playbook's checklist when chosen and never re-reads it
  (UX-50 freeze). Trades carry playbook_id, so per-playbook stats are possible.
- Candles are per-trade: fetched from Yahoo, cached on-device in IndexedDB
  (lib/candles.ts). Sample trades render from offline fixture bars. There is
  NO live server candle archive: PR #71 (Supabase candle archive) is resolved
  and mergeable but NOT merged, and its Supabase setup is owner-only and not
  done. Yahoo 1m history dies at 30 days — the data wall is real.
- Charts render in components/TradeChart.tsx; Trade Cards are canvas PNG
  renders. A full level set exists only as fixtures/levelsets/MES-2026-11-12.json.
  A Codex session is separately building the indicator/level/trend math module
  (branch codex/indicator-level-trend-math) — designs should assume session
  VWAP / POC / prev-day / overnight / weekly / settlement levels become
  computable from candles.

## The brainstorm — dynamics that matter

1. **An example is a frozen moment, not a link.** Candle window + timeframe +
   level set + annotations + what happened next + a verdict note, snapshotted
   at capture time. Same freeze philosophy as UX-50: a playbook edit or the
   Yahoo 30-day wall must never rot a saved example.
2. **Example kinds:** A+ exemplar (textbook), near-miss, and anti-example
   ("looks like it, isn't — here's why"). A playbook taught only with winners
   teaches pattern-matching without discrimination.
3. **Two capture sources:** (a) promote one of your own trades from Trade
   Detail ("Save as playbook example"), (b) capture a historical chart you
   never traded during review/study. (b) is how a playbook gets built before
   it has live trades.
4. **Examples as data, not just PNG.** Annotations anchored to time/price so
   the example re-renders as an interactive chart, can hide/reveal the
   outcome, can be quizzed blind, and can respect Shield (hide P&L). A PNG
   export (Trade-Card style) is a share artifact generated FROM the data.
5. **Playbook v2 shape:** thesis/entry model in text, rules (exists today),
   examples[], anti-examples[], and a live stats link back to tagged trades.
   Rules say it; examples prove it; stats grade it.
6. **Review dynamics:** examples feed blind review — show the frozen window
   up to the decision point, hide the outcome, "is this the setup? in or
   out?", then reveal. That turns a playbook from documentation into training.
7. **Size/storage reality:** a 1m candle window of a few hours is a few
   hundred bars — small. But localStorage (playbooks today) is the wrong
   home; example candles belong in IndexedDB like trade candles, with a
   future Supabase shape that reuses the existing user_id invariant.

## Open questions for the owner (designs should flag, not decide)

- Can examples come from charts the trader never traded? (Seed assumes yes.)
- Do anti-examples live inside the same playbook or a shared "traps" library?
- Is a playbook ever shareable/exportable as a package (rules + examples)?
- Outcome hidden by default in the example viewer, or shown?
