"use client";

// Strategy Lab workspace (docs/design-2026-11-24/09 §1, §6.3, §10, §12).
// Connects Mark + Context Card -> Find similar -> Recipe list & editor -> Run over 1m history -> Results + Overlay.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { StrategyLabMark, seedFromTrade, type MarkSeed } from "@/components/StrategyLabMark";
import { StrategyLabRecipes } from "@/components/StrategyLabRecipes";
import { StrategyLabRecipeEditor } from "@/components/StrategyLabRecipeEditor";
import { StrategyLabResults } from "@/components/StrategyLabResults";
import { StrategyLabOverlay } from "@/components/StrategyLabOverlay";
import { hydrateAccounts, useAccounts } from "@/lib/accounts-store";
import { activePlaybooks, hydratePlaybooks, usePlaybooks } from "@/lib/playbooks-store";
import { hydratePrefs, usePrefs } from "@/lib/prefs";
import { sessionDate } from "@/lib/session";
import { hydrateJournal, useJournal } from "@/lib/store";
import { loadBarSeries, recentSessionDates } from "@/lib/strategy-lab/bars";
import { markTimeUtc, rSizeBasis, type CardMark, type CardRSize } from "@/lib/strategy-lab/context-card";
import { overlayRecipe } from "@/lib/strategy-lab/overlay";
import { labRSize } from "@/lib/strategy-lab/r";
import { draftFromRecipe, type Draft } from "@/lib/strategy-lab/recipe-draft";
import {
  exportRecipesJson, findRecipe, importRecipesJson, latestRecipes, loadRecipeStore, saveRecipe, saveRecipeStore,
  type RecipeStore,
} from "@/lib/strategy-lab/recipes-store";
import { markSeedFromBar, runSummaryLine, skillSliceLabel } from "@/lib/strategy-lab/results-view";
import { runRecipe } from "@/lib/strategy-lab/runner";
import { findSimilarRecipe } from "@/lib/strategy-lab/similar";
import type { BarSeries, Recipe, RunResult } from "@/lib/strategy-lab/types";

const RUN_SESSIONS = 22;
const LIMITS_TEXT =
  "1-minute history: about the last 30 days (Yahoo). Older sessions are skipped. Volume baselines use at most ~20 sessions. No news filter. Δ is a proxy.";

type LabTab = "mark" | "recipes" | "runs";
const TABS: readonly { id: LabTab; label: string }[] = [
  { id: "mark", label: "Mark" },
  { id: "recipes", label: "Recipes" },
  { id: "runs", label: "Runs" },
];

const SERVER_STORE: RecipeStore = { recipes: [] };
let clientStore: RecipeStore | null = null;
const storeListeners = new Set<() => void>();

function subscribeRecipeStore(listener: () => void) {
  storeListeners.add(listener);
  return () => { storeListeners.delete(listener); };
}

function getClientRecipeStore(): RecipeStore {
  if (clientStore === null && typeof window !== "undefined") {
    try { clientStore = loadRecipeStore(window.localStorage).store; } catch { clientStore = SERVER_STORE; }
  }
  return clientStore ?? SERVER_STORE;
}

function setClientRecipeStore(next: RecipeStore) {
  clientStore = next;
  if (typeof window !== "undefined") {
    try { saveRecipeStore(window.localStorage, next); } catch { /* in-memory session continues */ }
  }
  storeListeners.forEach((listener) => listener());
}

interface StoredRun {
  recipe: Recipe;
  series: BarSeries;
  result: RunResult;
  accountName: string | null;
}

type RunJob =
  | { status: "idle" }
  | { status: "loading"; recipe: Recipe; anchorDate: string; done: number; total: number }
  | { status: "error"; recipe: Recipe; anchorDate: string; message: string };

type EditorTarget =
  | { mode: "closed" }
  | { mode: "edit"; key: string; recipeId: string | null; initialDraft?: Draft | null; reasons?: readonly string[]; anchorDate?: string };

export function StrategyLabWorkspace() {
  const searchParams = useSearchParams();
  const playbookParam = searchParams.get("playbook");
  const tradeParam = searchParams.get("trade");

  useEffect(() => {
    hydratePrefs();
    hydrateAccounts();
    hydratePlaybooks();
    hydrateJournal();
  }, []);

  const recipeStore = useSyncExternalStore(subscribeRecipeStore, getClientRecipeStore, () => SERVER_STORE);
  const accountStore = useAccounts();
  const playbooksStore = usePlaybooks();
  const journal = useJournal();
  const prefs = usePrefs();

  const [tab, setTab] = useState<LabTab>("mark");
  const [userPlaybookId, setUserPlaybookId] = useState<string | null | undefined>(undefined);
  const [accountId, setAccountId] = useState("");
  const [userSeed, setUserSeed] = useState<MarkSeed | null>(null);
  const [editor, setEditor] = useState<EditorTarget>({ mode: "closed" });
  const [runsById, setRunsById] = useState<Record<string, StoredRun>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runJob, setRunJob] = useState<RunJob>({ status: "idle" });
  const [includeSamples, setIncludeSamples] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [backupText, setBackupText] = useState("");

  const paramTrade = tradeParam ? journal.trades.find((t) => t.id === tradeParam) ?? null : null;
  const paramSeed = paramTrade ? seedFromTrade(paramTrade) : null;
  const activeSeed = userSeed ?? paramSeed;
  const playbookId = userPlaybookId !== undefined ? userPlaybookId : (playbookParam || paramTrade?.playbook_id || null);

  const accounts = accountStore.accounts.filter((a) => !a.archived);
  const playbooks = activePlaybooks(playbooksStore.playbooks, playbookId);
  const selectedPlaybook = playbooks.find((pb) => pb.id === playbookId) ?? null;
  const effectiveAccountId = accountId || activeSeed?.accountId || "";
  const selectedAccount = accounts.find((a) => a.id === effectiveAccountId) ?? null;
  const rSize = labRSize(selectedAccount?.id ?? null, accounts, prefs);
  const cardRSize: CardRSize = { usd: rSize.usd, source: rSize.source, accountName: selectedAccount?.name ?? null };
  const basisLabel = rSizeBasis(cardRSize, prefs.shield);

  async function executeRun(recipe: Recipe, anchorDate = sessionDate(Date.now())) {
    setTab("runs");
    setNotice(null);
    setRunJob({ status: "loading", recipe, anchorDate, done: 0, total: RUN_SESSIONS });
    const dates = recentSessionDates(anchorDate, RUN_SESSIONS);
    try {
      const loaded = await loadBarSeries(dates, {
        onProgress: (done, total) => setRunJob((prev) => (prev.status === "loading" ? { ...prev, done, total } : prev)),
      });
      if (loaded.loads.every((l) => l.status !== "loaded")) {
        setRunJob({ status: "error", recipe, anchorDate, message: "Could not load bars, retry" });
        return;
      }
      const runAcct = recipe.account.accountId
        ? accounts.find((a) => a.id === recipe.account.accountId) ?? selectedAccount
        : selectedAccount;
      const runR = labRSize(runAcct?.id ?? null, accounts, prefs);
      const result = runRecipe(recipe, loaded.series, {
        rSizeUsd: runR.usd,
        rSizeSource: runR.source,
        accountName: runAcct?.name ?? null,
        trades: journal.trades,
        includeSamples,
      });
      setRunsById((prev) => ({
        ...prev,
        [recipe.id]: { recipe, series: loaded.series, result, accountName: runAcct?.name ?? null },
      }));
      setActiveRunId(recipe.id);
      setRunJob({ status: "idle" });
    } catch {
      setRunJob({ status: "error", recipe, anchorDate, message: "Could not load bars, retry" });
    }
  }

  function handleFindSimilar(series: BarSeries, mark: CardMark, markR: CardRSize, saveNow: boolean) {
    const markUtc = markTimeUtc(mark);
    const sim = findSimilarRecipe(series, { time: markUtc, price: mark.price, side: mark.side }, {
      rSizeUsd: markR.usd,
      playbookId,
    });
    if (!sim.ok) {
      setNotice(sim.reason);
      return;
    }
    setNotice(null);
    const anchor = sessionDate(markUtc);
    if (saveNow) {
      const saved = saveRecipe(recipeStore, sim.recipe);
      if (saved.ok) {
        setClientRecipeStore(saved.store);
        setEditor({ mode: "edit", key: `${saved.recipe.id}@${saved.recipe.version}`, recipeId: saved.recipe.id, reasons: sim.reasons, anchorDate: anchor });
        setTab("recipes");
        return;
      }
    }
    setEditor({
      mode: "edit",
      key: `sim-${markUtc}-${mark.side}`,
      recipeId: sim.recipe.id,
      initialDraft: draftFromRecipe(sim.recipe),
      reasons: sim.reasons,
      anchorDate: anchor,
    });
    setTab("recipes");
  }

  function openAtBar(barOpenMs: number, run: StoredRun) {
    const idx = run.series.byTime.get(barOpenMs);
    const close = idx !== undefined && Number.isFinite(run.series.close[idx]) ? run.series.close[idx] : 5900;
    const fields = markSeedFromBar(barOpenMs, close, run.recipe.side);
    setUserSeed({ key: `bar:${barOpenMs}`, ...fields, accountId: effectiveAccountId });
    setTab("mark");
  }

  const lastRuns: Record<string, string> = {};
  for (const [id, entry] of Object.entries(runsById)) lastRuns[id] = runSummaryLine(entry.result);

  const activeRun = (activeRunId ? runsById[activeRunId] : undefined) ?? Object.values(runsById)[0] ?? null;
  const overlaySummary = activeRun
    ? overlayRecipe({
      recipe: activeRun.recipe,
      series: activeRun.series,
      trades: journal.trades,
      rSize: {
        usd: activeRun.result.data.rSize.usd,
        source: activeRun.result.data.rSize.source === "account" ? "account" : "default",
      },
      accountName: activeRun.accountName,
      run: activeRun.result,
      includeSamples,
      shield: prefs.shield,
    })
    : null;

  const editingStored = editor.mode === "edit" && editor.recipeId ? findRecipe(recipeStore, editor.recipeId) : undefined;
  const newestHasRuns = Boolean(
    editingStored && runsById[editingStored.id]?.recipe.version === editingStored.version,
  );
  const runnableRecipe: Recipe | undefined = editingStored
    ?? (editor.mode === "edit" && editor.initialDraft ? (editor.initialDraft as unknown as Recipe) : undefined);

  return (
    <>
      <nav className="sl-seg sl-tabs" aria-label="Strategy Lab views">
        {TABS.map((item) => (
          <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      {notice ? <p className="sl-notice" role="status">{notice}</p> : null}

      {tab === "mark" ? (
        <StrategyLabMark
          key={activeSeed?.key ?? "default"}
          seed={activeSeed}
          playbookId={playbookId}
          onPlaybookChange={(next) => setUserPlaybookId(next)}
          accountId={effectiveAccountId}
          onAccountChange={setAccountId}
          onFindSimilar={(series, mark, markR) => handleFindSimilar(series, mark, markR, false)}
          onSaveAsRecipe={(series, mark, markR) => handleFindSimilar(series, mark, markR, true)}
        />
      ) : null}

      {tab === "recipes" ? (
        editor.mode === "edit" ? (
          <div className="sl-result">
            {editor.reasons && editor.reasons.length > 0 ? (
              <section className="sl-card" aria-label="Why these conditions">
                <h3 className="sl-card-title">Why these conditions</h3>
                <ul className="sl-overlay__conditions">
                  {editor.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
                </ul>
              </section>
            ) : null}
            {runnableRecipe ? (
              <button
                type="button"
                className="sl-btn sl-btn--primary sl-btn--block"
                onClick={() => { void executeRun(runnableRecipe, editor.anchorDate); }}
              >
                Run over history ({RUN_SESSIONS} sessions)
              </button>
            ) : null}
            <StrategyLabRecipeEditor
              key={editor.key}
              store={recipeStore}
              recipeId={editor.recipeId}
              playbookId={playbookId}
              initialDraft={editor.initialDraft}
              newestHasRuns={newestHasRuns}
              rSizeLabel={basisLabel}
              onSave={(nextStore, saved) => {
                setClientRecipeStore(nextStore);
                setEditor({ mode: "edit", key: `${saved.id}@${saved.version}`, recipeId: saved.id, anchorDate: editor.anchorDate });
              }}
              onCancel={() => setEditor({ mode: "closed" })}
            />
          </div>
        ) : (
          <div className="sl-result">
            <div className="sl-field">
              <label className="sl-label" htmlFor="sl-recipes-playbook">Playbook filter</label>
              <select id="sl-recipes-playbook" className="sl-input" value={playbookId ?? ""} onChange={(e) => setUserPlaybookId(e.target.value || null)}>
                <option value="">All recipes</option>
                {playbooks.map((pb) => <option key={pb.id} value={pb.id}>{pb.name}</option>)}
              </select>
            </div>
            <StrategyLabRecipes
              store={recipeStore}
              playbookId={playbookId}
              playbookName={selectedPlaybook?.name}
              lastRuns={lastRuns}
              onNew={() => setEditor({ mode: "edit", key: `new-${Date.now()}`, recipeId: null })}
              onOpen={(id) => setEditor({ mode: "edit", key: `open-${id}`, recipeId: id })}
            />
            <details className="sl-group">
              <summary><span>Backup JSON</span></summary>
              <div className="sl-form" style={{ paddingBottom: 8 }}>
                <textarea
                  className="sl-input"
                  rows={5}
                  aria-label="Recipes backup JSON"
                  value={backupText}
                  placeholder="Export or paste { &quot;recipes&quot;: [...] }"
                  onChange={(e) => setBackupText(e.target.value)}
                />
                <div className="sl-actions">
                  <button type="button" className="sl-btn sl-btn--block" onClick={() => setBackupText(exportRecipesJson(recipeStore))}>
                    Export JSON
                  </button>
                  <button
                    type="button"
                    className="sl-btn sl-btn--block"
                    onClick={() => {
                      const parsed = importRecipesJson(backupText);
                      if (parsed.error) { setNotice(parsed.error); return; }
                      setClientRecipeStore(parsed.store);
                      setNotice(`Imported ${parsed.store.recipes.length} recipe version(s).`);
                    }}
                  >
                    Import JSON
                  </button>
                </div>
              </div>
            </details>
          </div>
        )
      ) : null}

      {tab === "runs" ? (
        <div className="sl-result">
          <details className="sl-group">
            <summary><span>Data limits</span></summary>
            <p className="sl-excluded" style={{ paddingBottom: 8 }}>{LIMITS_TEXT}</p>
          </details>

          {runJob.status === "loading" ? (
            <div className="sl-status" aria-busy="true">
              <p role="status" aria-live="polite" style={{ margin: 0 }}>
                Loading bars · {runJob.done} of {runJob.total} sessions
              </p>
            </div>
          ) : null}

          {runJob.status === "error" ? (
            <div className="sl-status sl-status--error">
              <p role="alert" style={{ margin: 0 }}>{runJob.message}</p>
              <button type="button" className="sl-btn" onClick={() => { void executeRun(runJob.recipe, runJob.anchorDate); }}>
                Retry
              </button>
            </div>
          ) : null}

          {activeRun ? (
            <StrategyLabResults
              result={activeRun.result}
              title={activeRun.recipe.name}
              accountName={activeRun.accountName}
              shield={prefs.shield}
              labelOf={(ref) => skillSliceLabel(ref)}
              series={activeRun.series}
              onOpenAt={(time) => openAtBar(time, activeRun)}
              overlay={(
                <StrategyLabOverlay
                  summary={overlaySummary}
                  includeSamples={includeSamples}
                  onIncludeSamplesChange={setIncludeSamples}
                  hideBasis
                />
              )}
            />
          ) : runJob.status === "idle" ? (
            <section className="sl-card" aria-label="No run yet">
              <p className="sl-hint">
                No recipe run in this session yet. Mark a point and tap Find similar, or pick a saved recipe to run.
              </p>
              {latestRecipes(recipeStore).map((rcp) => (
                <button key={rcp.id} type="button" className="sl-btn sl-btn--block" onClick={() => { void executeRun(rcp); }}>
                  Run {rcp.name} (v{rcp.version})
                </button>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
