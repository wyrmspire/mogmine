# R3-09 account-R follow-up

- Threads live accounts and preferences into Trade Detail efficiency and plan-versus-actual calculations, daily-review totals, and the chart text equivalent.
- Changes obsolete Mood wording from "without a stop" to "without R"; account R no longer requires a stop.
- Adds regressions proving a legacy +$75 MES trade on a live $300 account reports +0.25R instead of the $250 preference fallback's +0.30R.
- Verification: 45 targeted tests passed; typecheck and `check:file-length` passed. `TradeDetail.tsx` grew 6 lines (843 → 849); `TradeChart.tsx` grew 2 lines (741 → 743), justified as narrow convergence wiring in existing integration hotspots.
- PR #284 merged while this correction was being tested, so this commit must land through a follow-up branch from current `main`; do not push it to the merged PR branch.
