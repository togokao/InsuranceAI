from datetime import date, datetime, timezone

import httpx

from worker.ai import Digest, DigestEntry
from worker.ai.claude import ClaudeProvider
from worker.feeds import FeedEntry
from worker.news import build_digest, select_entries

NOW = datetime(2026, 10, 6, 0, 0, tzinfo=timezone.utc)


def entry(i: int, category: str = "健康") -> FeedEntry:
    return FeedEntry(f"新聞{i}", f"https://example.com/{i}", "示範", category, NOW, "描述")


def digest_entry(index: int, **kw) -> DigestEntry:
    base = dict(index=index, category="健康", summary="摘要", angle="切入點", tags=["健康"], is_investment=False)
    return DigestEntry(**{**base, **kw})


def test_select_entries_validates_ai_output():
    candidates = [entry(0), entry(1), entry(2, "投資")]
    digest = Digest(items=[
        digest_entry(5),                                   # 編號不存在
        digest_entry(1, tags=["健康", "不存在", "健康"]),   # 標籤過濾、去重
        digest_entry(1),                                   # 重複編號
        digest_entry(0, summary="  "),                     # 空摘要
        digest_entry(2, category="投資"),                  # 投資類一律標記免責
    ])
    rows = select_entries(digest, candidates, max_items=10)
    assert [r["url"] for r in rows] == ["https://example.com/1", "https://example.com/2"]
    assert rows[0]["tags"] == ["健康"]
    assert rows[1]["is_investment"] is True
    assert len(select_entries(digest, candidates, max_items=1)) == 1


class FakeProvider:
    name = "fake"

    def __init__(self):
        self.calls = []

    def digest_news(self, candidates, max_items):
        self.calls.append(candidates)
        return Digest(items=[digest_entry(c.index, summary=f"{c.title}摘要") for c in candidates])


RSS = """<rss><channel>
<item><title>新聞A</title><link>https://example.com/a</link><pubDate>Mon, 05 Oct 2026 22:00:00 +0000</pubDate></item>
<item><title>新聞B</title><link>https://example.com/b</link><pubDate>Mon, 05 Oct 2026 21:00:00 +0000</pubDate></item>
</channel></rss>"""


def test_build_digest_end_to_end(owner, worker_conn):
    owner.execute(
        """INSERT INTO news_sources (name, feed_url, category) VALUES
           ('來源一', 'https://feeds.example.com/ok.rss', '健康'),
           ('壞掉的來源', 'https://feeds.example.com/broken.rss', '投資')"""
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/ok.rss":
            return httpx.Response(200, text=RSS)
        return httpx.Response(500)

    provider = FakeProvider()
    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        assert build_digest(worker_conn, provider, http, date(2026, 10, 6), now=NOW) == 2
        # 已處理過的新聞不會再送給 AI
        assert build_digest(worker_conn, provider, http, date(2026, 10, 6), now=NOW) == 0

    assert len(provider.calls) == 1
    rows = owner.execute("SELECT title, summary, rank, digest_date FROM news_items ORDER BY rank").fetchall()
    assert rows == [("新聞A", "新聞A摘要", 0, date(2026, 10, 6)), ("新聞B", "新聞B摘要", 1, date(2026, 10, 6))]


def test_worker_role_cannot_read_client_data(worker_conn):
    import psycopg
    import pytest

    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        worker_conn.execute("SELECT * FROM clients")


class _StubMessages:
    def __init__(self):
        self.kwargs = None

    def parse(self, **kwargs):
        self.kwargs = kwargs

        class R:
            stop_reason = "end_turn"
            parsed_output = Digest(items=[])

        return R()


def test_claude_provider_request_shape():
    stub = _StubMessages()
    client = type("C", (), {"beta": type("B", (), {"messages": stub})()})()
    ClaudeProvider(client=client, model="claude-opus-5-5").digest_news([], max_items=5)
    kw = stub.kwargs
    assert kw["model"] == "claude-opus-5-5"
    assert kw["output_format"] is Digest
    assert kw["fallbacks"] == "default"
    assert kw["betas"] == ["server-side-fallback-2026-07-01"]
    assert "最多 5 則" in kw["messages"][0]["content"]
