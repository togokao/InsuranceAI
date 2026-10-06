"""背景 Worker 進入點。

  python -m worker run              # 常駐：每天台北時間 06:00 自動產生新聞彙整，並處理工作佇列
  python -m worker digest [--date]  # 立即產生一次新聞彙整
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import threading
from datetime import date, datetime, timezone

import httpx
import psycopg

from . import jobs
from .ai import get_provider
from .news import build_digest

log = logging.getLogger("worker")

DEFAULT_DB = "postgres://insuranceai_worker_login:dev@localhost:5432/insuranceai"
POLL_SECONDS = 30
USER_AGENT = "InsuranceAI-NewsBot/0.1 (+summary and link only)"


def connect() -> psycopg.Connection:
    return psycopg.connect(os.environ.get("WORKER_DATABASE_URL", DEFAULT_DB), autocommit=True)


def run_job(conn: psycopg.Connection, job: jobs.Job) -> None:
    if job.kind == "news_digest":
        with httpx.Client(headers={"User-Agent": USER_AGENT}) as http:
            build_digest(conn, get_provider(), http, date.fromisoformat(job.payload["date"]))
    else:
        raise ValueError(f"未知的工作類型：{job.kind}")


def run_forever() -> None:
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    log.info("Worker 啟動")
    while not stop.is_set():
        try:
            with connect() as conn:
                jobs.schedule_daily_digest(conn, datetime.now(timezone.utc))
                while not stop.is_set() and (job := jobs.claim(conn)):
                    log.info("執行工作 #%d %s（第 %d 次）", job.id, job.kind, job.attempts)
                    try:
                        run_job(conn, job)
                        jobs.complete(conn, job)
                    except Exception as e:
                        log.exception("工作 #%d 失敗", job.id)
                        jobs.fail(conn, job, f"{type(e).__name__}: {e}")
        except psycopg.OperationalError:
            log.exception("資料庫連線失敗，稍後重試")
        stop.wait(POLL_SECONDS)
    log.info("Worker 結束")


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(prog="worker")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run", help="常駐執行")
    d = sub.add_parser("digest", help="立即產生新聞彙整")
    d.add_argument("--date", type=date.fromisoformat, default=None, help="彙整日期，預設為今天（台北時間）")
    args = parser.parse_args()

    if args.cmd == "run":
        run_forever()
    else:
        digest_date = args.date or datetime.now(jobs.TAIPEI).date()
        with connect() as conn, httpx.Client(headers={"User-Agent": USER_AGENT}) as http:
            n = build_digest(conn, get_provider(), http, digest_date)
        print(f"{digest_date} 新增 {n} 則新聞")


if __name__ == "__main__":
    main()
