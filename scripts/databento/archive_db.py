"""Small, project-pinned Supabase Management API helper for archive scripts."""

from __future__ import annotations

import json
import os
import time
from datetime import date, datetime, time as wall_time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import requests

PROJECT_REF = "vsasmtsifuylhfrrsrso"
CHICAGO = ZoneInfo("America/Chicago")


class ManagementDb:
    def __init__(self) -> None:
        token = os.environ.get("SUPABASE_ACCESS_TOKEN")
        if not token:
            raise RuntimeError("SUPABASE_ACCESS_TOKEN is not set")
        self.url = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

    def execute(self, query: str) -> list[dict[str, Any]]:
        for attempt in range(4):
            response = self.session.post(self.url, json={"query": query}, timeout=120)
            if response.ok:
                return response.json()
            if response.status_code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f"Supabase query failed ({response.status_code}): {response.text[:500]}")
            time.sleep(2**attempt)
        raise RuntimeError(f"Supabase query failed after retries ({response.status_code}): {response.text[:500]}")


def session_window(session_date: date) -> tuple[datetime, datetime]:
    start_local = datetime.combine(session_date - timedelta(days=1), wall_time(17), CHICAGO)
    end_local = datetime.combine(session_date, wall_time(16), CHICAGO)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def timestamp_session_date(value: datetime) -> date:
    local = value.astimezone(CHICAGO)
    return local.date() + timedelta(days=1 if local.hour >= 17 else 0)


def json_recordset(rows: list[dict[str, Any]]) -> str:
    payload = json.dumps(rows, separators=(",", ":"), default=str)
    if "$rows$" in payload:
        raise ValueError("Unexpected SQL dollar-quote marker in archive payload")
    return f"$rows${payload}$rows$::jsonb"


def start_job(
    db: ManagementDb, *, kind: str, source: str, range_from: datetime, range_to: datetime
) -> str:
    rows = db.execute(
        "insert into public.mogmine_market_archive_jobs "
        "(kind,source,symbol,timeframe,range_from,range_to,status) values "
        f"('{kind}','{source}','MES=F','1m','{range_from.isoformat()}','{range_to.isoformat()}','started') "
        "returning id"
    )
    return str(rows[0]["id"])


def finish_job(
    db: ManagementDb,
    job_id: str,
    *,
    status: str,
    bars: int,
    result: dict[str, Any],
    error: str | None = None,
) -> None:
    result_sql = json_recordset([result])
    error_sql = "null" if error is None else "'" + error.replace("'", "''")[:2000] + "'"
    db.execute(
        "update public.mogmine_market_archive_jobs set finished_at=now(), "
        f"status='{status}', bars_upserted={bars}, last_error={error_sql}, "
        f"result=({result_sql}->0) where id='{job_id}'::uuid"
    )
