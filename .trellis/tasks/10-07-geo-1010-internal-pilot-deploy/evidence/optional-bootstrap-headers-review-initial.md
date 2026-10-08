# 可选 Header 初次独立复核

独立 `critical_reviewer` `/root/bootstrap_header_review` 只读复核当前候选，确认一项 P2，建议在冻结和部署前修复：合法 token 名称可超过既有 `AIChannelHeader.name/normalized_name` 的 `varchar(160)` 容量。161 字符名称被 Host、backend reader 和真实 BACKEND_CHECK 接受，T1 真实数据库 flush 将失败；CLI UNKNOWN 与已持久 STARTED 会阻断重入和 activation。

复核建议限于 bootstrap reader 与 Host 输入前的 160 字符上限，不改变 HTTP API 或 DB schema。其余可选省略/空输入、精确键/strict 类型、Header service 提交合同、T1/T2/T3、加密 associated data、审计、no-echo/stdin、完整大小/容器身份/重入/unknown 路径未确认其他 actionable finding。

该结论的反例接受路径与列容量由只读合成诊断和源码确认，未执行真实 PostgreSQL 故障或 Host 初始化。PG 11 skip、真实 Engine/provider/完整 Gate 未验证的限制保留。主代理已补 160/161 回归，确认修前失败后修正；最终关闭结论另存修正复核记录。
