# CONTRIBUTING.md — How We Work in This Repo

For every developer and every AI agent. [AGENTS.md](AGENTS.md) holds the rules that must not be broken. This file is the workflow: who owns what, how changes land, and how people and agents hand work to each other.

---

## 1. Which file answers which question

| File | Answers | Changes |
| :--- | :--- | :--- |
| [AGENTS.md](AGENTS.md) | What must I never break? Which spec do I read? | Rarely |
| [docs/01 – 09](docs/) | What exactly are we building? | With the feature |
| [docs/10](docs/10-yahoo-first-build-plan.md) | What do I build first, and on what data? | When the build order or the data source changes |
| [docs/11](docs/11-product-workflows-and-api-context.md) | Which daily workflows, chart context and assistant API behaviors are proposed? | With owner review of `OD-17`–`OD-19` |
| [docs/12](docs/12-levels-zones-and-daily-markup.md) | How are daily levels, zones and the markup computed, drawn and stored? | With owner review of `OD-20`–`OD-23` |
| [docs/13](docs/13-bold-ui-bets.md) | Which bolder interface ideas are on the table, and which three to try first? | When a bet is adopted or dropped |
| [DECISIONS.md](DECISIONS.md) | What is decided? What is open? Which name is canonical? | When a decision is made |
| [NOTES.md](NOTES.md) | What is the state right now? Who is on what? What did the last person leave? | Every working session |
| [mogprompt.md](mogprompt.md) | The whole system in one long read | When the specs it summarises change |
| `CONTRIBUTING.md` | How do I work here? | Rarely |

**When two files disagree:** `AGENTS.md` invariants first, then `DECISIONS.md`, then `docs/`, then `mogprompt.md`. If the disagreement is not already in the [drift register](DECISIONS.md#3-spec-drift-register), add it. Do not pick a side quietly in code.

**One agent guide.** `AGENTS.md` is the only agent instruction file. If a tool needs its own file (`CLAUDE.md`, `GEMINI.md`, `.cursorrules`, Copilot instructions), make it a one-line pointer to `AGENTS.md`. Never a copy.

---

## 2. Lanes

There is no code yet. This layout is proposed so that parallel work does not collide. Confirm it when scaffolding, then update this table.

> **Start smaller.** With no broker account and no listener (`D-009`), there is only one deployable. Begin as a single Next.js app with a `core` folder of pure functions, and split into the layout below when a second deployable exists ([docs/10 §7](docs/10-yahoo-first-build-plan.md#7-step-back-is-this-the-right-way-to-build-it), `OD-16`). The lanes still apply as folders.

```text
apps/web/            Next.js PWA: screens, components, API routes
services/listener/   Cloud Run service: broker stream, reconciliation, job runner
packages/core/       Shared, no I/O: types, adapter interfaces, FUTURES_SPECS,
                     money math, session and time math, trade derivation
supabase/            migrations/, seed.sql, generated types
fixtures/            Sample trades, recorded broker events, candle sets
docs/                Specs
```

| Lane | Owns | Read first |
| :--- | :--- | :--- |
| **Core math** | `packages/core`: P&L, ticks, sessions, classification, `deriveTrades` | docs/07, docs/09 §3–4 |
| **Chart** | Chart component, primitives, snapshot rendering | docs/02, docs/07, docs/08 §5–6 |
| **App shell and notes** | Feed, Today, Trade Detail layout, Pit Stop, design tokens | docs/03, docs/05, docs/08 |
| **Data** | Migrations, RLS, queries, storage | docs/06, docs/09 §5, §8 |
| **Market data** | Providers, enrichment passes, session levels | docs/02, docs/09 §2 |
| **Ingestion** | Pull route, CSV import, listener | docs/01, docs/09 §1 |
| **AI review** | Context plugins, prompts, output schema | docs/04, docs/09 §7 |

Rules:

- **`packages/core` is the contract between lanes.** A change to a shared type lands in its own small PR before the code that uses it.
- **One owner per lane at a time.** Claim it in [NOTES.md](NOTES.md) before starting and release it when done.
- **Crossing a lane** means telling its owner first, or leaving a note if the owner is an agent session that has ended.

---

## 3. How changes land

- **Short-lived branches** off `main`: `lane/short-description`, for example `chart/position-box-snap`.
- **Small PRs.** Aim for under about 400 changed lines. One purpose per PR.
- **Spec and code together.** If behaviour differs from the spec, the spec changes in the same PR. A PR that leaves a spec wrong is not done.
- **One migration per PR.** Never edit a migration that has been applied anywhere. Regenerate and commit types with it.
- **No shared database for development.** Previews and local work use a dev Supabase project with seed data, never production (B-48).
- **Cite IDs.** PR descriptions name the `B-nn`, `UX-nn` and `OD-n` items they address.
- **Commits** say what changed and why, in plain language. No secrets in commits, ever.

### Definition of done

- [ ] Type check, lint and tests pass, and the output is in the PR.
- [ ] Money, time or session logic has golden tests, including a DST week and a multi-fill trade.
- [ ] UI work meets the `AGENTS.md` §4 checklist and the [docs/08 §16](docs/08-ux-notes-viewing-and-journaling.md#16-acceptance-checklist-adds-to-agentsmd-4) checklist, checked on a phone-sized viewport.
- [ ] The seven invariants and the additional guardrails in `AGENTS.md` hold.
- [ ] Specs, `DECISIONS.md` and `NOTES.md` are updated.

---

## 4. Working with AI agents

Different developers will use different tools. The files, not the tool, carry the context.

- **One agent, one slice.** Use the slice table in [docs/07 §2](docs/07-agent-guardrails-and-smart-notes.md). Name the files it must read.
- **Two agents never edit the same file at once.** Use separate branches or worktrees and merge through PRs.
- **An agent that finds a conflict between specs stops and records it** in `DECISIONS.md`. It does not resolve it by inventing a name or a behaviour.
- **"Done" needs evidence.** The handoff includes the commands run and their real output. A claim without output is treated as not verified.
- **Agents leave a handoff note** in [NOTES.md](NOTES.md) at the end of a session, in the format given there.
- **Agents do not close decisions, change invariants, or touch secrets.** They propose. A person decides.
- **Check external facts.** Vendor limits and terms change. [docs/09 §10](docs/09-backend-risk-register.md#10-verification-log-2026-11-14) records what was verified and when. Re-verify anything older than a few months before building on it.

---

## 5. Fixtures: nobody needs a broker account to contribute

Most contributors will not have TopstepX credentials. The app must be fully workable without them.

- `fixtures/trades/` holds realistic `MES` trades: a clean winner, a stop-out, a multi-fill scale-out, a reversal, a 40-second scalp, a trade across the 09:30 open, and one during a roll week.
- `fixtures/broker-events/` holds recorded trade and order events for replay through the same `deriveTrades` function the listener uses.
- `fixtures/candles/` holds matching candle sets, so charts render offline and tests are deterministic.
- Fixtures contain no real account ids, names or balances.

---

## 6. Environments and secrets

| Variable | Used by | Visible to the browser? |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Web | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web | Yes. Safe only because RLS is on (B-40). |
| `SUPABASE_SERVICE_ROLE_KEY` | Server routes, listener | **Never** |
| `DEFAULT_OWNER_USER_ID` | Server routes, listener | No |
| `TOPSTEPX_USERNAME`, `TOPSTEPX_API_KEY` | Pull route, listener | **Never** |
| AI provider key | Review route | **Never** |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push | Public key only |

- Real values live in Vercel, Google Secret Manager and each developer's untracked `.env.local`.
- Only names go in the repo. Add `.env.example` when the app is scaffolded.
- A secret that reaches a commit, a log or client code is rotated the same day.

---

## 7. Test what is expensive to get wrong

In this order:

1. **Money:** P&L from fills, integer ticks, micro versus mini multipliers, fees, R.
2. **Time:** session dates, DST weeks, half-days, bar snapping.
3. **Trade derivation:** scale-ins, partial exits, reversals, voided fills, replays producing identical trades.
4. **Read-only broker client:** a test that fails if an order endpoint is referenced (B-01).
5. **Chart snapshot:** the Position Box is present in the exported image (B-61).

Pixel-perfect UI tests come after these.
