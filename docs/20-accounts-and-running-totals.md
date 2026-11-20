# 20 — Accounts and Running Totals

When you journal trades from a particular account, Mogmine keeps a running total for it: where the balance stands, its high point, how much room is left before the loss limit, and progress toward a target. Every number comes from **closed trades you logged**. It is a journal total, not the broker's balance, and it never says "live".

Owner request, 2026-11-20: "if you're journaling from a particular account it should keep a running total". Open choices are `OD-41` in [DECISIONS.md](../DECISIONS.md).

**Status:** step 1 is built: the engine (`lib/accounts.ts`), the device store (`lib/accounts-store.ts`), `account_id` on trades, and accounts in backups. There is no screen yet (steps 2–4 in §6).

---

## 1. An account

```ts
interface TradingAccount {
  id: string; user_id: string;            // invariant 7
  name: string;                           // "Topstep 50K Combine", "Personal"
  starting_balance_cents: number;
  rules: {
    max_loss_cents: number | null;        // null: no loss limit
    drawdown: "static" | "trailing" | "trailing_eod";
    daily_loss_cents: number | null;
    profit_target_cents: number | null;
  };
  created_at: string; archived: boolean;
}
```

- A trade has `account_id: string | null`. Null means it is not assigned and counts toward no total. Records saved before this field read as null.
- Rules are configurable per account, not hardcoded to one firm. They are informational only: a breached limit changes nothing about any trade (docs/17 §2.9).

## 2. The running total

`accountSummary(account, trades, checks, now)` is pure, with `now` as a parameter. It uses the same rules as docs/17 §2, so the account card and Drawdown Defender share one engine:

- **Counted:** real, closed trades in this account. Samples never count. Open trades are counted as "open" and have no result (`OD-38`). A trade whose P&L cannot be computed is listed as an issue, never counted as $0.
- **Order:** by exit time, then by id. At the same instant a trade comes before a balance check. Each trade lands on the session it closed in (`sessionDate(exit_time)`).
- **Money:** integer cents, and gross (fees are not in the data). Balance = start + closed trades + balance-check adjustments.
- **High point:** the starting balance counts as the first peak.
- **Loss limit:** the floor is `start − max_loss` (`static`), `peak − max_loss` (`trailing`, peak after any closed trade), or `peak − max_loss` with the peak taken only at session ends (`trailing_eod`). For `trailing_eod`, the current session counts only once it is over. Reaching the floor exactly counts as a breach, and the first breach stays recorded even if the balance recovers.
- **Daily loss:** a session whose closed trades total `−daily_loss` or worse is breached. Today's remaining room is shown.
- **Target:** what is left to reach `start + profit_target`, and the first time it was reached.
- **Output:** balance, realized, adjustments, peak, drawdown, max drawdown, trade and session counts, today's result, limit, daily and target blocks, a balance curve, and the ledger rows.

The docs/17 §3 drawdown golden cases are tests here (`lib/__tests__/accounts.test.ts`).

## 3. Balance checks (reconcile)

Fees and trades you forgot to log make the journal drift from the broker. Instead of editing old trades, you type the real balance at a moment: `{account_id, at, balance_cents, note}`. The difference from the journal total at that time becomes an **adjustment**, and later trades continue from the corrected balance. The check is what the trader stated; the adjustment is derived from it.

## 4. Storage

On the device in `localStorage["mogmine-accounts-v1"]` (accounts and checks), apart from the trade list. Backups carry `accounts`; an older backup without it leaves this device's accounts untouched. These move to Supabase with the trades (`R-05`, `OD-30`), into the `accounts` table already named in docs/06.

## 5. Copy

Label every total **"From your journal · gross"**. Never "live", "balance" alone, or "net". A breached limit is described, not judged (UX-67): "Reached the $2,000 loss limit on Tue, Nov 17", not "You blew the account". Account money follows Shield mode like all dollars (UX-64).

## 6. Build steps

1. **Engine, store, `account_id` on trades, backups.** Done.
2. **Account card on Today:** balance, high point, room left before the limit, today's result, progress to the target, a small balance line. Tapping it opens the account's ledger.
3. **Account picker** in the entry form (and the new entry panel from docs/19), defaulting to the account used last (`defaultAccountId`). Assigning an account on Trade Detail.
4. **Account setup and rules screen,** and Drawdown Defender as an account rule (docs/17).
