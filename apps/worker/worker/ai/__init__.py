import os

from .provider import INTEREST_TAGS, AIProvider, Digest, DigestEntry, NewsCandidate


def get_provider() -> AIProvider:
    """依 INSURANCEAI_AI_PROVIDER 選擇 AI 服務（目前只有 claude）。"""
    name = os.environ.get("INSURANCEAI_AI_PROVIDER", "claude")
    if name == "claude":
        from .claude import ClaudeProvider

        return ClaudeProvider()
    raise ValueError(f"未知的 AI provider：{name}")


__all__ = ["AIProvider", "Digest", "DigestEntry", "INTEREST_TAGS", "NewsCandidate", "get_provider"]
