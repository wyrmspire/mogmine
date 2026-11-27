# MogMine Design Principles

> Durable design contract for the current product direction. `BOARD.md` assigns work; `ROADMAP.md` assigns IDs, waves and acceptance criteria.

## Design loop

Every screen change names the trader decision it supports, keeps price action and decision-critical facts at level one, uses one explicit disclosure level for secondary context, names every asynchronous state, and verifies phone, desktop and keyboard behavior where applicable. The owning `DS-*` check and `RM-*` package are updated in the same change.

## Standards

| ID | Principle | Implementation contract |
|---|---|---|
| DS-01 | Readable contrast | Text tokens meet WCAG 2.2 AA and the roadmap APCA thresholds on obsidian, surface and elevated surfaces. |
| DS-02 | Direction beyond color | Direction, outcome and side use signs, arrows, luminance or edge/style differences. Candles remain filled; hollow candles are not part of the design. |
| DS-03 | Honest numbers | Use tabular figures, true minus `−`, signed R and money with two decimals. A rate includes `num/den`; below `n = 10` it says `early`. |
| DS-04 | Process over outcome | Gold and encouragement describe rule-following, not dollars won. Correct losses and planned no-trade sessions remain valid process evidence. |
| DS-05 | Facts, derived values and hypotheticals | Realized, replay, backtest and hindsight values are labelled and never silently combined. Strategy Lab results say `Hypothetical`. |
| DS-06 | Agent provenance | Agent-written records show `by agent` at the point of reading. Agents can propose; the owner makes a change current. |
| DS-07 | Shield is display-only | Shield changes exported/displayed privacy, never API truth or stored quantities. Share cards open Shielded. |
| DS-08 | Calm attention | Work arrives as ranked queues. Today shows at most three actions and says `Caught up` when there is nothing due; only truth problems interrupt. |
| DS-09 | Touch and keyboard | Interactive targets are at least 44px. Feed, Review and detail support touch plus J/K, Enter and Esc without hijacking browser shortcuts. |
| DS-10 | Progressive disclosure | There are at most two disclosure levels. Stop, risk, account, Shield and sync state never require a second disclosure. |
| DS-11 | Named screen states | Loading, empty, offline, error, recovery and caught-up states use words. Agent objects expose pending, confirmed or rejected state. |
| DS-12 | Dark theme discipline | Dark theme remains the current surface. Canvas and primary-text decisions are tracked separately from approved contrast requirements. |

## Invariants and historical incidents

Current invariants: no hollow candles; continuous candle shrinking down to approximately 1px when zoomed out; hit-testing remains accurate at thin widths; review queues exclude replay/sample trades; Shield is display-only; agent provenance is visible; and design regression checks are merge-blocking.

Historical defects that must not return: the `MIN_BAR_SPACING_PX = 3` zoom floor, hiding editable quantity behind Shield, bare percentages without denominators, replay trades entering live totals, and relying on color alone for direction.

## Verification gate

The Integrator gate includes applicable design checks for every screen touched: contrast, grayscale candle direction, responsive visual regression at `390×844` and desktop width, named-state coverage, and touch/keyboard interaction. A check may be marked not applicable only with a written reason in the handoff.

