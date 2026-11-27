import unittest
from datetime import date

import pandas as pd

from archive_db import session_window, timestamp_session_date
from forward_fill_yahoo import contract_match, next_contract, yahoo_contract


class ArchiveJobTests(unittest.TestCase):
    def test_session_window_tracks_chicago_dst(self):
        march_start, march_end = session_window(date(2026, 3, 16))
        november_start, november_end = session_window(date(2026, 11, 24))
        self.assertEqual(march_start.isoformat(), "2026-03-15T22:00:00+00:00")
        self.assertEqual(march_end.isoformat(), "2026-03-16T21:00:00+00:00")
        self.assertEqual(november_start.isoformat(), "2026-11-23T23:00:00+00:00")
        self.assertEqual(november_end.isoformat(), "2026-11-24T22:00:00+00:00")
        self.assertEqual(timestamp_session_date(november_start), date(2026, 11, 24))

    def test_contract_sequence_and_yahoo_symbol(self):
        self.assertEqual(next_contract("MESZ6"), "MESH7")
        self.assertEqual(yahoo_contract("MESZ6", 2026), "MESZ26.CME")
        self.assertEqual(yahoo_contract("MESH7", 2026), "MESH27.CME")

    def test_contract_match_finds_following_and_spread(self):
        ts = pd.date_range("2026-12-14T23:00:00Z", periods=60, freq="min")
        current = pd.DataFrame({"ts": ts, "close": [7200.0] * 60, "volume": [10] * 60})
        following = pd.DataFrame({"ts": ts, "close": [7269.5] * 60, "volume": [20] * 60})
        continuous = following.copy()
        match = contract_match(continuous, current, following)
        self.assertEqual(match["selected"], "following")
        self.assertEqual(match["spread"], 69.5)
        self.assertEqual(match["volume_leader"], "following")

    def test_contract_match_rejects_mid_session_switch(self):
        ts = pd.date_range("2026-12-14T23:00:00Z", periods=60, freq="min")
        current = pd.DataFrame({"ts": ts, "close": [7200.0] * 60, "volume": [10] * 60})
        following = pd.DataFrame({"ts": ts, "close": [7270.0] * 60, "volume": [20] * 60})
        continuous = pd.DataFrame({"ts": ts, "close": [7200.0] * 30 + [7270.0] * 30})
        with self.assertRaisesRegex(ValueError, "inside one session"):
            contract_match(continuous, current, following)


if __name__ == "__main__":
    unittest.main()
