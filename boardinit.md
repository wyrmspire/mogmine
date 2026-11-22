# `boardinit.md` — Multi-Lane Board Planning & Master-Agent Dispatch (`boardinit`)

> **Trigger:** When the owner says **`board init <N> lanes`** (or **`boardinit <N> lanes`**), run this protocol as the **Master Agent** to plan `N - 1` isolated worker lanes on [`BOARD.md`](BOARD.md), spin up their `git worktree`s, and output `N - 1` ready-to-paste worker prompt boxes in chat — then serve as **Final Pass (`Lane N`)** when the workers finish.

---

## 1. Core Structure (`N` Lanes = `N - 1` Workers + `1` Master / Final Pass)

- **Master Agent (Planner + Final Integrator):**
  - **At launch:** Audits repo/board, sets up the baseline commit, updates [`BOARD.md`](BOARD.md), creates `N - 1` isolated `git worktree` folders (joining `node_modules` via `mklink /J` on Windows), and outputs the `N - 1` copyable worker prompt boxes.
  - **At wrap-up (`Lane N` Final Pass):** Merges worker branches in dependency order, wires pure-selector outputs into shared UI shells, runs the **single authoritative** full verification gate (`npm test`, `npm run typecheck`, `npm run lint`, `npx next build --webpack`, and headless Chrome `390×844` UI/chart checks), folds `notes/handoffs/` into [`NOTES.md`](NOTES.md), updates `BOARD.md`, removes temporary worktrees, and feeds tactical lessons into [`AGENTS.md`](AGENTS.md) and `BOARD.md`.
- **Worker Lanes (`1` through `N - 1`):**
  - Each worker runs in its **own `git worktree`** on its **own branch** with strict writable files (~300–450 changed lines max).
  - **Lightweight worker checks:** Workers run targeted unit tests for their slice + `npm run typecheck` (skipping redundant full-repo `next build` and Chrome UI sweeps, which the Master Agent runs once after merging all lanes).

---

## 2. How to Execute `board init <N> lanes`

### Step 1 — Audit Current Repo & Establish Clean Baseline
1. Read [`AGENTS.md`](AGENTS.md), [`BOARD.md`](BOARD.md), [`NOTES.md`](NOTES.md), [`DECISIONS.md`](DECISIONS.md), and recent files in `notes/handoffs/`.
2. Confirm a clean baseline commit (reconcile any pending review work first so all worktrees branch from the same reviewed commit).
3. Identify **shared-file hotspots** (`app/globals.css`, `lib/trades.ts`, `lib/store.ts`, `components/TradeDetail.tsx`, `components/AddTradeSheet.tsx`, `components/TradeChart.tsx`, `BOARD.md`).

### Step 2 — Plan & Create Isolated Worktrees
1. Partition work into `N - 1` bounded slices (`Lane 1`..`Lane N-1`) + `1` Final Pass (`Lane N`).
   - Keep pure view-models/selectors in new isolated files so multiple workers never edit `TradeDetail.tsx`, `TradeChart.tsx`, or `app/globals.css` in parallel.
2. Update `BOARD.md` §1b with each lane's exact **Writable Files**, **Must Avoid**, **Dependencies**, **Target Size**, and **Status**.
3. Create one `git worktree` + `node_modules` junction per worker off the baseline commit:
   ```powershell
   git worktree add ..\mogmine-w1 -b feat/mm-w1-01 <baseline>
   cmd /c mklink /J ..\mogmine-w1\node_modules .\node_modules
   ```

### Step 3 — Output Copyable Worker Prompt Boxes in Chat
Output **`N - 1` fenced code blocks** (one per worker lane, clearly titled `### Lane 1` .. `### Lane N-1`) plus a short note that the Master Agent will run **`Lane N` (Final Pass)** once workers finish.

Each worker box must tell the agent:
1. Its **exact worktree path** (e.g. `C:\Users\CLPUB\Documents\mogmine-w1`) and branch name.
2. To read `AGENTS.md`, `BOARD.md`, and its matching `docs/` spec first.
3. Its **exact writable files** and **must-avoid files** (never edit `BOARD.md`, `NOTES.md`, or unlisted production files).
4. To run **targeted tests + `npm run typecheck`** (leaving full `next build` and Chrome UI checks to the Master Agent's Final Pass).
5. To commit on its worktree branch and write a handoff at `notes/handoffs/<YYYY-MM-DD>-<lane>.md` with commit hash, changed files, real test/typecheck output, exported signatures, and any tactical issues encountered.

### Step 4 — Master Agent Final Pass (`Lane N`)
When the owner signals that workers are done:
1. Read all worker handoffs in `notes/handoffs/` and inspect each worker branch.
2. Merge worker branches in dependency order into the integration branch (models -> pure selectors -> UI/routes -> accessibility), wiring any pure exports into shared UI shells.
3. Run the **full verification gate** once on the integrated tree:
   - `npm test`
   - `npm run typecheck`
   - `npm run lint`
   - `npx next build --webpack` (Windows) / `npm run build`
   - Headless Chrome `390×844` overflow/console/chart checks (`CHROME_BIN="C:\Program Files\Google\Chrome\Application\chrome.exe"`).
4. Fold completed handoffs into `NOTES.md`, update `BOARD.md` statuses, remove temporary worktrees (`git worktree remove`), and record tactical lessons in `AGENTS.md` and `BOARD.md`.

---

## 3. Tactical Learning Loop (`AGENTS.md` + `BOARD.md`)

Every `boardinit` operation improves the next one:
- Record tooling/environment fixes (e.g., Windows `next build --webpack`, `mklink /J` for worktree `node_modules`, portable Node/MinGit paths) in `AGENTS.md` or `NOTES.md`.
- Tighten file-ownership boundaries whenever two lanes touch adjacent code.
- Keep `TradeRecord` extensions optional (`?:`) so existing test fixtures stay valid across parallel branches.
