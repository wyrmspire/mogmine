# 11 — Mobile Workflows, Chart Context & Assistant API

Product proposals from the owner's 2026-11-14 discussion: a mobile workspace fed by multiple sources, API-connected assistants, anchored comments, levels and zones, indicator presets, detail controls and full-chart mode. The owner requested a documentation review; individual proposals below are not accepted decisions or permission to implement them.

Read this with [08 — UX Notes](08-ux-notes-viewing-and-journaling.md). Existing invariants, names and decisions still apply. Open choices are `OD-17`–`OD-19` in [DECISIONS.md](../DECISIONS.md). This file specifies product behavior and contract requirements, not endpoint paths, table names or a new roadmap. Under `D-009`, manual entry, test trades and fixtures remain the trade sources; broker and CSV work stays parked.

## 1. The daily loop beyond the chart

The workspace should connect preparation, capture, review and the next practice goal. Use the existing Today, Feed, Playbooks, Review Queue and Tune screens before adding navigation destinations.

| Existing surface | Proposed addition | Important behavior |
| :--- | :--- | :--- |
| Today, before trading | Daily plan: scenarios, relevant levels/zones, linked playbooks, invalidation and one practice goal | Plans can exist without trades. Preserve the original and later revisions. |
| Today, during trading | Quick capture for text, then voice and screenshots when supported | Save before requiring a trade, playbook or tag. No automatic sheet over active input. |
| Review Queue | Existing trade statuses plus links to unassigned captures and AI results awaiting attention | Keep those items distinct. AI completion never marks a trade `reviewed`. |
| Playbooks | Reusable setup definitions and linked examples of good, poor and uncertain execution | Existing `playbooks` remain reusable setups, not daily plans. Historical rule snapshots stay intact. |
| Today, after trading | Confirm data coverage, finish outstanding notes, record one lesson | A no-trade day is valid. Do not silently replace today's plan with yesterday's results. |
| Tune | Source/archive health and, later, connected-assistant access | Show last successful run, affected symbols/ranges and a useful retry action. |

These are user-selected activities, not an automatic time-based mode that rearranges the app while it is being used. The home-screen emphasis and daily-plan fields remain open (`OD-19`).

### Capture that survives interruption

- Reuse local-first note saving (UX-30–UX-39). Distinguish “Saved on this device”, “Syncing” and “Saved to your account”; never imply server durability before acknowledgement.
- A capture can be attached later to a trading day, trade, level or zone. Attachment failure must not discard its content. Reassigning it preserves its history.
- Keep text usable when microphone permission is denied or an upload/transcription fails. Store file paths in private Storage; upload directly, as required by Invariant 3b.10.
- Across devices, use revision checks. A stale write preserves both versions and offers a comparison; never silently apply last-write-wins to prose. Local undo must not overwrite a newer remote edit.
- A shell update, navigation or authentication expiry must not discard a draft. Explain device-only storage limits; do not promise recovery after local data has been cleared.

### Later, after the daily loop is useful

- Search notes, tags, setups and dates; bookmark lessons and trade examples. Start with inspectable filters before natural-language search.
- Weekly review: surface linked evidence, a process lesson and one practice goal. Separate rule adherence from financial outcome; show sample size, fees and missing data with statistics.
- Export the journal with attachment and relationship references. Deletion, restore and retention rules need an explicit design before shipping; an undo toast alone is not a backup.
- Broker/account risk summaries remain parked until a verified source exists. Never substitute an estimate for an account limit.

## 2. Detail and full-chart mode are separate

Proposed detail presets (`OD-17`):

| Detail | Default presentation |
| :--- | :--- |
| Low | Candles, trade entry/exit and Position Box, a small selection of relevant levels, collapsed note markers |
| Medium | Low plus the selected indicator preset, relevant zones and concise labels |
| High | Additional labels, execution details and annotation controls; full prose still opens on selection |

- Detail changes presentation, never the saved content, calculations or AI inputs. Low detail must not hide missing-data, stale-data or source-mismatch warnings.
- A manual hide overrides a preset until reset. Hidden-item counts and the context list keep omitted notes and levels discoverable. Never silently re-enable a hidden indicator.
- Full-chart mode changes available space only. Preserve detail, timeframe, visible range, selection and companion settings when entering, leaving or rotating.
- In full-chart mode, a collapsible bottom context sheet exposes the selected note, trade or daily plan. Keep an obvious exit and account for safe areas and the keyboard. Do not stack sheets.
- User defaults can follow the account; zoom, open drawers and temporary selections belong to the current view. Preference persistence and preset defaults need owner review before adding schema.

## 3. Notes attach to market objects

Both a person and an assistant should be able to express “comment on this entry” without calculating pixels. Persist domain anchors; the renderer derives coordinates. All chart marks use the Canvas primitive boundary in `D-004`. Comment editors and accessible lists live in normal panels outside the plot.

| Attachment | Meaning |
| :--- | :--- |
| Trade | General comment shown with that trade; no invented candle location |
| Execution | A stable fill reference for an entry, add, trim or exit; “entry” alone is ambiguous on a multi-fill trade |
| Candle or moment | UTC time and optional price, with instrument, provider/series identity and relevant timeframe |
| Time range | Start/end times, optionally with a price range |
| Level or zone | Stable object reference; level has a price, zone has lower/upper prices, with validity times and revisions |

- Preserve the original timestamp/price and the displayed bar mapping separately. Snap for rendering per B-23; never change the execution to make it fit a candle.
- A timeframe change remaps the anchor. A missing bar, archive gap, changed contract or incompatible provider is an explicit unresolved state, not a reason to snap to an unrelated bar.
- A linked note follows its level/zone in the current view. Historical reviews retain the object revision they used. Corrections or deletions preserve the comment with an “attachment changed/unavailable” explanation and a reattach action.
- User and AI authorship, creation time, evidence references and decision-time versus hindsight context remain inspectable. Editing a comment preserves provenance.
- Long-press already belongs to crosshair tracking (UX-42). Use an explicit add-note/drawing action, then select the anchor and open its editor. Zone drawing has visible handles, numeric adjustment, Done, Cancel and Undo.
- Overlapping markers group with a count and a selectable list. Always provide a text equivalent and a “Show on chart” action.

### View and export behavior

Opening a trade uses Fit Trade. Receiving data, accepting an observation or changing detail must not reset pan/zoom. “Show on chart” is an explicit navigation action that reveals the target, explains any unavailable data and offers a return to the previous view. Distant levels do not automatically compress the price scale; indicate offscreen context in the list.

A saved view references timeframe, range, selected layers/settings and object revisions. A Trade Card previews exactly the chosen export content, including chosen comment text if requested. Canvas markers alone do not include text from an external comment sheet. Render that text deliberately in the card composition, respect Shield mode and keep the standard AI snapshot separate (UX-71–UX-73). Saved-view schema and the owner's phrase “trade copy” remain unresolved (`OD-17`); do not interpret it as an order-copying feature.

## 4. Indicator context is reproducible

Requested candidates: session VWAP, weekly VWAP, 200 EMA and upper/lower bands. These are configuration candidates, not settled formulas or default overlays (`OD-18`).

- Code computes indicator values; AI consumes them and supplies commentary. Server calculations can provide one shared result to the UI and API. Do not add a second, inconsistent client formula.
- Each result identifies the instrument/contract or proxy, provider, input timeframe, price/volume basis, anchor/reset policy, parameters, calculation version, data revision and covered interval. Use UTC data times and `America/New_York` session logic.
- Define 200 EMA input timeframe, seed and warm-up requirements. A short trade window may not contain enough history. Fetch from the archive first; report unavailable/partial coverage instead of drawing a complete-looking line.
- Define session and weekly VWAP anchors, treatment of holidays/breaks, band formula/multipliers and zero/missing volume. Do not silently pick RTH versus Globex; this is an existing drift-register conflict.
- Clarify whether bands belong to VWAP or another indicator. “BE” was not defined in the discussion; do not invent a break-even indicator, stop rule or formula.
- Indicator presets select desired overlays; availability is evaluated for each chart. Show why a selected overlay is unavailable and distinguish provisional from complete values.
- At any review time, use only inputs available then. Indicator corrections invalidate affected results and mark dependent reviews stale. Do not merge providers or contracts silently to fill gaps.

## 5. Assistant API without assistant-controlled layout

Proposed flow: an authenticated assistant requests bounded context, receives stable references and coverage, submits a draft plan or annotation, and receives its saved id/revision or a useful validation error. The app renders it using its existing components. No request supplies arbitrary HTML, CSS, JavaScript or screen coordinates.

| Operation family | Contract requirements |
| :--- | :--- |
| Read context | User-owned trade/day references, bounded time range, facts from code, point-in-time cutoff, missing inputs and data/revision identifiers |
| Create draft content | Comment or plan text, explicit domain target, evidence references and source request id; accept a valid general note without inventing an anchor |
| Review suggestions | List, accept or dismiss separately from trade review status; preserve original AI proposal and user edits |
| Track processing | Return pending state when needed; provide saved-result/status retrieval so an assistant need not keep a connection open |

Before an external assistant is enabled:

1. Resolve identity on the server and check ownership of every referenced trade, fill, level, zone and attachment. A caller-supplied `user_id` is not authorization. Enforce RLS and never expose service-role or broker keys.
2. Grant bounded read and draft-create permissions separately. External assistants cannot overwrite user notes, accept their own suggestions, delete history or invoke broker trading actions. Show and revoke access from Tune. The authorization mechanism remains open in `OD-19`.
3. Validate target compatibility, UTC times, tick precision, ranges, text length and payload size. Missing/out-of-range targets return clear errors; never silently place a marker elsewhere.
4. Make retries idempotent within user, client and operation scope. Reject reuse of a request key with different content. Use revision preconditions for updates and acceptance; return conflicts without losing either version.
5. Return bounded/paginated context; never load candle arrays into list responses (B-42). Apply request and AI usage limits, with visible retry/error states.
6. Keep an activity record of the client, operation, target, time and resulting revision. Avoid secrets and full private note content in logs. Accept/dismiss is a data action and must not rearrange navigation or open a modal.
7. Treat journal text, uploads and tool results as untrusted content. Instructions inside them cannot grant permissions, change tool policy or bypass schema checks. Evidence ids must resolve to the context supplied; unresolved evidence is labelled, never presented as verified.

An AI statement such as “entered before the planned zone” requires a plan revision that existed before the entry and data supporting that relationship. Without it, describe the observed location or ask about intent. Do not turn a later annotation into evidence of an earlier plan (B-62, B-63).

## 6. States to design before implementation

These extend, rather than replace, [08 §4](08-ux-notes-viewing-and-journaling.md#4-state-matrix).

| Situation | Required response |
| :--- | :--- |
| First use / no broker | Manual entry and a labelled sample/test path; broker and CSV actions stay absent under `D-009` |
| No trades today | Today's plan/journal remains editable; previous results are clearly labelled as a different day |
| Capture saved offline | Device-only status, readable content and later retry; no false server-saved confirmation |
| Two devices edited the same note | Preserve both revisions and offer comparison/resolution |
| Annotation target unavailable | Keep comment in the list, explain why no marker is drawn, offer reattachment |
| Indicator history/volume unavailable | Explain the affected overlay; usable chart and other indicators remain available |
| API request retried or stale | Same result for a matching retry; explicit conflict for changed content/revision |
| Assistant loses authorization | Stop access; retain already saved user-owned content and explain the failure |
| Source data or plan corrected | Label dependent observations/reviews stale; keep their historical inputs inspectable |
| Dense chart, Low detail or full-chart mode | Accessible context list, hidden-item counts, readable candles and reachable exit controls |

## 7. Review gates and scope

Do not expand the first release because these ideas are documented. `OD-14` and `OD-16` still control scope/build order. Suggested sequence for owner review: keep reliable text capture with Feed/Today; add manually anchored notes with context; prove indicator definitions/data coverage; add external assistant draft creation only after ownership, revisions and validation are proven. Weekly synthesis, replay and semantic search remain later candidates.

For each UI change, record evidence at 390 × 844, a wide viewport and large text. Use clean and crowded trades, overlapping annotations, long comments, missing history, offline save, keyboard open, a stale revision and a timeframe change. Verify:

- No page overflow; primary controls remain reachable with at least 44 px touch targets.
- Switching detail/full-chart mode and receiving new data preserve the visible range and selection; only an explicit navigation action reframes it.
- Candles remain readable across the required opacity range; labels group instead of colliding. Warnings survive Low detail.
- All context is reachable through a text list; color, hover and precise dragging are never the only path.
- No note is lost on offline/reconnect, navigation or conflicting edits; AI suggestions cannot overwrite it.
- An exported card matches its preview, includes the intended annotations and passes privacy checks.

For API changes, verify cross-user reference rejection, revoked access, compatible/incompatible anchors, idempotent retries, revision conflicts, unresolved evidence and instruction-like text in supplied content. Use meaningful fixtures; do not claim browser, API or indicator verification from a documentation review.
