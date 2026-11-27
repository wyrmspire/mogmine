import unittest

import pandas as pd

from trades_to_1m import derive_bars, select_session_contracts, session_dates


class DatabentoConverterTests(unittest.TestCase):
    def test_session_date_uses_1700_chicago_boundary_across_dst(self):
        timestamps = pd.Series(pd.to_datetime(["2026-03-08T21:59:00Z", "2026-03-08T22:00:00Z"], utc=True))
        self.assertEqual([str(value.date()) for value in session_dates(timestamps)], ["2026-03-08", "2026-03-09"])

    def test_selects_highest_volume_contract_per_session(self):
        bars = pd.DataFrame(
            {
                "session_date": pd.to_datetime(["2026-06-12"] * 3),
                "symbol": ["MESM6", "MESM6", "MESU6"],
                "volume": [10, 20, 31],
            }
        )
        selected = select_session_contracts(bars)
        self.assertEqual(selected.iloc[0]["vendor_contract"], "MESU6")

    def test_derived_bar_preserves_ohlcv(self):
        one_minute = pd.DataFrame(
            {
                "symbol": ["MES=F"] * 2,
                "timeframe": ["1m"] * 2,
                "ts": pd.to_datetime(["2026-11-24T00:00:00Z", "2026-11-24T00:01:00Z"], utc=True),
                "open": [6000.0, 6000.5],
                "high": [6000.75, 6001.0],
                "low": [5999.75, 6000.25],
                "close": [6000.5, 6000.75],
                "volume": [2, 3],
                "session_date": [pd.Timestamp("2026-11-24").date()] * 2,
                "vendor_contract": ["MESZ6"] * 2,
                "source": ["databento"] * 2,
            }
        )
        bar = derive_bars(one_minute, 5).iloc[0]
        self.assertEqual((bar.open, bar.high, bar.low, bar.close, bar.volume), (6000.0, 6001.0, 5999.75, 6000.75, 5))


if __name__ == "__main__":
    unittest.main()
