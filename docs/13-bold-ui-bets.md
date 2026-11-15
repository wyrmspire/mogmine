# 13 — Bold UI Bets

Interface ideas that go past the current notes. Each one changes how the app is used, not how it is decorated. They build on [08 — UX Notes](08-ux-notes-viewing-and-journaling.md), [11 — Mobile Workflows](11-product-workflows-and-api-context.md) and [12 — Levels, Zones & the Daily Markup](12-levels-zones-and-daily-markup.md), and they are shaped by how the owner trades: a daily markup of about 13 zones, a written plan, a few trades a day at about $250 risk, review on a `1m` chart.

> [!NOTE]
> **These are bets, not scope.** None is approved. `OD-14` and `OD-16` still control the first release. Thirteen documents exist and no screen does, so adopt at most three now (§9) and leave the rest written down. IDs (`BET-nn`) are stable.

---

## 1. The bets at a glance

| ID | Bet | What it changes | Earliest | Needs |
| :--- | :--- | :--- | :--- | :--- |
| **BET-01** | Zone Ladder | A second way to see a trade: in zones, top to bottom, the shape of a phone | M3 | Level sets (12 §6) |
| **BET-02** | Days, not trades | The feed's unit becomes the trading day: plan, zones, trades and missed moves on one chart | M2 | Archive. Zones arrive at M3. |
| **BET-03** | Blind review | Grade the entry before the outcome is shown | M2 | Archive |
| **BET-04** | Draw the trade | Manual entry is a drawing on the chart, not a form | M1 | Archive |
| **BET-05** | Desk mode | The phone is a three-button stamp pad during the session. Stamps become priced draft trades. | M2 | Archive, local-first notes |
| **BET-06** | Execution diff | Plan versus actual, line by line, in points and R | M3 | Plan revisions (12 §8) |

Milestones are from [10 §7](10-yahoo-first-build-plan.md#build-order). Smaller bets are in §8.

---

## 2. BET-01 — Zone Ladder

**What.** A vertical list of the day's zones, highest price at the top. Each row has the role colour, a short label, the price, and the distance from the entry in points and R. The trade is a path on the ladder: an entry marker, the stop row, the target row, the exit marker, and every zone it crossed highlighted. The plan scenario it matched runs beside it as a dashed path.

**Why.** The owner plans zone to zone, and scenarios already point at zone keys (LV-15). A candlestick chart spends its width on time, and a phone has no width to spare. A ladder is tall and narrow, like the screen. "Entered at ADR inner low, exited one zone before ADR High" is readable in a second.

**It also fixes a problem in the current notes.** LV-09 puts each label right of the last bar and never over a candle. A label such as `7547.50 ADR Low / PDL / Tue settle` is about 215 px wide at 11 px text (an estimate, not a measurement). On a 390 px screen, after the price axis, that leaves roughly a third of the width for candles. On a phone the full labels have to live somewhere else.

**Where it appears.**

- **Trade Detail:** a Chart / Ladder switch.
- **Zone rail:** a slim strip beside the plot that shows every zone as a coloured tick across the day's whole range, with a bracket for the visible price window. Tap a tick and the chart recentres. On the chart itself each zone keeps a short tag (first member plus a count, `ADR Low +2`), and the full label opens on tap or in the ladder.
- **Feed thumbnail:** a mini ladder says more at 40 px than a sparkline does: entry zone, exit zone, direction.
- **No candles:** the ladder is the fallback view for a trade whose bars were never captured ([08 §4](08-ux-notes-viewing-and-journaling.md#4-state-matrix)).
- **Trade Card:** a ladder layout for sharing.

**Cost and limits.** The ladder is an ordinary component, drawn from `levels_at_entry` (LV-13). The rail sits beside the plot or is drawn by a primitive, never as an element laid over the plot (Invariant 1). A ladder hides time, so it shows the hold duration as text and never replaces the chart.

---

## 3. BET-02 — Days, not trades

**What.** The feed lists trading days. Opening a day shows one `15m` chart of the session, the owner's markup timeframe, carrying:

- the published zones,
- every trade as a box, in the Actual or Archived style of LV-18,
- missed moves as planned-style boxes (LV-19),
- the plan's one-line summary and the day's process score.

Tapping a trade box zooms the same chart into the `1m` trade view. Back zooms out. The chart is never torn down between the two, so nothing reloads and the zoom state survives.

**Why.** With a daily markup and a few trades, the lesson is at the level of the day. Did I trade my plan? Where did I trade outside it? What did I miss? A list of trade cards cannot show a no-trade day, a missed move, or three entries in ten minutes after a stop. One chart shows all three at once.

**Facts the day view can show without any judgment.** Minutes between an exit and the next entry. Trades that match no scenario, marked "off plan". Trades outside the planned hours.

**Cost and limits.**

- The list itself must stay light (B-42). Each day row is a stored thumbnail, such as a mini ladder plus a sparkline. The live chart is built only for the day that is opened.
- A day with fifteen scalps needs clustering: one marker with a count and a list below.
- This changes [08 §3](08-ux-notes-viewing-and-journaling.md#3-screens-and-urls), where the feed is trades grouped under a day header. Decide it before the feed is designed, because it changes the feed's unit.

---

## 4. BET-03 — Blind review

**What.** The trade opens with everything after the entry hidden: later bars, the exit, the result, the tags. One question appears: **Take it again?** with three answers, *Yes*, *Smaller*, *Pass*. Then the bars play forward to the exit and the result is revealed.

**Why.** "Process before outcome" is a principle in these notes, but every screen still shows the outcome first. Once the result is known, the entry cannot be judged fairly. This makes the fair judgment the default interaction, and it needs no AI.

**What it produces.** After thirty or more trades: the average R of trades graded *Yes* against trades graded *Pass*. If the *Pass* trades did as well as the *Yes* trades, the trader's read of their own setups is not adding anything, which is worth knowing. Always show the sample size.

**Where it appears.**

- **Review Queue:** trades older than a week appear sealed, with no result colour. Same-day blind review is weak, because the trader remembers.
- **Drill:** a random past trade from one playbook, sealed. Deliberate practice on the trader's own history.

**Cost and limits.** Hiding later bars is one data call with a shorter array. The Position Box draws only up to the cut-off. With reduced motion on, the reveal is instant. Store the grade, the time it was given and what was hidden. This serves B-63 and UX-52 directly.

---

## 5. BET-04 — Draw the trade

**What.** Adding a trade is a drawing. Choose **Add trade**, pick Long or Short, and tap the entry bar. A Position Box appears with the stop and target already placed by the sizing rules in LV-17. Drag the handles to what actually happened, and drag the right edge to the exit bar.

**Why.** Under `D-009` every trade is entered by hand, so this form is the most used screen in the app for months. Typing prices and times on a phone keyboard is the surest way to make someone stop journaling.

**Details that make it work on a phone.**

- **A loupe.** The finger covers the price being set, so a magnified readout floats above it.
- **Steppers.** Plus and minus one tick, and one bar, under the chart. Precise dragging is never the only path (11 §7).
- **Magnets.** Prices snap to the tick, and pull gently toward the bar's open, high, low and close and toward zone edges. Times snap to bars (B-23).
- **A sanity check.** A fill outside its bar's range gets a warning, which catches typing errors. It is not blocked, because the data source may differ from the traded contract (B-12).
- **An explicit mode** with Done, Cancel and Undo. Long press stays with the crosshair (UX-42).

**One drawing tool for everything.** The same tool, in the Planned style of LV-18, draws a plan scenario, a "what if", and a missed move the trader marks by hand (LV-19, `source = user`). It is also the zone tool described in 11 §3.

**Cost and limits.** The library has no drawing tools, so handles, hit-testing and drag are ours to build as canvas primitives. Chart scrolling must be suspended during a drag. Check the plugin API for hit-testing before estimating (§10).

---

## 6. BET-05 — Desk mode

**What.** A screen for a phone on a stand during the session. It has three large buttons, **Long**, **Short** and **Flat**, and almost nothing else. A tap stamps the time. Around the buttons:

- today's one rule (UX-53),
- trades taken against the plan's maximum,
- minutes since the last exit,
- a countdown to the next high-impact event.

It never shows price or P&L.

**Why.** The hard part of journaling by hand is remembering when things happened. A stamp captures it at the cost of one tap, with nothing to read. After the close, each pair of stamps becomes a draft trade. Its prices are proposed from the archived `1m` bar at each stamp, and the trader nudges them in the drawing tool (BET-04). A day of trades is journaled in a minute.

**After a broker exists** the stamps become optional and the screen stays as a discipline display fed by the sync.

**Cost and limits.**

- Stamps save on the device first (UX-31).
- The archive must hold today's session before drafts can be priced, so the close triggers an **Archive now**.
- A missed tap is fixed afterwards by adding a stamp.
- The trader opens this screen deliberately. It does not conflict with "never interrupt someone who is trading".
- Keeping the screen awake depends on a browser feature that needs checking in an installed PWA (§10).

---

## 7. BET-06 — Execution diff

**What.** Plan against actual, shown like a code diff:

| | Planned | Actual | Difference |
| :--- | :--- | :--- | :--- |
| Entry | 7593.00, at the trigger zone | 7597.75 | 4.75 pts late |
| Stop | 7544.00, one tick under the zone | 7570.00 | 26 pts tighter |
| Exit | 7687.25, at the target zone | 7641.00 | One zone early |

On the chart, the planned-style box sits under the actual box and the gaps are bracketed.

**Why.** The notes already compute every one of these facts (12 §10). This puts them where the eye can compare them. The gap between the two boxes is the lesson.

**Cost and limits.**

- Entry and stop differences are decision-time facts. What the planned exit would have made is hindsight and is labelled so, in a separate block (B-63).
- It needs a plan revision that existed before the entry (LV-15). Without one it shows "no plan on record" and compares nothing.
- The numbers in the table above are illustrative, not a logged trade.

---

## 8. Smaller bets

| ID | Bet | In one line | Earliest |
| :--- | :--- | :--- | :--- |
| **BET-07** | Point and talk | Hold a candle to start crosshair tracking, tap the mic in the readout, speak. The voice note is anchored to that bar (11 §3). | With voice |
| **BET-08** | Hazard bands | Shade ±30 minutes around high-impact events on the time axis, drawn as a primitive. | M3 |
| **BET-09** | Two-tap journal and quadrant | Ask two things first: *Followed the plan?* and *Take it again?* The four combinations become a filter: good win, good loss, lucky win, bad loss. Lucky wins are the ones to review. | M2 |
| **BET-10** | R axis and setup fingerprint | Switch the price axis to R for the selected trade. Later, overlay every trade of one playbook, aligned at the entry, in R, to see how that setup usually behaves. Needs twenty or more trades. | M3, then later |
| **BET-11** | Morning commit | Five swipes: overnight chart, ladder, scenarios, news, one rule. **Commit** publishes the levels and the plan and stamps the time, which is what later lets the plan count as evidence. | After `OD-19` |
| **BET-12** | Yesterday's you | On opening today's plan, offer to play the trader's own voice notes from the last session. | With voice |
| **BET-13** | Paste or photo to draft fills | Paste a platform's fill list, or a screenshot of it. Parse it into draft fills, check each price against its bar, and always ask for confirmation. | M4 or later |
| **BET-14** | Presets named by the question | *Execution*, *Plan*, *Structure*, *Behaviour* in place of Low, Medium and High. A trader knows which question they are asking, not how much detail they want. Input to `OD-17`. | — |

---

## 9. What to adopt first

1. **BET-04, Draw the trade.** It is the manual-entry screen, and that screen has to be built at M1 whatever happens. The development test-trade tool in [10 §5](10-yahoo-first-build-plan.md#5-trades-without-a-broker) is most of it already.
2. **BET-05, Desk mode.** It is what makes journaling without a broker realistic.
3. **BET-03, Blind review.** The cheapest change with the largest effect on how honestly a trade is judged.

Decide **BET-02** early even if it is built later, because it changes what the feed is a list of. **BET-01** and **BET-06** wait for level sets at M3.

---

## 10. Check before building

| Point | Why it matters | Status |
| :--- | :--- | :--- |
| Hit-testing and drag for primitives in `lightweight-charts` v5 | BET-04 and the zone tool depend on it | Not verified |
| Keeping the screen awake in an installed iOS PWA | BET-05 | Not verified |
| A custom price-axis formatter | BET-10's R axis | Not verified |
| Width of a full zone label on a 390 px screen | The case for the zone rail in BET-01 | Estimated, not measured |

---

## 11. Where these touch existing notes

| Bet | Touches | How |
| :--- | :--- | :--- |
| BET-01 | LV-09, the 12 §14 checklist | Full labels right of the last bar do not fit a phone. Proposes short tags plus the rail. Input to `OD-20` and `OD-22`. |
| BET-02 | 08 §3, UX-11, `OD-19` | The feed's unit changes from trade to day. |
| BET-03 | UX-52, B-63 | Makes the decision-time view the first thing shown. |
| BET-04 | UX-36, LV-17, 11 §3 | Replaces risk chips and typed prices with a pre-sized box. Shares one tool with zones. |
| BET-05 | UX-35, UX-60 | User-opened, shows no P&L, so it is consistent with both. |
| BET-09 | 08 §7 review status | The two answers are separate from `new`, `tagged`, `reviewed`. |
| BET-14 | `OD-17`, 12 §5 | An alternative naming for the detail presets. |
