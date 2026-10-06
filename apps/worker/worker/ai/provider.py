"""AI 呼叫的抽換介面。

業務邏輯只依賴 AIProvider；之後要改用地端模型（例如企業版的 Ollama），
只需另外實作一個 provider，不必修改新聞彙整流程。
"""

from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel, Field

# 與客戶興趣標籤共用的詞彙，業務員端用來媒合客戶
INTEREST_TAGS = ["健康", "親子", "長照", "投資", "退休", "節稅", "傳承", "旅遊", "教育金", "企業"]

Category = Literal["健康", "投資", "保險"]


class NewsCandidate(BaseModel):
    index: int
    title: str
    source_name: str
    source_category: Category
    description: str


class DigestEntry(BaseModel):
    index: int = Field(description="對應候選新聞的編號")
    category: Category
    summary: str = Field(description="用自己的話改寫的摘要，80～120 字，不可照抄原文")
    angle: str = Field(description="業務員可用的聊天切入點，60 字以內")
    tags: list[str] = Field(description="從興趣標籤詞彙中選 1～3 個")
    is_investment: bool = Field(description="內容涉及投資、利率、匯率、股市或基金時為 true")


class Digest(BaseModel):
    items: list[DigestEntry]


class AIProvider(Protocol):
    name: str

    def digest_news(self, candidates: list[NewsCandidate], max_items: int) -> Digest:
        """從候選新聞中挑選、分類、摘要並產生聊天切入點。"""
        ...
