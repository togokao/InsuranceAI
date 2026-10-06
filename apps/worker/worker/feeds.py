"""抓取並解析 RSS 2.0 / Atom 新聞來源。只保留標題、連結、發布時間與簡短描述，不抓全文。"""

from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import httpx

ATOM = "{http://www.w3.org/2005/Atom}"
DESCRIPTION_LIMIT = 400  # 只給 AI 判斷主題用，不儲存
_TAG_RE = re.compile(r"<[^>]+>")


@dataclass(frozen=True)
class FeedEntry:
    title: str
    url: str
    source_name: str
    source_category: str
    published_at: datetime | None
    description: str


def _clean(text: str | None) -> str:
    if not text:
        return ""
    text = html.unescape(_TAG_RE.sub(" ", text))
    return re.sub(r"\s+", " ", text).strip()


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    try:
        dt = parsedate_to_datetime(value)  # RFC 822（RSS）
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))  # RFC 3339（Atom）
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_feed(xml_text: str | bytes, source_name: str, source_category: str) -> list[FeedEntry]:
    root = ET.fromstring(xml_text)
    entries: list[FeedEntry] = []
    if root.tag == f"{ATOM}feed":
        for e in root.iter(f"{ATOM}entry"):
            link = next(
                (l.get("href") for l in e.findall(f"{ATOM}link") if l.get("rel", "alternate") == "alternate"),
                None,
            )
            entries.append(FeedEntry(
                title=_clean(e.findtext(f"{ATOM}title")),
                url=(link or "").strip(),
                source_name=source_name,
                source_category=source_category,
                published_at=_parse_date(e.findtext(f"{ATOM}published") or e.findtext(f"{ATOM}updated")),
                description=_clean(e.findtext(f"{ATOM}summary") or e.findtext(f"{ATOM}content"))[:DESCRIPTION_LIMIT],
            ))
    else:
        for item in root.iter("item"):
            entries.append(FeedEntry(
                title=_clean(item.findtext("title")),
                url=(item.findtext("link") or "").strip(),
                source_name=source_name,
                source_category=source_category,
                published_at=_parse_date(item.findtext("pubDate")),
                description=_clean(item.findtext("description"))[:DESCRIPTION_LIMIT],
            ))
    return [e for e in entries if e.title and e.url.startswith(("http://", "https://"))]


def fetch_feed(client: httpx.Client, url: str, source_name: str, source_category: str) -> list[FeedEntry]:
    resp = client.get(url, timeout=20, follow_redirects=True)
    resp.raise_for_status()
    return parse_feed(resp.content, source_name, source_category)


def recent_unique(entries: list[FeedEntry], now: datetime, hours: int = 36, known_urls: set[str] | None = None) -> list[FeedEntry]:
    """保留近期、未處理過、網址不重複的新聞；沒有發布時間的也保留。"""
    cutoff = now - timedelta(hours=hours)
    seen = set(known_urls or ())
    out = []
    for e in sorted(entries, key=lambda x: x.published_at or now, reverse=True):
        if e.url in seen or (e.published_at and e.published_at < cutoff):
            continue
        seen.add(e.url)
        out.append(e)
    return out
