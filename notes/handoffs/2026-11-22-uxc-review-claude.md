# Handoff — UX-c header wrapping, Review card part — lane `claude`

- **Item:** board row 12c, the Review card half. The Trade Detail half ("3m / 30s" split) waits for G1, which is editing `TradeDetail.tsx`.
- **Done:**
  - `components/ReviewScreen.tsx`: the meta line is split into whole units (date, time, entry price, hold time), each `nowrap`.
  - `app/globals.css`: `.queue-head .row-main` is a grid, so the title sits on its own line, and `.queue-meta` wraps only between units.
- **Checked:**
  - `tsc` reports nothing in my files, and `eslint` on them exits 0. The repo-wide red is G1's `exit_reason` work in progress; see the UX-a handoff.
  - Headless Chrome 390×844 on the :3000 dev server: the header reads "MES ▲ LONG SCENARIO", then "Fri, Nov 13 · 09:51", then "· in at 7550.75 · 3m 30s". Overflow 0, no page errors.
