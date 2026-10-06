# GEO-1002：V1.0 人工优先范围冻结交付记录

日期：2026-10-05。交付状态：manifest / Trellis 均为 **review**，`completedAt: null`；不自行 done。当前生产结论保持 **NO-GO**。

## 授权与输入

用户明确授权产品范围、发布条件与后续修复任务冻结。已读取根 AGENTS.md、GEO README、GEO-1001 审计、现有 PRD、业务架构、状态机、技术架构、路线图、WBS、manifest、ADR-005/006、现有 production-readiness 与 rollout runbook。稳定合同与实现证据用于解释真实边界，不用于扩大本次编辑范围。

工作区开始时已有大量代码与文档变更；本次保存 GEO 文档前态、初始 Git 状态与 1350 项受保护文件指纹，按本任务前后差异界定改动。未操作生产、修改运行时代码、数据库 Schema、OpenAPI 或部署脚本；未提交、推送或实施 GEO-1003～1010。

## 文档交付

- [ADR-007](../../../docs/geo-monitoring/05-decisions/ADR-007-manual-first-v1-release-scope.md) 为 Accepted，依据本次用户明确范围指示，不补造签署人；批准范围不等于修复或生产放行。
- [能力矩阵](../../../docs/geo-monitoring/01-product/05-v1-release-capability-matrix.md) 是当前 V1.0 能力声明入口，定义 available / manual-only / disabled / deferred / not implemented，分别表达现有实现与发布政策。
- MANUAL 回答级观测、人工批次、证据、确定性分析、复核、指标/现有报告、管理员显式机会评估、现有 Action/Retest API 与内部试运行纳入范围。管理员 evaluator 方法存在，但实际生产调用入口缺失仍为 not implemented，须 GEO-1006 闭合。
- Browser、到期 CRON、自动周期 evaluator、机会 CSV、完整 Action/Retest 页面、公共管理员重分析及无依据“无引用”推断排除首发。Browser production 硬禁止与 CRON 假 ACTIVE 属待修复门禁，不能将文档政策称为已实现。
- 配置表区分真实开关与能力：Monitoring 按环境启用、MANUAL 可用、API 初始关闭；机会资格开关准备阶段关闭，获批的管理员显式评估可按阶段启用，自动调度仍关闭。未新增虚构 MANUAL 或调度开关。
- [PRD](../../../docs/geo-monitoring/01-product/02-geo-core-prd.md)、业务/状态机/技术架构同步当前适用范围；目标模型与历史记录保留。
- [Manifest](../../../docs/geo-monitoring/04-delivery/task-manifest.yaml) 追加 9 项任务；[路线图](../../../docs/geo-monitoring/04-delivery/01-implementation-roadmap.md) 与 [WBS](../../../docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md) 增加 R9A Release Blocker Closure。原 71 项记录保持字节前缀及解析结构一致，其中 67 done、4 deferred。
- [Runbook](../../../docs/geo-monitoring/03-technical/10-core-rollout-runbook.md) 增加 V1.0 Go/No-Go：Browser 禁止、Catalog 竞态、CRON 真诚状态、管理员入口、升级恢复、同候选验证、目标配置、MANUAL/Action/Retest 验收、监控容量、备份恢复及人工阶段批准。未知或未满足均阻断，旧 done 不替代现场证据。
- README、执行指南、治理 ID 范围与 CHANGELOG 同步；链接检查发现并修正技术文档 4 个既存相对路径错误。原 ADR-005/006、GEO-1001 审计及 production-readiness 不变。

## 后续任务与依赖

| 任务 | 后续交付 | 本次状态 |
|---|---|---|
| GEO-1003 | production Browser 配置/启动/profile 硬禁止 | planned |
| GEO-1004 | Catalog 锁内当前管理员身份重验 | planned |
| GEO-1005 | CRON 假 ACTIVE 防护及既存计划治理 | planned |
| GEO-1006 | 管理员显式 Opportunity evaluator 真实入口 | planned |
| GEO-1007 | 页面/API 能力声明与使用路径对齐 | planned |
| GEO-1008 | 尚未初始化升级阶段 artifact 失败恢复 | planned |
| GEO-1009 | 候选冻结及同候选验证证据 | planned |
| GEO-1010 | 新目标环境 readiness、MANUAL 内部试运行与 Go/No-Go | planned |

每项完整依赖、交付物、测试和验收在 manifest/WBS 中一致。1009 依赖 1003～1008，1010 依赖 1009 及历史 904/905/906；不存在直接或传递 R7/deferred 首发依赖。本任务不授权执行这些任务。

## 实际验证与限制

- 使用已安装环境 `backend/.venv/bin/python .trellis/tasks/10-05-geo-1002-v1-release-scope/evidence/validate.py` 做离线路径/锚点、manifest 和保护检查；精确最终计数与断链列表见 [validation-results.json](./evidence/validation-results.json)。检查全 GEO 文档及本任务正文，当前断链/新增断链为 0，原有 4 个断链已修正。
- Manifest 共 80 项；9 个新增任务字段完整、依赖存在且无环；原 71 项不变；WBS 交付/测试/验收与新 manifest 逐项一致；1002 review、其余 planned，Trellis 未标完成。
- 1350 项受保护文件哈希不变；原 ADR/审计/production-readiness 字节不变。文档包清单由全部当前文件生成，执行 `shasum -a 256 -c SHA256SUMS`，结果记录 [checksum-results.json](./evidence/checksum-results.json) 及 [checksum-check.log](./evidence/checksum-check.log)。
- 按用户要求运行完整 `git diff --check`，退出 2：只有本任务开始前已经存在、未修改的 GEO-1001 审计中 12 处 Markdown 硬换行尾空格。未为使检查变绿而改写审计；完整工作区检查不宣称通过。
- 本次 tracked 文档范围（排除未改的审计）`git diff --check` 退出 0；与保存前态的 `git diff --no-index --check` 覆盖未跟踪文档，退出 1 表示存在差异，输出为空、空白错误为 0。实际命令/原输出/分类见 [diff-check-results.json](./evidence/diff-check-results.json)。
- [独立只读复核](./evidence/independent-review.md) 未发现需修正的文档问题；执行摘要与完整 Bundle 均校验成功。范围是文档一致性与门禁完整性，未以此替代修复测试或生产验证。
- 未执行 `make verify`、业务测试或生产 smoke：本任务没有运行行为变更；同冻结候选完整门禁由 1009、现场验收由 1010 执行。原验证日志不视为新候选证据。

## 最终状态

GEO-1002 已完成授权的文档冻结，提交人工 review；当前 NO-GO 原因、未来任务和发布要求已明确。是否人工接受 1002、批准后续修复/候选/生产阶段由用户后续决定；本次不推定上述批准。
