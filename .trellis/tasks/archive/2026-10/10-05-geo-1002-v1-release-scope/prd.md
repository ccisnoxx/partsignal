# GEO-1002：冻结 GEO Core V1.0 人工优先发布范围和发布门禁

## 目标与授权

依据用户在 2026-10-05 的明确指示，接受 ADR-007，冻结人工优先首发范围、默认配置、Go/No-Go 和 GEO-1003～1010 后续任务。GEO-1001 已完成审计，结论 NO-GO；本任务不消除运行实现或生产证据缺口。

## 输入与权威

- 根 AGENTS.md、GEO README、GEO-1001 审计报告、现有 PRD。
- 业务架构、状态机、技术架构、路线图、WBS、task-manifest。
- ADR-005、ADR-006、GEO-906 production-readiness 原始证据及 rollout runbook。

## 交付与验收

- ADR-007 为 Accepted；接受依据为用户本次范围冻结指示，不补造签署人。
- 统一能力矩阵区分 available / manual-only / disabled / deferred / not implemented，并区分政策与当前实现。
- Manifest 追加 GEO-1002～1010；每项有依赖、交付物、测试和可观察验收；R9A 纳入路线图/WBS。
- Runbook 明确 V1.0 Go/No-Go；既有 NO-GO 在后续阻断闭合前保持。
- R0—R8 全部原始任务数据及历史接受记录保持，GEO-1001 和 production-readiness 原文不改。
- 执行 Markdown 链接、manifest、git diff --check，记录真实结果和既存失败；本次文档差异无新增断链或空白错误，保护范围无本任务变化。
- GEO-1002 与 Trellis 最终为 review，completedAt 为 null；后续任务仅 planned。

## 范围外

运行时代码、数据库 Schema、OpenAPI、部署脚本、生产访问/写入、提交/推送、实施 GEO-1003～1010、解除 R7 延期。本任务定义修复与发布条件，不触发它们。
