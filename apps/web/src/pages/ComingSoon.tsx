const PLANS: Record<string, string[]> = {
  二: [
    "上傳保險公司建議書 PDF 並指定客戶",
    "在本平台擷取文字與表格，以規則遮蔽個資（去識別化），送出前再做安全檢查",
    "去識別化內容送 Claude 分析，填入統一格式",
    "業務員逐欄確認（低信心欄位標示），確認後才產生給客戶看的簡化圖卡",
  ],
  三: [
    "傳專屬連結給客戶，免登入用手機填寫需求問卷（含個資同意）",
    "計算醫療、意外、重疾、壽險、失能、長照、退休的保障缺口",
    "先以規則從共用商品庫篩選商品，再由 AI 撰寫推薦理由",
  ],
};

export function ComingSoon({ phase, title }: { phase: "二" | "三"; title: string }) {
  return (
    <section className="panel coming">
      <span className="pill brand">第{phase}階段開發中</span>
      <h2 style={{ fontSize: 18 }}>{title}</h2>
      <p className="small muted">此功能依開發順序於第{phase}階段上線，規劃流程如下：</p>
      <ol>{PLANS[phase]!.map((s) => <li key={s}>{s}</li>)}</ol>
      <p className="small muted">介面設計可參考 prototype/agent-portal.html。</p>
    </section>
  );
}
