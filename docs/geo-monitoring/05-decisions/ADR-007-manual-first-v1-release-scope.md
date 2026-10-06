# ADR-007：GEO Core V1.0 人工优先发布范围与发布门禁

- 状态：Accepted
- 日期：2026-10-05
- 接受日期：2026-10-05
- 接受依据：用户本次明确要求正式冻结下列 V1.0 范围并新增、接受本 ADR；未提供具名签署人，不补造身份。
- 适用范围：GEO Core V1.0 人工优先发布范围、初始配置、R9A Release Blocker Closure 和 Go/No-Go。
- 替代范围：明确修订现有 PRD 的定时执行、自动 Opportunity 评估和完整页面/导出承诺；延续 ADR-006 对 Browser 的延期。ADR-005/006、R0—R8 接受记录及 GEO-1001 审计保留原文。

## 背景

[GEO-1001 审计](../06-reviews/GEO-1001-release-readiness-audit.md)结论为 NO-GO。MANUAL 回答级观测、确定性分析、复核、指标、现有报告和行动/复测 API 有真实实现；内部批次工厂/evaluator 不证明存在生产 CRON 或自动评估入口，API 组合验收不证明全程页面操作。ADR-006 仅延期 Browser，未裁决其余首发范围冲突。

生产仍接受 Browser=true、Catalog 仍有旧 ADMIN 身份竞态、升级阶段候选 artifact 失败缺少安全恢复。工作区实现尚未冻结为候选，目标生产、正式试运行、监控/容量/恢复证据缺失。缩减产品范围不能豁免这些安全与发布缺口。

## 决策

1. V1.0 支持 MANUAL 回答级观测；人工启动或创建批次；原始回答、引用和证据登记；确定性分析；人工复核；指标、洞察和现有报告；Opportunity 管理员手动评估；现有 Action 和 Retest API；MANUAL 内部试运行。
2. V1.0 不包含 Browser 真实界面 Adapter、Browser 生产会话/证据采集、CRON 到期自动创建批次、Opportunity 自动周期评估、Opportunity CSV、Action/Retest 完整页面操作、公共管理员重分析入口，以及不可观测的“无引用”自动推断。
3. [能力矩阵](../01-product/05-v1-release-capability-matrix.md)区分 available、manual-only、disabled、deferred、not implemented，并单列当前实现。available 只表示仓库已有实现，manual-only 限定人工触发；二者均不代表生产已启用。未实现的手动评估入口必须由 GEO-1006 交付后才可作为正式操作入口。
4. GEO Monitoring 按环境启用；MANUAL 初始试运行启用且不新增独立 MANUAL 开关；API Collection 初始试运行默认关闭。生产必须硬拒绝 Browser Collection 启用，同时核实服务/profile 未启用，且无生产会话/会话材料；模板默认 false 不足以放行。
5. CRON 自动到期执行延期。GEO-1005 的产品澄清：V1.0 拒绝新建、启用和任何 CRON Plan 写命令/首次 run、PLAN 建批及 scheduled 新窗口（409 GEO_PLAN_CRON_UNSUPPORTED），前端仅创建人工计划；历史 CRON 只读保留，不原地停用、不删除、不转为 MANUAL。旧 ACTIVE 只作历史值，服务器与页面投影 UNSUPPORTED_SCHEDULE、无写动作，明确当前版本不调度。历史清点通过只读计数与原审计记录完成，不伪造治理成功审计或执行。MANUAL 人工入口继续可用；已有批次回执只读重放保留。现有 Retest 是人工调用的独立 Batch 命令：从已提交、不可变的基线 Batch 复制严格矩阵，创建 trigger_type=RETEST 的批次。原 plan_id 和 CRON 快照仅作来源追溯，不读取或执行当前 CRON Plan、不改写原计划或快照，不伪装成 SCHEDULED；既有可比性、权限及外发门禁继续裁决。本地实现交付 review，现场同候选验证由 GEO-1010 完成。
6. Opportunity 自动调度关闭；允许管理员显式评估。已有 GEO_OPPORTUNITY_EVALUATION_ENABLED 是评估资格开关，不能当作独立的自动调度开关：MANUAL enable 获批后可设 true，以支持显式评估，但不得登记周期任务或以提交/聚合读请求自动触发。总开关关闭或评估资格关闭时明确拒绝，ENGINEER 不得触发管理员评估。
7. 零引用且缺少可观测依据不等于“确定无引用”。不更改指标分母、current/review 资格、null/UNKNOWN、不可变历史、权限、数据分级、API 外发批准或 at-most-once；内部重分析能力不构成公共入口，分析失败 Run 不因内部重分析成功而回退终态。
8. 增加 R9A 与 GEO-1002～1010，依次闭合范围、安全、能力真实性、升级恢复、候选和现场证据。任务细目及依赖以 [manifest](../04-delivery/task-manifest.yaml) 为准。GEO-1001 是已完成审计输入，不在本轮补造任务接受状态；R0—R8 全部原状态和记录保留。

## 发布条件

[Rollout runbook](../03-technical/10-core-rollout-runbook.md)的 V1.0 Go/No-Go 为执行权威。Go 必须同时满足：GEO-1002～1009 已人工接受；Browser 硬禁止与现场零启用；Catalog 当前身份裁决；CRON 禁用保证；真实管理员评估入口和能力披露；升级 artifact 失败安全恢复；同一固定候选的完整验证；目标生产配置/备份/恢复/容量/监控；正式 MANUAL 闭环和内部试运行；GEO-1010 的业务/运维签署与相应阶段授权。

任何必需项 NOT_MET、NOT_VERIFIED、缺失或未批准都为 NO-GO。R7 延期、首发范围外自动化和未实现页面不构成独立阻断，但不得把它们写成可用。旧任务 done、本地 make verify 成功或本 ADR Accepted 均不能替代发布证据。当前仍为 NO-GO。

## 后果、恢复与后续范围

- 员工负责按 [MANUAL SOP](../02-business/05-manual-geo-observation-sop.md)采样、补证和复核；批次创建不代表平台返回回答，单次变化不构成因果。
- 真实 Browser 按 ADR-006 恢复条件另行排期；CRON、自动 evaluator、Opportunity CSV、完整 Action/Retest UI、公共重分析需后续明确范围、合同和验收，当前无承诺日期或具名责任人。
- R9A 只修复 V1.0 必需边界，不趁机实施上述延期功能。资料或代码变更使冻结范围/候选不再成立时，重新评估受影响门禁；不复用失效证据。
- 本次 GEO-1002 仅修改文档和任务治理，不修改运行时代码、Schema、OpenAPI、部署脚本，不访问生产、不提交/推送。ADR Accepted 与 GEO-1002 review 是不同治理事实。
