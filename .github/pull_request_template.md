## What and why

<!-- One or two sentences. Cite the items this addresses: B-nn, UX-nn, OD-n. -->

## Lane

<!-- Core math / Chart / App shell and notes / Data / Market data / Ingestion / AI review / Docs -->

## Evidence

<!-- Commands run and their real output. For UI: the viewport used and the budgets measured (docs/08 §2). -->

## Checklist

- [ ] The seven invariants and the additional guardrails in `AGENTS.md` hold
- [ ] Specs updated in this PR where behaviour changed
- [ ] `DECISIONS.md` updated if a decision was made or a spec conflict was found
- [ ] `NOTES.md` handoff entry added and lane claim updated
- [ ] No secrets, account ids or real balances in code, fixtures or screenshots
- [ ] At most one migration, and no applied migration was edited
- [ ] UI: checked at 390×844 against `AGENTS.md` §4 and `docs/08` §16
- [ ] Over-target files (`AGENTS.md` §6.12, `npm run check:file-length`): every file over 450 lines that this PR touches or grows is listed under Evidence with its line count before and after, and justified or split. Write "none" if there are none.
