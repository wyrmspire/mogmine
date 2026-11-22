# Handoff — UX-a chart labels no longer overprint — lane `claude`

- **Item:** board row 12a. **Branch:** none (shared local folder).
- **Status:** done, checks below. Ready for review.

## Done

- `lib/label-stack.ts`: `separateLabels(labels, height, top, bottom)`.
  - Labels whose boxes overlap, directly or through a chain, form a group, and each group is stacked with the existing `stackLabels` (LV-09).
  - Labels that touch nothing keep their position. Output keeps input order.
- `components/PositionBoxPrimitive.ts`:
  - `text()` now queues each label with the style it was asked for (font, fill, alpha) instead of drawing at once.
  - After every mark is painted, the queue is separated and drawn. `LABEL_HEIGHT = 12`.
  - Fixes `≈ SL` printing on `MAE ≈ −5.00 pts` (seen on Trade Detail, Review and the playbook PNG), and any other flag, bracket, hatch or plan-label pair that met.
- `scripts/check-position-box.mjs`: hands the painter `label-stack` through a small `require` shim, as `check-session-levels.mjs` already does.
- `lib/__tests__/label-stack.test.ts`: 3 tests (the SL / MAE case, untouched labels, a chain that stays inside the pane).

## Commands run (portable Node 26.13.1)

- `node --test` on the label-stack, trade-marks and chart-levels tests: 40 pass, 0 fail.
- With `CHROME_BIN` set to the Windows Chrome path:
  - `node scripts/check-position-box.mjs`: exit 0, all pixel facts true (D-010 fills, trail steps and hatch, ignored-stop cross and hatch).
  - `node scripts/check-session-levels.mjs`: exit 0, min label gap 17.
- Headless Chrome 390×844 against the running dev server on :3000: on the Review chart, `≈ SL` and `MAE ≈ −5.00 pts` are on separate lines. Overflow 0, no page errors.

## Not my red, but it is red right now

At the time of this handoff, `npm run typecheck`, `npm run lint` and `npm run build` fail, and `npm test` has 2 failures. All of it comes from the `exit_reason` field Antigravity's G1 is adding:
- Test fixtures in `card-system`, `challenge-store` and `challenges` lack `exit_reason`.
- `lib/__tests__/exit-reason.test.ts` has `any` lint errors.
- The two failing tests are R-03b close and the exit flag text.

None of this is in files this slice touched. Re-run the full suite once G1 lands.

## Note for the scripts

Both chart check scripts default to the binary `google-chrome`. On Windows set `CHROME_BIN` to `C:\Program Files\Google\Chrome\Application\chrome.exe`.
