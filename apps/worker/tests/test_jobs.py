from datetime import datetime, timezone

from worker import jobs


def test_daily_digest_is_scheduled_once_per_taipei_day(worker_conn):
    # 台北時間 10/6 01:00（UTC 10/5 17:00）
    now = datetime(2026, 10, 5, 17, 0, tzinfo=timezone.utc)
    assert jobs.schedule_daily_digest(worker_conn, now) is True
    assert jobs.schedule_daily_digest(worker_conn, now) is False
    key, run_at = worker_conn.execute("SELECT dedupe_key, run_at FROM jobs").fetchone()
    assert key == "2026-10-06"
    assert run_at == datetime(2026, 10, 5, 22, 0, tzinfo=timezone.utc)  # 06:00 台北時間


def test_claim_complete_and_retry(worker_conn):
    past = datetime(2020, 1, 1, tzinfo=timezone.utc)
    jobs.enqueue(worker_conn, "news_digest", "a", {"date": "2026-10-06"}, past)
    job = jobs.claim(worker_conn)
    assert job and job.attempts == 1 and job.payload == {"date": "2026-10-06"}
    assert jobs.claim(worker_conn) is None  # 執行中的工作不會被重複領取

    jobs.fail(worker_conn, job, "boom")
    status, err = worker_conn.execute("SELECT status, last_error FROM jobs WHERE id = %s", (job.id,)).fetchone()
    assert (status, err) == ("queued", "boom")
    assert jobs.claim(worker_conn) is None  # 延後重試

    worker_conn.execute("UPDATE jobs SET run_at = now() - interval '1 second'")
    job = jobs.claim(worker_conn)
    job.attempts = jobs.MAX_ATTEMPTS
    jobs.fail(worker_conn, job, "boom again")
    assert worker_conn.execute("SELECT status FROM jobs").fetchone()[0] == "failed"

    jobs.enqueue(worker_conn, "news_digest", "b", {}, past)
    job = jobs.claim(worker_conn)
    jobs.complete(worker_conn, job)
    assert worker_conn.execute("SELECT status FROM jobs WHERE id = %s", (job.id,)).fetchone()[0] == "done"
