# Responsive Regression Plan

> Scope: visual and interaction regression coverage for MogMine’s six main surfaces. This plan operationalizes `RM-B10`, `DS-09`, `DS-10`, and `DS-11`. It defines the review contract; it does not add test code or change product behavior.

## Viewports and capture rules

Every screen in the matrix is checked at both viewports:

| Viewport | Purpose | Required capture conditions |
|---|---|---|
| `390×844` | Primary phone layout and touch target check | Dark theme, default zoom, no browser chrome in the capture, viewport exactly 390 CSS px wide by 844 CSS px high. Verify the first decision-critical content without relying on horizontal scrolling. |
| Desktop | Wide layout and keyboard check | Use the project’s standard desktop capture width (record the exact width in the run, minimum 1280 CSS px) at 1× browser zoom. Verify centered/max-width behavior, chart readability, and no unintended tablet-width breakpoints. |

For each state, capture the initial viewport and any intentional one-level disclosure. Do not compare timestamps, generated IDs, or live market values as pixels; freeze fixture data and compare their layout, labels, hierarchy, and formatting instead. A changed screenshot is actionable when it changes decision hierarchy, clips content, hides a required state, breaks a control, or introduces overflow—not when antialiasing differs.

## State vocabulary

The following names are the canonical fixture/state labels. A screen may show more than one state-specific banner, but it must never present a blank panel or spinner without words.

- `loading`: the screen is waiting for local or remote data and identifies what is loading.
- `ready`: normal populated state with representative real-trade fixtures.
- `empty`: no records exist for the selected scope, with a useful next action.
- `caught-up`: no action is due; used by Today/queue surfaces rather than as a generic empty state.
- `offline`: device is disconnected or the remote source is unavailable; local data remains understandable.
- `error`: the requested operation failed and the failure is named without exposing internals.
- `recovery`: the state exposes a retry, reconnect, create, or return action where one is possible.
- `attention-needed`: data exists but a truth or archive issue requires review; it must be exception-only and specific.

## Main-screen regression matrix

| Screen / owner | `390×844` visual states | Desktop visual states | Keyboard checks | Touch checks | Ownership / handoff |
|---|---|---|---|---|---|
| **Today** (`TodayScreen.tsx`, Track C) | `loading`, `ready`, `caught-up`, `attention-needed`, `offline`. Level one keeps account, risk/1R, Shield and sync visible. The Next card shows item #1 expanded and `N more` for additional actions; no more than three ranked actions. | Same states. Confirm the decision card, session summary, confidence exception and supporting sections align without competing as dashboards. Confirm no horizontal overflow. | Tab order follows the decision path. Focus reaches Next actions, disclosure, review link and recovery controls. Enter activates the focused action; Esc closes any open sheet/disclosure without losing focus. | All primary actions and disclosure controls are at least 44×44 px. Tap the first Next action, `N more`, review link, and any retry/reconnect action. | Track C owner; integrator owns shell/layout comparison. Coordinate with `RM-C1`, `RM-C2`, `RM-C5`, and `DS-08`/`DS-10`. |
| **Trade Detail** (`TradeDetail.tsx`, Track E) | `loading`, `ready`, `offline`, `error`, `recovery`, `attention-needed`. Price action first; Entry/Exit, Initial stop, Result R and account context remain visible without scrolling through secondary evidence. Stop history, partials and plan-vs-actual use one clear `More trade evidence` disclosure. | Same states. Chart, levels, facts, judgment and evidence retain a stable hierarchy at wide width. Verify chart does not become a decorative oversized panel or clip hit targets. | Tab through chart controls, trade facts, Pit Stop, disclosure and actions. Esc closes sheets/disclosures and restores the triggering control. J/K/Enter/Esc behavior must not hijack browser shortcuts when focus is in an editable control. | Pinch/scroll zoom continues toward approximately 1px candles; crosshair, candle and level hit-testing remain accurate. Tap targets are at least 44×44 px. Disclosure and Pit Stop remain reachable. | Track E owner; chart interaction owner reviews hit-testing. Coordinate with `RM-E2`, `RM-E6`, `RM-E5`, `DS-02`, `DS-09`, and `DS-10`. |
| **Review** (`ReviewScreen.tsx`, Track D) | `loading`, `ready`, `empty`, `caught-up`, `offline`, `error`, `recovery`. Queue rows remain readable and do not collapse provenance, review status, or the primary open action. | Same states. Confirm queue density, filters, badge/count treatment, and row focus remain readable at desktop width. | J/K moves through visible rows; Enter opens the focused trade; Esc clears row focus or closes the current sheet. Modifier shortcuts and editable controls are untouched. Focus is visible and restored after close. | Swipe/scroll the queue without accidental row activation. Tap row, filter, open, retry, and empty-state recovery actions; all meet 44×44 px. | Track D owner with K-track API/read-model owner for queue data. Coordinate with `RM-D5`, `RM-K2`, `RM-F3`, `DS-05`, `DS-06`, and `DS-11`. |
| **Feed / Journal** (`FeedScreen.tsx`, Track F) | `loading`, `ready`, `empty`, `offline`, `error`, `recovery`. Browse/search remains primary; Real/Replay/All scope is explicit and sample/replay rows are visibly labelled. | Same states. Confirm browse/search hierarchy, filters, row density, and no analytics panels creeping into Feed. | J/K moves through visible trade rows; Enter opens the focused trade; Esc clears focus. Do not override Cmd/Ctrl+C, Cmd/Ctrl+F, or Cmd/Ctrl+R. Focus hints are subtle and non-blocking. | Touch scrolling is native and uninterrupted. Tap filters, search, row, and retry/recovery controls. Verify no hover-only affordance is required. | Track F owner; integrator checks shared navigation and sample isolation. Coordinate with `RM-F3`, `RM-F4`, `DS-05`, `DS-09`, and `DS-11`. |
| **Tools / Tune** (`TuneScreen.tsx`, Track A plus shared tools) | `loading`, `ready`, `empty`, `offline`, `error`, `recovery`, `attention-needed`. Archive status names local/unconfigured mode, healthy status, and missing/failed archive attention. Local journal and account/history empties explain what to do next. | Same states. Confirm archive status, storage persistence, account controls, and recovery actions remain grouped and scannable rather than becoming a dense admin dashboard. | Tab order reaches archive status, retry, storage status, account actions, and forms. Esc cancels editable broker-balance entry and closes sheets. Enter submits only the focused form action. | Tap retry, reconnect/sign-in, account actions, and form controls. Confirm 44×44 px targets and no clipped status text at 390 px. | Track A/Tools owner; integrator owns shared status treatment. Coordinate with `RM-A4`, `RM-A12`, `RM-M4`, `RM-B9`, `DS-07`, `DS-10`, and `DS-11`. |
| **Strategy Lab** (`StrategyLabWorkspace.tsx`, `StrategyLabResults.tsx`, Track J) | `loading`, `ready`, `empty`, `offline`, `error`, `recovery`, `attention-needed`. Recipe/history empties and archive failures are explicit. Results visibly say `Hypothetical` and show slippage assumptions; simulated context never reads as executed trades. | Same states. Confirm workspace/results split, controls, result hierarchy, hypothetical labeling, and evidence disclosures without horizontal overflow. | Tab through recipe controls, run/retry, history rows, result controls, and disclosures. Enter submits the intended run/action; Esc closes a disclosure or sheet and restores focus. | Tap recipe selection, run, retry, history, and disclosure controls. Verify charts and tables can be explored by touch without hijacking page scroll; targets are at least 44×44 px. | Track J owner with Track A archive owner. Coordinate with `RM-J3`, `RM-J6`, `RM-B4`, `RM-B9`, `DS-05`, `DS-09`, and `DS-11`. |

## Cross-screen named-state fixtures

The regression run should use the same fixtures wherever a state is shared:

| Fixture | Required screens | Expected assertion |
|---|---|---|
| `fixture-loading` | All six | A plain-language loading label identifies the data, and layout reserves the eventual content area without spinner-only UI. |
| `fixture-empty` | Today, Review, Feed, Tools, Strategy Lab | Empty scope is named, differs from caught-up, and offers the appropriate create/filter/retry path. |
| `fixture-offline` | Today, Review, Feed, Tools, Strategy Lab, Trade Detail | Offline/unavailable status is visible, local data is not falsely presented as synced, and reconnect/retry wording is calm and actionable. |
| `fixture-error-recovery` | All six where an operation can fail | Error copy is human-readable, recovery action is reachable by keyboard and touch, and retry does not shift focus unexpectedly. |
| `fixture-attention` | Today, Trade Detail, Tools, Strategy Lab | Attention appears only for a concrete truth/archive issue and includes the affected count or reason. |
| `fixture-ready-real` | All six | Real trade/account data is coherent, signed values use tabular figures, and required provenance or hypothetical labels are present. |

## Run ownership and sign-off

The screen owner supplies or updates the fixture and performs the first visual review. The integrator performs the cross-screen pass at both viewports, records the exact desktop width, and checks that shared shell changes did not alter unrelated screens.

Sign-off requires:

1. Every matrix row has a `390×844` and desktop capture for all applicable named states.
2. Touch targets, disclosure levels, and required Level 1 facts satisfy `DS-09` and `DS-10`.
3. Keyboard behavior is checked on desktop for Today, Review, Feed, Trade Detail, Tools, and Strategy Lab; J/K/Enter/Esc behavior is checked specifically on Review, Feed, and detail surfaces.
4. Any not-applicable state has a written reason in the handoff.
5. Regressions are recorded against the owning `RM-*` lane before merge. Visual drift that hides facts, breaks recovery, changes sample/replay meaning, or compromises hit-testing is merge-blocking.
