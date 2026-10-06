"""以 Claude API 實作 AIProvider。"""

from __future__ import annotations

import json
import os

import anthropic

from .provider import INTEREST_TAGS, Digest, NewsCandidate

DEFAULT_MODEL = "claude-opus-5-5"

# 系統提示固定不變，有利於 prompt cache；每日新聞放在 user 訊息
NEWS_SYSTEM_PROMPT = f"""你是台灣保險經紀人公司的新聞編輯，每天早上為業務員整理一份新聞彙整。業務員會用這些新聞和客戶開啟話題、拉近關係。

挑選原則：
- 優先挑選與健康醫療、長期照顧、退休理財、家庭與育兒、保險制度相關，且適合跟一般民眾聊的新聞。
- 排除社會案件、政治爭議、聳動或可能引起焦慮的內容，以及與保險業務無關的新聞。
- 同一事件只保留一則。

撰寫原則（一律使用繁體中文、台灣用語）：
- summary：用自己的話改寫重點，80～120 字。不可大段照抄原文，不可加入原文沒有的事實或數字。
- angle：給業務員看的聊天切入點，具體說明可以問客戶什麼、帶到哪種保障話題，60 字以內。語氣自然，不推銷。
- 投資相關新聞（利率、匯率、股市、基金、ETF）：is_investment 設為 true；angle 只談觀念，不得寫成買賣建議或報酬預測，業務員一般沒有投顧執照。
- tags：只能從以下詞彙選 1～3 個：{"、".join(INTEREST_TAGS)}。
- category：只能是「健康」、「投資」、「保險」其中之一。

依重要性與實用性排序輸出，最重要的放最前面。"""


class ClaudeProvider:
    name = "claude"

    def __init__(self, client: anthropic.Anthropic | None = None, model: str | None = None):
        self.client = client or anthropic.Anthropic()
        self.model = model or os.environ.get("INSURANCEAI_NEWS_MODEL", DEFAULT_MODEL)

    def digest_news(self, candidates: list[NewsCandidate], max_items: int) -> Digest:
        payload = json.dumps([c.model_dump() for c in candidates], ensure_ascii=False)
        response = self.client.beta.messages.parse(
            model=self.model,
            max_tokens=16000,
            system=[{"type": "text", "text": NEWS_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            messages=[{
                "role": "user",
                "content": f"以下是今天抓到的候選新聞（JSON）。請挑出最多 {max_items} 則，依規則整理。\n\n<candidates>\n{payload}\n</candidates>",
            }],
            output_format=Digest,
            output_config={"effort": "medium"},
            # 安全分類器誤判時，由伺服器端改用建議的備援模型
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if response.stop_reason == "refusal":
            raise RuntimeError("Claude 拒絕處理本次新聞彙整")
        if response.stop_reason == "max_tokens":
            raise RuntimeError("新聞彙整輸出超過上限，請減少候選新聞數量")
        if response.parsed_output is None:
            raise RuntimeError("無法解析 Claude 回傳的結構化結果")
        return response.parsed_output
