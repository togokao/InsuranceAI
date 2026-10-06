from datetime import datetime, timedelta, timezone

from worker.feeds import FeedEntry, parse_feed, recent_unique

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>示範</title>
  <item><title>流感疫苗&amp;開打</title><link>https://example.com/a</link>
    <pubDate>Tue, 06 Oct 2026 06:10:00 +0800</pubDate>
    <description><![CDATA[<p>長者與<b>幼兒</b>優先</p>]]></description></item>
  <item><title>沒有連結</title></item>
  <item><title>不安全連結</title><link>javascript:alert(1)</link></item>
</channel></rss>"""

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>示範</title>
  <entry><title>長照需求增加</title><link rel="alternate" href="https://example.com/b"/>
    <updated>2026-10-05T22:00:00Z</updated><summary>家庭照護負擔增加</summary></entry>
</feed>"""


def test_parse_rss_cleans_html_and_skips_invalid_items():
    entries = parse_feed(RSS, "示範新聞", "健康")
    assert len(entries) == 1
    e = entries[0]
    assert e.title == "流感疫苗&開打"
    assert e.description == "長者與 幼兒 優先"
    assert e.published_at == datetime(2026, 10, 5, 22, 10, tzinfo=timezone.utc)


def test_parse_atom():
    [e] = parse_feed(ATOM, "示範保險報", "保險")
    assert (e.title, e.url, e.source_category) == ("長照需求增加", "https://example.com/b", "保險")
    assert e.published_at == datetime(2026, 10, 5, 22, 0, tzinfo=timezone.utc)


def test_recent_unique_drops_old_known_and_duplicate_urls():
    now = datetime(2026, 10, 6, tzinfo=timezone.utc)
    mk = lambda url, hours: FeedEntry("t", url, "s", "健康", now - timedelta(hours=hours) if hours is not None else None, "")
    entries = [mk("https://x/1", 1), mk("https://x/1", 2), mk("https://x/2", 48), mk("https://x/3", 3), mk("https://x/4", None)]
    out = recent_unique(entries, now, known_urls={"https://x/3"})
    assert [e.url for e in out] == ["https://x/4", "https://x/1"]
