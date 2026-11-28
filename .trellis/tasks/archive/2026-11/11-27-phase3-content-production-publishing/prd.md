# Phase 3 PRD：内容生产与发布体验升级（方向 A 纯 GEO）

## 目标与范围

基于已冻结的“纯 GEO 内容运营工作台”方向与 Phase 2 产物（`ContentCampaign`、`ContentBriefSnapshot`、`FactVersion` 运营元数据），分 4 个垂直切片完成内容生产质量与人工发布体验升级：

1. **Slice 3A（`0075_prompt_versioning_and_brief_v4`）**：
   - `PlatformPrompt` 升级为不可变版本化（`platform_prompt_versions`），`PlatformProfile` 显式绑定已发布版本并支持回滚，提供按版本聚合的效果指标（首次审核通过率、平均人工修订数、已发布数与 GEO 表现）。
   - 新增 `content-markdown-v4` AI 输入合同：固定分层组装 `system=PlatformPromptVersion` + `user=ContentBriefSnapshot + PUBLIC FactVersion + 合规边界声明`，严禁外发 `source_owner`/`source_reference` 等内部字段；无 Brief 存量任务保持 `v3` 兼容。
2. **Slice 3B（`0076_quality_gate_and_duplication`）**：
   - 双层质量检查引擎：
     - Layer 1 同步确定性规则（`BLOCKING / WARNING / INFORMATION`）：禁止表达命中、型号/品牌缺失或拼写误写、绝对化替代词、自然化新增技术声明（`BLOCKING`）；事实外带单位技术数值、标题长度建议、Brief 关键词覆盖、同 Campaign/同产品高重复度（`WARNING`，提交审核需显式确认）；CTA/标题结构提示（`INFORMATION`）。
     - 重复度分析读模型：展示同 Campaign 与同产品历史相似度、重复标题、重复段落与差异化建议。
     - Layer 2 异步可选 AI 语义质检作业（`content_quality_check_jobs`，复用 `PUBLIC` 门禁、幂等键、租约与 Token 统计）。
3. **Slice 3C（`0077_publication_package_and_precheck`）**：
   - 增强发布包：基于 Markdown 实时确定性派生富文本 HTML、纯文本、摘要、标签、推荐话题、链接与锚文本、图片与 Alt 文本、字符数统计、平台发布检查清单、版本号与内容哈希；前端支持分区一键复制。
   - 发布前检查：登记结果前校验域名、标题一致性、正文段落完整性、禁止表达、链接有效性、图片 Alt、标签数量与发布元数据。
4. **Slice 3D（`0078_public_page_health_checks`）**：
   - 公开页面健康检查：按 `PlatformProfile` 显式开关启用，严格执行 SSRF 防护（含每次跳转 DNS/IP 校验、跳转次数/超时/体积上限），追加记录 `published_article_health_checks`。
   - 明确区分 `HEALTHY`、`FETCH_BLOCKED`（403/WAF/登录墙/超时，仅告警不自动建 `PublishedContentIssue`）与 `CONFIRMED_ANOMALY`（连续 N 次 404/410、`noindex`、第三方 Canonical 篡改或正文相似度严重跌落时自动建 `PublishedContentIssue`）。

## 硬约束

- Markdown 为内容正文唯一可编辑来源，绝不持久化可独立编辑 HTML 或 editor JSON。
- 所有外发第三方 AI 请求严格校验 `FactVersion.classification == 'PUBLIC'`，永不外发内部溯源元数据。
- 所有迁移均为加法前滚迁移，`downgrade()` 固定以 `55000` 拒绝，历史不可变记录不回填改写。
- 保持 `ADMIN / ENGINEER` 两级权限模型，服务端保持动作权威与最终状态裁决。
