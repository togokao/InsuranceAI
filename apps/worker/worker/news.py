"""每日新聞彙整：抓 RSS → 去除重複 → AI 挑選與摘要 → 寫入資料庫（平台共用一份）。"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

import httpx
import psycopg

from .ai import INTEREST_TAGS, AIProvider, Digest, NewsCandidate
from .feeds import FeedEntry, fetch_feed, recent_unique

log = logging.getLogger(__name__)

MAX_CANDIDATES = 60
MAX_ITEMS = 12
CATEGORIES = {"健康", "投資", "保險"}


def select_entries(digest: Digest, candidates: list[FeedEntry], max_items: int) -> list[dict]:
    """驗證 AI 回傳結果：編號必須存在且不重複、標籤限定詞彙；不合格的直接捨棄。"""
    rows: list[dict] = []
    used: set[int] = set()
    for item in digest.items:
        if not (0 <= item.index < len(candidates)) or item.index in used:
            continue
        if item.category not in CATEGORIES or not item.summary.strip() or not item.angle.strip():
            continue
        used.add(item.index)
        src = candidates[item.index]
        rows.append({
            "category": item.category,
            "title": src.title,
            "source_name": src.source_name,
            "url": src.url,
            "published_at": src.published_at,
            "summary": item.summary.strip(),
            "angle": item.angle.strip(),
            "tags": [t for t in dict.fromkeys(item.tags) if t in INTEREST_TAGS][:3],
            "is_investment": item.is_investment or item.category == "投資",
        })
        if len(rows) >= max_items:
            break
    return rows


def collect_candidates(conn: psycopg.Connection, http: httpx.Client, now: datetime) -> list[FeedEntry]:
    sources = conn.execute(
        "SELECT name, feed_url, category FROM news_sources WHERE active ORDER BY name"
    ).fetchall()
    entries: list[FeedEntry] = []
    for name, url, category in sources:
        try:
            entries += fetch_feed(http, url, name, category)
        except Exception as e:  # 單一來源失敗不影響其他來源
            log.warning("抓取新聞來源失敗 %s（%s）：%s", name, url, e)
    if not entries:
        return []
    known = {
        r[0] for r in conn.execute(
            "SELECT url FROM news_items WHERE url = ANY(%s)", ([e.url for e in entries],)
        ).fetchall()
    }
    return recent_unique(entries, now, known_urls=known)[:MAX_CANDIDATES]


def build_digest(
    conn: psycopg.Connection,
    provider: AIProvider,
    http: httpx.Client,
    digest_date: date,
    now: datetime | None = None,
    max_items: int = MAX_ITEMS,
) -> int:
    """產生指定日期的新聞彙整，回傳新增筆數。"""
    now = now or datetime.now(timezone.utc)
    candidates = collect_candidates(conn, http, now)
    if not candidates:
        log.info("沒有新的候選新聞")
        return 0

    digest = provider.digest_news(
        [
            NewsCandidate(index=i, title=c.title, source_name=c.source_name,
                          source_category=c.source_category, description=c.description)
            for i, c in enumerate(candidates)
        ],
        max_items=max_items,
    )
    rows = select_entries(digest, candidates, max_items)

    start_rank = conn.execute(
        "SELECT coalesce(max(rank) + 1, 0) FROM news_items WHERE digest_date = %s", (digest_date,)
    ).fetchone()[0]
    inserted = 0
    with conn.transaction():
        for offset, r in enumerate(rows):
            cur = conn.execute(
                """INSERT INTO news_items (digest_date, category, title, source_name, url, published_at, summary,
                                           angle, tags, is_investment, rank)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (url) DO NOTHING""",
                (digest_date, r["category"], r["title"], r["source_name"], r["url"], r["published_at"], r["summary"],
                 r["angle"], r["tags"], r["is_investment"], start_rank + offset),
            )
            inserted += cur.rowcount
    log.info("新聞彙整 %s：候選 %d 則，新增 %d 則（%s）", digest_date, len(candidates), inserted, provider.name)
    return inserted
