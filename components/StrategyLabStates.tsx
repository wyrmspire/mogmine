export function StrategyLabOfflineNotice() {
  return <p className="sl-notice" role="status" aria-live="polite">Offline mode: local recipes and cached bars remain available; archive and history refreshes will recover when you reconnect.</p>;
}

export function StrategyLabEmptyArchive({ onLoad }: { onLoad: () => void }) {
  return <section className="sl-card" aria-label="Empty MES archive" role="status">
    <h3 className="sl-card-title">MES archive is empty</h3>
    <p className="sl-hint">No sessions are cached yet. Load the archive to add history for Strategy Lab runs.</p>
    <button type="button" className="sl-btn sl-btn--primary" onClick={onLoad}>Load MES Archive</button>
  </section>;
}

export function StrategyLabEmptyRecipes() {
  return <section className="sl-card" aria-label="Empty recipe list" role="status">
    <h3 className="sl-card-title">No recipes yet</h3>
    <p className="sl-hint">Create a recipe, load the starter recipe, or import a backup to begin.</p>
  </section>;
}

export function StrategyLabRunLoading({ done, total }: { done: number; total: number }) {
  return <div className="sl-status" aria-busy="true" role="status" aria-label="Loading run history">
    <p role="status" aria-live="polite" style={{ margin: 0 }}>Loading bars · {done} of {total} sessions</p>
  </div>;
}

export function StrategyLabRunError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="sl-status sl-status--error" role="alert" aria-label="Run history error">
    <p role="alert" style={{ margin: 0 }}>{message}</p>
    <button type="button" className="sl-btn" onClick={onRetry}>Retry</button>
  </div>;
}

