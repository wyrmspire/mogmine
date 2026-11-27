# Databento MES archive converter

`trades_to_1m.py` converts a Databento `GLBX.MDP3` `trades` batch for
`MES.FUT` into a continuous `MES=F` bar series. It reads the raw fixed-point
price (`1e-9` units), checks every included trade against MES's `0.25` tick,
and writes Parquet files for `1m`, `5m`, `15m`, and `1h` plus a session-contract
CSV and a JSON summary.

```bash
python3 scripts/databento/trades_to_1m.py \
  /home/chriswstubbs/data/databento/GLBX-20261126-HUCDKRKL5R \
  /home/chriswstubbs/data/databento/derived
```

The DBN headers in batch `GLBX-20261126-HUCDKRKL5R` contain mappings from
`instrument_id` to raw symbols even though the delivered records have symbol
mapping disabled. The converter therefore identifies outrights exactly with
`^MES[HMUZ]\d$` and excludes symbols containing `-` (calendar spreads). It does
not use the less reliable price-level heuristic.

For each 17:00-16:00 `America/Chicago` trading session, the converter selects
the outright with the largest summed trade size for the whole session. All bars
in that session come from that contract, so no bar can mix contracts. Empty
minutes remain absent. Higher timeframes are derived from the selected 1-minute
series; they are not separately fetched.

The outputs are local market data and must stay outside Git. The committed
script contains no Databento credentials and performs no network requests.

## Loading the archive

`load_databento.py` writes selected sessions from the local 1-minute Parquet
file to the approved Supabase project. It requires `SUPABASE_ACCESS_TOKEN` and
is deliberately pinned to project `vsasmtsifuylhfrrsrso`.

```bash
python3 scripts/databento/load_databento.py \
  /home/chriswstubbs/data/databento/derived/MES_F_1m.parquet \
  --from-session 2026-08-25 --to-session 2026-11-24
```

Each Chicago session is replaced atomically: Yahoo rows in its complete
17:00-16:00 window are deleted first, then Databento rows are upserted. This
also removes Yahoo-only minutes for which Databento has no trade, so one
covered session cannot be a mixture of sources. The database trigger installed
by `20261126081228_mogmine_market_source_precedence_and_rolls.sql` permanently
prevents a later Yahoo upsert from replacing a Databento row.

## Yahoo continuation

`forward_fill_yahoo.py` carries `MES=F` forward from the last archived session.
It requests at most seven days per Yahoo call (inside Yahoo's measured eight-day
`1m` limit), drops null, off-minute and out-of-window rows, refreshes a whole
Chicago session, and records every run in `mogmine_market_archive_jobs`.
Rerunning it is safe: Yahoo may update Yahoo rows, but the upsert predicate and
database trigger both preserve Databento rows.

```bash
python3 scripts/databento/forward_fill_yahoo.py
```

No scheduler is installed in this change. A later deployment can invoke this
command from a secured daily systemd timer or equivalent shortly after the
16:00 Chicago session close; the host must provide `SUPABASE_ACCESS_TOKEN` and
retain enough overlap to recover a missed run. App archive-first reads are also
a later change.

## Roll and price contract

Prices are unadjusted. Databento changes contract only at a session boundary,
to the outright with the largest summed trade size for that entire session.
The three observed effective rolls are MESH6 to MESM6 on 2026-03-16, MESM6 to
MESU6 on 2026-06-15, and MESU6 to MESZ6 on 2026-09-14. The recorded spread is
new minus old, using the median of their first 60 common one-minute closes after
the new session opens: 49.50, 63.00 and 66.75 points respectively.

Yahoo decides its own continuous-contract roll and may switch on a different
session from the Databento highest-volume rule. The continuation job therefore
compares `MES=F` with the current and next explicit CME contracts (for example
`MESZ26.CME` and `MESH27.CME`) using median price error, with contract volume as
supporting evidence. It refuses a within-session identity change rather than
silently producing a mixed-contract session. A session-boundary switch inserts
a `mogmine_market_rolls` row with the overlapping first-60-minute spread.

At the 2026-11-24 Databento/Yahoo seam, 1,360 minutes overlapped: median OHLC
difference was 0.00 and the last close was 7210.75 in both sources. Yahoo was
therefore on MESZ6, not offset by the MESZ6/MESH7 calendar spread. On the first
continuation run (2026-11-26), Yahoo still matched MESZ6; no future roll row was
created.
