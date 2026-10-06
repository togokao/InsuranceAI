"""整合測試使用 insuranceai_test 資料庫（需先跑過 API 的 migration，見 README）。"""

import os

import psycopg
import pytest

OWNER_URL = os.environ.get("TEST_MIGRATION_DATABASE_URL", "postgres://insuranceai_owner:dev@localhost:5432/insuranceai_test")
WORKER_URL = os.environ.get("TEST_WORKER_DATABASE_URL", "postgres://insuranceai_worker_login:dev@localhost:5432/insuranceai_test")


def _connect(url: str) -> psycopg.Connection:
    try:
        return psycopg.connect(url, autocommit=True)
    except psycopg.OperationalError as e:
        pytest.skip(f"無法連線測試資料庫：{e}")


@pytest.fixture
def owner():
    with _connect(OWNER_URL) as conn:
        if conn.execute("SELECT to_regclass('public.news_items')").fetchone()[0] is None:
            pytest.skip("測試資料庫尚未 migrate")
        conn.execute("TRUNCATE news_items, news_sources, jobs RESTART IDENTITY CASCADE")
        yield conn


@pytest.fixture
def worker_conn(owner):
    with _connect(WORKER_URL) as conn:
        yield conn
