# 08 — UX Notes: Viewing Trades & Journaling

Companion to [03 — Trade Cards & Note-Taking](03-trade-cards-and-note-taking.md) and [05 — Mobile UX & Gold Design System](05-mobile-ux-and-gold-design-system.md). Those describe what each screen contains. This file covers what they leave open: what a screen does when data is late or missing, which gestures collide, how a note is never lost, and how to tell whether the experience is actually good.

IDs (`UX-nn`) are stable. Cite them in PRs and handoff notes. Items that change an existing spec link to an open decision (`OD-n`) in [DECISIONS.md](../DECISIONS.md). Backend items (`B-nn`) are in [09 — Backend Risk Register](09-backend-risk-register.md).

---

## 1. Six principles, each with a test

| # | Principle | How to test it |
| :--- | :--- | :--- |
| 1 | **The chart answers first.** Entry, exit, risk and what price did are visible before any text. | Cover everything below the chart. Can you still tell whether the trade location was good? |
| 2 | **Ten seconds, three taps.** In-session capture is measured, not hoped for. | Time it on a real phone, one-handed, from sheet open to saved. |
| 3 | **Never interrupt someone who is trading.** The app waits to be opened. | Close three scalps in two minutes. Did anything pop over what you were doing? |
| 4 | **Process before outcome.** A disciplined −1R looks better than a lucky +3R. | Show two cards to someone who cannot see the P&L. Can they tell which trade followed the rules? |
| 5 | **Say where the data came from.** Approximate numbers and proxy charts are labelled. | Find every `≈` and every data-source line. Is any estimate presented as exact? |
| 6 | **Nothing tapped, typed or spoken is lost.** | Turn on airplane mode mid-note, kill the app, reopen. Is the note there? |

---

## 2. Experience budgets

Measure these budgets on a real mid-range phone over cellular. They are targets, not verified performance claims. Record misses and their conditions.

| ID | Moment | Budget |
| :--- | :--- | :--- |
| UX-01 | Tap a trade in the feed → chart and Position Box painted | ≤ 1.0 s on a first visit, ≤ 300 ms when candles are already on the device |
| UX-02 | Switch timeframe | ≤ 150 ms. All timeframes for the trade are loaded together. |
| UX-03 | Pan or pinch with box, levels and companion pane on screen | No visible stutter on a three-year-old iPhone |
| UX-04 | Pit Stop sheet open → note saved | ≤ 10 s median, ≤ 3 taps |
| UX-05 | Any tap on a chip → visibly saved | ≤ 100 ms, saved locally first |
| UX-06 | Tap Share on a Trade Card → share sheet | ≤ 300 ms. The image is rendered before the tap (UX-70). |
| UX-07 | Request AI review → first result | ≤ 20 s, with visible progress, never blocking the screen |
| UX-08 | Trade closes → appears in an open app | ≤ 5 s with the stream, ≤ 60 s with pull sync |

How to hit them:

- **Completed candle sets never change.** Cache them on the device (IndexedDB) keyed by trade, timeframe and version. Old trades then open instantly and work offline.
- **Prefetch the neighbours.** When a trade is open, load the previous and next trade's candles.
- **The feed never loads candles.** Thumbnails come from a stored ~40-point sparkline (B-42).
- **Do not read CSS variables per frame.** `getComputedStyle()` inside `draw()` runs on every frame of a pinch. Read theme values once into a small store, update the store when a slider or preset changes, then call `requestUpdate()`. This still satisfies Invariant 5: values are read from the variables, never hardcoded.

---

## 3. Screens and URLs

| Screen | URL | Notes |
| :--- | :--- | :--- |
| Today | `/` | Current trading day, including no-trade days; show the previous trading day's summary separately and label its date. |
| Feed | `/feed?style=scalp&status=unreviewed&playbook=…` | Grouped by trading day with a sticky day header. |
| Trade Detail | `/trades/[id]?tf=5m&companion=NQ` | The deep-link target for toasts, pushes and shared links between your own devices. |
| Review Queue | `/review` | Card stack of trades that still need tags or review. |
| Playbooks | `/playbooks` | |
| Tune | `/tune` | Visual tuning, notifications, time zone, privacy. |

- **UX-10 — Filters live in the URL.** The back button, a reload and a deep link all restore the same list.
- **UX-11 — Previous and next follow the list you came from.** Opening a trade from "Scalps, unreviewed" steps through that list, not through all trades.
- **UX-12 — Back restores scroll position** in the feed.
- **UX-13 — Day header content:** date, net result, trade count, win rate, and a process score (share of trades that followed their rules). The process score sits next to the result, not below it.
- **UX-14 — Copied trades are grouped.** One card with "× 3 accounts", expandable. Statistics count the group once ([09 §4](09-backend-risk-register.md#4-money-math-b-30--b-34)).

---

## 4. State matrix

Every screen is specified for more than the happy path. If a state is not in this table, add it before building the screen.

### Today and Feed

| State | What the user sees |
| :--- | :--- |
| First run, no trades ever | Under `D-009`, a clearly labelled sample trade and **Add manually**; test-trade tools are development-only. Broker sync and CSV import remain absent until their prerequisites exist. |
| No trades today | "No trades yet today", with the last trading day's summary underneath. |
| Syncing or importing | Progress with counts ("Imported 42 of 60"). Failures are listed with a reason and can be retried one by one. |
| Everything reviewed | A quiet "All caught up". No confetti. |
| Filter returns nothing | The active filters are named and one tap clears them. |
| Listener offline (B-09) | A thin banner: "Live sync offline since 10:42 — trades will backfill". No modal. |
| Device offline | Cached days stay readable. A banner says what is stale. |
| Position currently open | A neutral "Position open" row with no live P&L. This is a review tool, not a terminal. |

### Trade Detail

| State | What the user sees |
| :--- | :--- |
| Candles loading | Header numbers at once (they come from the trade row). A chart skeleton at final height so nothing jumps. |
| Post-exit candles not yet available (B-10) | The chart and box as normal. The area after the exit is marked "Post-exit candles arrive ~10:55 ET". The Ghost toggle is disabled and says why. |
| Bars missing inside the window (B-11, `AC-07`) | Gaps drawn as gaps, never bridged, with a line: "6 bars missing 09:41–09:46". A higher-timeframe candle built from missing minutes is marked incomplete. |
| A timeframe was never captured (B-11) | The best available timeframe, with a line: "1m data was not captured for this trade — showing 15m". |
| No candles at all | No chart area, generated candles, price ladder or placeholder graphic. The trade header, details and notes remain usable. |
| Closed trade with an invalid exit date (OD-47) | “Chart needs a valid exit date.” The price and notes remain available, and candle requests wait for a valid date. |
| Bars not published yet (`R-02`) | Yahoo publishes the newest bars late, so a trade logged right after its exit can have no anchored candles yet. No chart area, as above, plus a line "Yahoo has not published these bars yet" (exit under 60 minutes ago; otherwise "No candles loaded for this trade") and a **Retry** button (44px). While the trade is on screen the app retries by itself: each minute while the exit is under 60 minutes old, then every 15 minutes, and when the page becomes visible again. A ready chart refreshes every 5 minutes until the session closes, so after-exit bars fill in. A refresh never replaces more bars with fewer. Sample trades never retry. |
| Chart data may not line up (B-12) | A quiet note inside the data-notes chip (issue #83): "Candles are from the ES continuous contract. Your fills may sit slightly off the bars." |
| Data-quality notes (#83) | One chip under the chart, "N data notes", 44px min height, expands on tap to a list; tap again to collapse. Amber only when bar coverage is missing or partial (the one case that makes MAE/MFE and the bar check untrusted); every other note is muted. No chip when there are no notes. Hindsight is never in the chip. |
| Planned SL/TP passed before a real trade's exit | A short neutral fact in the data-notes chip. Never change the recorded trade. A passed stop links to issue #24 for stop-move recording. |
| No stop recorded | R shows `—R` with an **Add stop** affordance. Never `0.0R`. |
| No planned target recorded | Target shows “No target set”. No TP zone is invented. |
| MAE/MFE estimated (B-33) | Values prefixed with `≈`. |
| Broker corrected or voided a fill later (B-04) | "Updated by broker 11:02" on the trade. Notes are kept. |
| P&L disagrees with the broker (B-34) | Both numbers, with the broker's labelled. |

### Notes

| State | What the user sees |
| :--- | :--- |
| Saving | Nothing blocks. A local acknowledgement appears within 100 ms; distinguish device-only saving, syncing and server-confirmed saving. |
| Offline | "Saved on this device — will sync". The note is fully usable. |
| Sync failed | A retry affordance on the note. Never a lost note, never a silent failure. |
| Voice transcribing | The recording is kept and playable. The transcript appears when ready. |
| AI suggested tags | Suggestions appear as outlined chips to accept. They never replace what the user chose (UX-33). |

### AI review

| State | What the user sees |
| :--- | :--- |
| Not requested | A single **Review** action. |
| Queued or running (B-51) | Progress in place. The rest of the screen stays usable. |
| Complete, data only (B-60) | The review, labelled "Reviewed without chart image", with **Add chart to review**. |
| Complete, with vision | The full review. |
| Failed | The reason in plain words and **Try again**. No partial review is shown as complete. |
| Inputs changed since the review | "Notes changed since this review" with **Re-analyse**. Earlier reviews stay available. |

---

## 5. Trade Detail layout

### Height budget at 390 × 844

| Region | Height |
| :--- | :--- |
| Status bar and safe area | 47–59 px |
| Header (two lines) | ~64 px |
| Chart toolbar | 44 px |
| **Chart region** | **what is left** |
| Action row (Trade Card, Voice Note) | 56 px |
| Bottom dock | 56 px |
| Home indicator | 34 px |

That leaves roughly 530 px for charts in an installed PWA and closer to 400 px in a Safari tab with browser chrome. Design for 400. With a 65/35 split that is about 260 px for the primary pane and 140 px for the companion. Tags, the AI summary and Advanced Notes sit below the fold, which is fine: the chart answers first.

### Details that decide whether the chart is trusted

- **UX-20 — Fill times are snapped to their bar.** Without snapping the box disappears (B-23). After a timeframe switch the box is recomputed for the new bars.
- **UX-21 — Level labels never overlap.** When levels sit within a few ticks, merge the labels ("ONL · VWAP"). Show only levels inside the visible price range. Default to the three nearest the entry, with the rest behind one toggle. Stored daily zones are proposed in [12 §4–5](12-levels-zones-and-daily-markup.md#4-zone-merging) (`OD-20`).
- **UX-22 — Levels start where they formed.** The opening-range line begins at 09:35 or 09:45, not at the left edge (B-14).
- **UX-23 — Dense fills collapse.** Six fills inside one bar become one marker with a count. Tapping it opens the fills table: time, side, quantity, price, running position.
- **UX-24 — One data-source line** under the chart: "ES=F · Yahoo · 1m" or "MES Z6 · TopstepX · 1m".
- **UX-25 — Rotate for a full-screen chart.** Landscape hides the header and dock. A full-screen button does the same in portrait.
- **UX-26 — Timeframe changes keep the trade centred.** Slider changes keep the zoom (already in the `AGENTS.md` checklist).
- **UX-27 — Companion pane uses native panes.** `lightweight-charts` v5 puts a second series in its own pane on one shared time axis: `chart.addSeries(LineSeries, options, 1)`. One chart means one screenshot and no sync loop. The two-chart sync recipe in `docs/07` becomes the fallback. Decision: `OD-6`.

---

## 6. Gesture conflict map

Several gestures in `docs/05` are claimed twice. Resolve them this way.

| Gesture | Claimed by | Conflict | Resolution |
| :--- | :--- | :--- | :--- |
| Horizontal drag on the chart | Chart pan | "Swipe left/right between trades" (`docs/05` §1.5) and the iOS edge-swipe back gesture | **UX-40.** Trade-to-trade swipe lives only on the header strip, plus visible previous/next chevrons. Never on the chart. |
| Vertical drag on the chart | Page scroll | The library's `vertTouchDrag` defaults to `true` and captures the gesture. The user gets stuck on the chart and cannot reach the notes. | **UX-41.** Set `handleScroll.vertTouchDrag: false`. The price scale auto-fits. A vertical drag that starts **on the price axis** stretches or compresses the scale, and a double-tap there auto-fits again ([docs/20](20-price-first-entry.md) §3, `OD-41`). |
| Long press | "X-Ray Hold" at 250 ms | The library's built-in tracking mode (long press shows the crosshair and exits on the next tap), plus iOS text selection and the callout menu | **UX-42.** Bind X-Ray to tracking mode: while the crosshair is active the boxes fade to 5%. Add `-webkit-touch-callout: none` and `user-select: none` on the chart container. On desktop, hold `X`. |
| Double tap | "Fit Trade" | iOS double-tap zoom | **UX-43.** `touch-action: manipulation` on the chart container. Keep the visible Fit pill: double tap is not discoverable. |
| Pinch | Chart zoom | Page zoom | **UX-44.** The chart container owns pinch. Do not disable page zoom globally. It is an accessibility feature. |
| Pull down at the top | Browser refresh and rubber-banding | Sheets and the feed | **UX-45.** `overscroll-behavior: contain` on the shell and on sheets. Provide an explicit refresh. |
| Drag on a bottom sheet | Sheet dismiss | Scrolling inside the sheet | **UX-46.** A drag handle moves the sheet. Content scrolls inside it. |
| Horizontal swipe on a feed card | (tempting) swipe actions | The horizontally scrolling filter pills, and edge-swipe back | **UX-47.** No swipe actions on cards in v1. |

---

## 7. Notes and journaling

### The Pit Stop (in session)

- **UX-30 — No Save button.** Every tap saves. **Done** only closes the sheet.
- **UX-31 — Local first.** Each change is written to the device, then synced. A weak signal cannot lose a note (B-47).
- **UX-32 — Smart defaults.** The last-used playbook is preselected. Chips are ordered by how often this trader uses them. At most eight per row, with the rest behind "More". A **Same as last trade** chip.
- **UX-33 — AI suggests, the trader decides.** Tags parsed from a voice memo appear as outlined chips with **Accept all**. They never overwrite a playbook or tag the trader already picked. Each tag records its source (`user` or `voice_ai`).
- **UX-34 — Undo beats confirm.** Removing a tag or clearing a note shows an undo toast. No confirmation dialogs.
- **UX-35 — The sheet never opens itself over input.** A closed trade shows a toast and a badge. If the app is idle on Today, a non-modal peek card is acceptable. Trades that close in quick succession queue in the Review Queue. Sheets do not stack.
- **UX-36 — Risk in one tap.** When no stop came from the broker (B-07), the sheet offers risk chips from the playbook default ("4 pts", "6 pts", "8 pts", custom). That unlocks R without typing. Risk-budget chips ($250 → 50 pts on 1 `MES`) are proposed in [12 §9](12-levels-zones-and-daily-markup.md#9-position-boxes-sizing-and-the-three-styles).

### Voice

- **UX-37 — Record, then transcribe.** v1 is tap to record → upload → transcript and suggested chips a few seconds later. Live tag highlighting while speaking (`docs/05` §2C) needs streaming speech-to-text and is deferred (`OD-14`).
- **UX-38 — There is always a no-permission path.** A plain text field with the keyboard's dictation key works without microphone permission. The microphone prompt must never be the thing that breaks the ten-second budget.
- **UX-39 — The transcript is editable, and the audio is the trader's.** A setting controls whether recordings are kept. They are stored privately (B-66).

### Review status

Every trade has one status. The queue and the "Needs Review" filter read from it.

| Status | Meaning |
| :--- | :--- |
| `new` | No playbook, no tags, no note. |
| `tagged` | A playbook or at least one tag. The Pit Stop is done. |
| `reviewed` | The trader marked it reviewed at the end of Advanced Mode or in the queue. An AI review alone does not set this. |

A separate `flagged` boolean marks trades worth revisiting in a weekly review.

### Advanced Mode (after the session)

- **UX-50 — Checklist rules are frozen with the trade.** Editing a playbook later does not change the adherence score of old trades (B-47).
- **UX-51 — One adherence score.** It is computed from the checklist. The AI comments on it and never produces a second number (B-62).
- **UX-52 — Decision and hindsight are separate sections.** "What you knew then" comes first. "What happened next" is labelled as hindsight (B-63). A coach that only ever says "you left 1.3R" teaches over-holding.
- **UX-53 — Close the loop.** Each review ends with one directive. Pin the latest directive at the top of Today as "One rule for this session". At the end of the day, one tap records kept or broken. Without this the directive is read once and forgotten.

---

## 8. Notifications and session etiquette

Realtime and push are different things (B-41).

| Channel | Works when | Use it for |
| :--- | :--- | :--- |
| In-app Realtime | The app is open and in the foreground | Feed updates, "review ready" |
| Web Push | The PWA is installed to the Home Screen and permission was granted from a tap (iOS 16.4+) | Session digest, optional per-trade alerts |

- **UX-60 — Per-trade push is off by default.** The trader just watched the trade close on their platform. A buzz after every scalp is noise, and after a loss it is a nudge toward revenge trading.
- **UX-61 — A session digest is on by default.** One push when the account has been flat for 20 minutes after the last trade, or at session end: "4 trades · 2 need tags".
- **UX-62 — Ask for permission late.** From the Tune screen, after the first real trade. Never on first load.
- **UX-63 — On every foreground, refetch.** The app catches up on anything that happened while it was asleep.
- Decision: `OD-11`.

---

## 9. Emotional design

A journal opened seconds after a loss can make the next trade worse.

- **UX-64 — Shield mode for the whole app.** One tap in the Today header switches every screen to R and points and hides dollars, account names and size. It reuses the Trade Card privacy logic, and it is also what a trader wants when sharing their screen.
- **UX-65 — No red flood.** A losing card uses the same neutral surface as a winning one. Crimson appears on the number and the risk box only.
- **UX-66 — Reward process, quietly.** Gold is for rule adherence (already in `docs/05`). No confetti, sounds or streak counters for dollar wins.
- **UX-67 — Describe, do not judge.** "Exited before target", not "You panicked". The trader's own tags may be blunt ("Revenge"). The app's copy is not.

---

## 10. Wide screens

The specs define only 390 × 844, but Advanced Mode is described as "sitting down after the session", which usually means a desk. Mobile stays the acceptance viewport. Wide screens must still use the space well. Decision: `OD-13`.

- **UX-68 — Three panes from 1024 px:** trade list on the left, chart in the centre, notes and review on the right. The chart uses the full centre width.
- **UX-69 — Keyboard:** `J` / `K` next and previous trade, `F` fit trade, `X` hold for X-Ray, `N` focus notes, `C` Trade Card, `G` Ghost.

---

## 11. Trade Card

- **UX-70 — Render before the tap.** `navigator.share({ files })` must run directly inside the tap handler. If the image is generated after the tap, the browser can treat the gesture as expired and the share fails. Build the image when the card sheet opens. Disable Share until it is ready.
- **UX-71 — Privacy is applied at render time.** The chart itself draws a pill with a dollar amount (`docs/02` §2). Privacy mode re-renders the chart with an R-only pill. Hiding a text row on the card is not enough.
- **UX-72 — Privacy mode removes** dollar amounts, account name and id, contract quantity and balance, in the image and in the file name.
- **UX-73 — The shared file and the AI snapshot are different images.** The AI gets a standardised render (B-61). The card is whatever the trader composed.
- **UX-74 — Legible in a chat thread.** Design at 1080 px wide with body text no smaller than 28 px at export size.
- **UX-75 — Every exported time carries its zone.**
- **UX-76 — Three actions:** Share, Save image, Copy image. On desktop, Download and Copy.
- Export path (`html-to-image` versus canvas composition versus a server render): `OD-8`.

---

## 12. Accessibility

- **UX-80 — Never colour alone.** Red and green are the hardest pair for colour-blind users. Direction uses ▲ and ▼. P&L uses explicit `+` and `−`. The profit box has a solid border and the risk box a dashed one. Offer a blue/orange preset.
- **UX-81 — Gold intensity never dims text.** `--gold-intensity` scales glows, borders and decoration. Text keeps at least 4.5:1 contrast at intensity `0.0`.
- **UX-82 — Muted text passes.** `#8E95A9` on `#0D0F17` is about 6.4:1. Keep axis labels at 11 px or larger.
- **UX-83 — Honour `prefers-reduced-motion`.** No sliding sheets or animated auras.
- **UX-84 — The chart has a text equivalent.** An `aria-label` built from the trade: "Long MES, 2 contracts, entered 09:48:12 at 5948.50, exited 10:30:22 at 5961.50, plus 2.6 R." The same sentence is useful as the first line of the AI context.
- **UX-85 — Text scales.** Layouts survive the system's larger text sizes.
- Tap targets of 44 px are already in the `AGENTS.md` checklist.

---

## 13. Numbers and time

One formatting module. No component formats a number on its own.

| Value | Rule | Example |
| :--- | :--- | :--- |
| Price | The contract's tick precision | `5948.25` |
| P&L | Explicit sign, true minus (U+2212), two decimals | `+$325.00`, `−$110.00` |
| R | Explicit sign, one decimal, no space | `+2.6R`, `−1.0R`, `—R` when unknown |
| Points and ticks | Explicit sign | `+13.00 pts`, `+52 ticks` |
| Duration | Two units at most | `42m 10s`, `48s`, `3h 05m` |
| Time in lists | 24-hour, no seconds | `09:48` |
| Time on detail | With seconds and zone | `09:48:12 ET` |
| Approximate values | Prefix | `≈ −1.25 pts` |

- **UX-86 — Display time zone is a preference.** Exchange time (ET) is the default. A trader in Chicago or London can switch, and the zone label always shows. Until `/tune` exists the app uses the owner's choice, `America/Chicago`, from one constant in `lib/time.ts` ([12 LV-03](12-levels-zones-and-daily-markup.md#2-sessions)).
- **UX-87 — Session logic never uses the display zone.** Sessions are computed in `America/New_York` (B-20).

---

## 14. Platform notes (installed PWA on iOS)

- `viewport-fit=cover`, with `env(safe-area-inset-*)` padding on the dock and sheets.
- `100dvh`, not `100vh`.
- Inputs at 16 px or larger, or iOS zooms the page on focus.
- When the keyboard opens, keep the note field and a one-line trade summary visible (`visualViewport`). The chart collapses.
- An installed PWA has separate storage from Safari. Expect a second sign-in after install, and do not assume preferences carry over.
- iOS has no install prompt. Show a one-time "Add to Home Screen" hint, since push depends on it.
- Service worker updates show "Update available". Do not silently serve a stale shell.
- Do not design around haptics. They are not available to web apps on iOS.

---

## 15. Build order for the experience

A smaller thing that feels finished beats every feature half-working. Decision: `OD-14`.

| First | Then | Later |
| :--- | :--- | :--- |
| Feed and Today with real states (§4) | Review Queue | Weekly review and insights |
| Trade Detail: chart, Position Box, timeframes, Fit | Session levels with point-in-time rules | Ghost Box |
| Pit Stop: playbook, chips, text note, local-first save | Voice memo with suggested chips | Live tag highlighting while speaking |
| One companion mode: stacked native panes | Percent overlay | Auto-detected SMT pins, two-point line tool |
| Trade Card in one aspect ratio with privacy mode | Other aspect ratios | Server-rendered share links |
| Shield mode | Session digest push | Per-trade push |
| | AI review, data only then vision | AI follow-up chat |

---

## 16. Acceptance checklist (adds to `AGENTS.md` §4)

Before a UI task is marked complete:

- [ ] Every state in §4 for the screen is built, not only the happy path.
- [ ] The budgets in §2 that apply were measured on a phone, and the numbers are in the PR.
- [ ] Vertical swipes that start on the chart scroll the page (UX-41).
- [ ] The Position Box survives a timeframe switch and a fill that is not on a bar boundary (UX-20).
- [ ] Airplane mode mid-note loses nothing (UX-31).
- [ ] Shield mode hides every dollar amount on the screen, including inside the chart (UX-64, UX-71).
- [ ] The screen works with red/green removed (UX-80) and with reduced motion on (UX-83).
- [ ] At 1280 px wide the layout uses the space (UX-68).
- [ ] The Trade Card preview matches the chart after pan, zoom, Fit and a timeframe change ([10 `AC-10`](10-yahoo-first-build-plan.md#acceptance-criteria-for-m0-and-m1)).
- [ ] Persistence, gestures and the native share sheet were checked on a real phone, with device and commit in the PR ([10 `AC-11`](10-yahoo-first-build-plan.md#acceptance-criteria-for-m0-and-m1)). A build or an API response is not this check.

Proposed additions for daily plans, anchored comments, detail/full-chart controls, indicator coverage and external assistants are in [11 — Mobile Workflows, Chart Context & Assistant API](11-product-workflows-and-api-context.md). Its §6 extends the state matrix and §7 supplies review scenarios; scope remains open under `OD-17`–`OD-19`.
