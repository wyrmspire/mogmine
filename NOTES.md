# NOTES.md — Current State & Handoffs

The volatile file. `AGENTS.md` says what never changes. This says where things stand today.

- Read this at the start of a session. Update it at the end.
- Newest handoff first. Eight lines or fewer per entry.
- When a note becomes lasting knowledge, move it into `docs/` or `DECISIONS.md` and delete it here.
- Delete entries that no longer help the next person.

---

## Current state (2026-11-14)

- **Planning only. No application code exists.**
- **No TopstepX account yet (`D-009`).** Everything is built and tested on Yahoo data. The plan for that is [docs/10](docs/10-yahoo-first-build-plan.md).
- Specs: `docs/01`–`07` (original), `docs/08` (UX notes), `docs/09` (backend risk register), `docs/10` (Yahoo-first build plan).
- 16 open decisions in [DECISIONS.md](DECISIONS.md). `OD-1`, `OD-2`, `OD-4` and `OD-16` matter now. `OD-3` and `OD-7` are parked until there is a broker account.
- `mogprompt.md` and `docs/` still disagree on many names. The interim rule is that `docs/` wins. The full list is in the [drift register](DECISIONS.md#3-spec-drift-register).
- The development machine had neither Node nor Python installed on 2026-11-14. Node is needed before anything can be scaffolded.

## Next up

1. **Start the candle archive** ([docs/10 §3](docs/10-yahoo-first-build-plan.md#3-start-the-candle-archive-first)). It is the only task that loses data by waiting: `1m` bars older than 30 days cannot be fetched.
2. Owner decides `OD-16` (build order) and `OD-2` (auth and RLS from the first migration).
3. Scaffold one Next.js app with a Supabase project, RLS on, and `market_candles` (M0).
4. Build the `core` money and session math with golden tests, then one trade on one chart (M1).
5. Owner decides `OD-1`, then freeze or reconcile `mogprompt.md` using the drift register.
6. When a TopstepX account exists: ask Topstep to confirm in writing that a read-only cloud service is allowed (B-01), then reopen `OD-3` and `OD-7`.

## Lanes

Claim a lane before starting. Clear the claim when you stop.

| Lane | Claimed by | Since | Working on |
| :--- | :--- | :--- | :--- |
| Core math | — | | |
| Chart | — | | |
| App shell and notes | — | | |
| Data | — | | |
| Market data | — | | |
| Ingestion | — | | |
| AI review | — | | |

## Handoff log

### 2026-11-14 — agent (Codex Work) — Chart + app shell and notes
Did:      Scaffolded the first Next.js frontend; added offline fixtures, adaptive trade review, v5 Canvas PositionBoxPrimitive, manual entry, local-first notes, and private Trade Card sharing.
Verified: Local source checks passed before publication; npm install was blocked by the executor network (403), so Vercel preview build is the package/type/build verification.
Left:     Supabase, Yahoo archive and owner auth are not wired; the preview deliberately uses fixture candles and localStorage. No Topstep work was added.
Watch:    Trade Card generation uses takeScreenshot(true). Re-check iOS share/copy and the 390×844 acceptance flow on the deployed preview.

Format:

```text
### YYYY-MM-DD — who (person or agent + tool) — lane
Did:      what changed, with file paths
Verified: commands run and the result, or "not verified"
Left:     what is unfinished or assumed
Watch:    anything the next person will trip over
```

### 2026-11-14 (later) — agent (Claude Code) — Yahoo measurements and build order, no lane
Did:      Added `docs/10`. Recorded `D-009`, `OD-15`, `OD-16`. Replaced second-hand Yahoo limits with measured ones in `docs/09` B-11 and B-12, `AGENTS.md` §3b, `docs/02` and `mogprompt.md`.
Verified: Called Yahoo's chart endpoint from this machine for `ES=F`, `NQ=F`, `MES=F`, `MNQ=F`, `^VIX`, `DX-Y.NYB`. `1m` accepted to 30 days back and 8 days per request, `5m`/`15m`/`30m` to 60 days, `1h` to 730 days. Link check: 0 broken.
Left:     No archiver exists yet. Whether Yahoo delays the newest bars is still unknown (market was closed).
Watch:    Yahoo serves `MES=F` and `MNQ=F` as real, separate series, which contradicts the premise of Invariant 3 (`OD-15`). Measurements were from a desktop. Yahoo may throttle a hosted server.

### 2026-11-14 — agent (Claude Code) — docs review, no lane
Did:      Added `docs/08`, `docs/09`, `DECISIONS.md`, `CONTRIBUTING.md`, `NOTES.md`, PR template. Updated `AGENTS.md`, `README.md`, `mogprompt.md`, appended entries to `.gitignore`, and added pointer callouts to `docs/01`–`07`.
Verified: Vendor facts checked against Topstep, ProjectX, lightweight-charts, Vercel, Cloud Run and Supabase docs. See `docs/09` §10. No code exists, so nothing was run.
Left:     Nothing committed. The schema changes in `docs/09` §8 are proposals. The DDL in `mogprompt.md` §12 is unchanged and still has the problems listed there.
Watch:    Items marked `?` in `docs/09` §10 are unverified. Yahoo and iOS push facts come from secondary sources.

## Parking lot

Ideas that are not specified yet. Promote to a spec or delete.

- **Topstep risk rail on Today:** distance to the daily loss limit and trailing drawdown, read from the account stream.
- **Weekly review:** one insight a week from tags and directives, in place of a dashboard.
- **Personal rules:** the trader's own stop rules ("two losses, then stop"), surfaced quietly when they apply.
- **Auto-detected "Moved Stop":** from the order event log (B-07), so the trader does not have to tag it.
