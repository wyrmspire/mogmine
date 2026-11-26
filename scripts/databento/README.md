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
