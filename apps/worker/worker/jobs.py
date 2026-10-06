"""PostgreSQL 工作佇列（FOR UPDATE SKIP LOCKED），可同時跑多個 Worker。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Jsonb

TAIPEI = ZoneInfo("Asia/Taipei")
DAILY_DIGEST_AT = time(6, 0)
MAX_ATTEMPTS = 3


@dataclass
class Job:
    id: int
    kind: str
    payload: dict
    attempts: int


def enqueue(conn: psycopg.Connection, kind: str, dedupe_key: str | None, payload: dict, run_at: datetime) -> bool:
    cur = conn.execute(
        """INSERT INTO jobs (kind, dedupe_key, payload, run_at) VALUES (%s, %s, %s, %s)
           ON CONFLICT (kind, dedupe_key) DO NOTHING""",
        (kind, dedupe_key, Jsonb(payload), run_at),
    )
    return cur.rowcount == 1


def schedule_daily_digest(conn: psycopg.Connection, now: datetime) -> bool:
    """確保今天（台北時間）06:00 的新聞彙整工作已排入佇列。"""
    today: date = now.astimezone(TAIPEI).date()
    run_at = datetime.combine(today, DAILY_DIGEST_AT, tzinfo=TAIPEI)
    return enqueue(conn, "news_digest", today.isoformat(), {"date": today.isoformat()}, run_at)


def claim(conn: psycopg.Connection) -> Job | None:
    row = conn.execute(
        """UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
           WHERE id = (
             SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now()
             ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1)
           RETURNING id, kind, payload, attempts"""
    ).fetchone()
    return Job(*row) if row else None


def complete(conn: psycopg.Connection, job: Job) -> None:
    conn.execute("UPDATE jobs SET status = 'done', last_error = NULL, updated_at = now() WHERE id = %s", (job.id,))


def fail(conn: psycopg.Connection, job: Job, error: str) -> None:
    """失敗時延後重試（5、10 分鐘），超過次數標記為 failed。"""
    if job.attempts >= MAX_ATTEMPTS:
        conn.execute(
            "UPDATE jobs SET status = 'failed', last_error = %s, updated_at = now() WHERE id = %s",
            (error[:2000], job.id),
        )
    else:
        conn.execute(
            """UPDATE jobs SET status = 'queued', last_error = %s, run_at = now() + %s, updated_at = now()
               WHERE id = %s""",
            (error[:2000], timedelta(minutes=5 * job.attempts), job.id),
        )
