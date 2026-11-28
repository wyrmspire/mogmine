# Learning and research integrity handoff

Package 5 (RM-I1 + RM-J2/J3/J6/J7) is integrated in the shared tree.

## Delivered

- Added immutable `PlaybookVersion` snapshots and a separate local history key. The first rule edit preserves the prior live playbook as v1 and records the edited rules as v2; later edits append versions. `playbookVersion`, `playbookVersions`, and `currentPlaybookVersion` return exact snapshots and never fall back silently to current rules.
- The editor displays the current playbook version. Trade-record wiring is intentionally not included in this package because `TradeRecord` is outside the writable scope. A future integration should add a nullable `playbook_version` reference and resolve it through `playbookVersion`; missing snapshots must remain explicit rather than rewriting history.
- Added Strategy Lab research governance metadata to every run: discovery/validation mode, searched conditions and variants, independent session count, deterministic recipe hash, source, roll, and held-out flag. Held-out is only true for explicit validation mode; exploratory runs remain clearly labeled as discovery.
- Persisted and sanitized the governance metadata with local/remote runs.
- Results now show explicit `Hypothetical` labeling, slippage assumptions, governance mode, session independence, recipe hash, searched scope, source, and roll. No commission assumption was added.

## Verification

Ran:

```text
git diff --check -- lib/playbooks.ts lib/playbooks-store.ts lib/playbook-lab.ts lib/strategy-lab/types.ts lib/strategy-lab/recipes-store.ts lib/strategy-lab/runner.ts lib/strategy-lab/persistence.ts lib/strategy-lab/results-view.ts components/StrategyLabResults.tsx components/PlaybookEditor.tsx
```

Result: clean, with no output. Tests, build, lint, and typecheck were not run per owner instruction.

All touched production files are below the 450-line limit.
