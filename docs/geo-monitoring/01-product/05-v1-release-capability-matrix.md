# GEO Core V1.0 发布能力矩阵

- 冻结日期：2026-10-05
- 范围依据：[Accepted ADR-007](../05-decisions/ADR-007-manual-first-v1-release-scope.md)
- 实现证据：[GEO-1001 审计](../06-reviews/GEO-1001-release-readiness-audit.md)
- 发布结论：**NO-GO**；以下政策不证明运行配置、修复或生产启用已完成。

## 状态含义

| 状态 | 含义 |
|---|---|
| available | 仓库已有可用实现；具体公开 API、页面和本地验证边界须明确，生产仍受发布门禁约束 |
| manual-only | V1.0 只允许人工采集、触发或显式操作；生产入口是否已经存在另列，不暗示自动调度 |
| disabled | V1.0 初始发布配置关闭，或 V1.0/production 明确禁止；关闭策略与硬禁止实现分别核实 |
| deferred | 本版本范围之外，后续需重新排期与验收；不是 done，也不承诺版本或日期 |
| not implemented | 指定公开入口或操作目前没有实现，不能以内部服务、测试 seed 或占位代替 |

同一业务能力可拆成“执行方式”“公开入口”“后续自动化”分别分类，避免一个 available 掩盖其他缺口。以下是当前首发承诺与当前实现的唯一能力矩阵；PRD 和 runbook 引用本表，旧阶段记录只作历史。

## 能力矩阵

| 能力/边界 | V1.0 状态 | 当前实现与证据边界 | 后续任务/发布条件 |
|---|---|---|---|
| MANUAL 回答级观测 | manual-only | 真实 Batch/Run→Answer/Citation/Evidence 链路已实现 | 按 SOP；GEO-1010 正式环境验收 |
| 人工启动计划/创建观测批次 | manual-only | 人工批次工厂、公开命令、运行中心已实现 | 明确人工触发；GEO-1005/1010 |
| 原始回答、引用和证据登记 | manual-only | 草稿、原子提交、受控文件和不可变原始证据已实现 | 引用来自实际观测，未知不猜测 |
| 确定性分析 | available | Worker 扫描/补投递及追加 AnalysisRevision 已接线 | 不因遗留回执 NOT_IMPLEMENTED 字段误判缺失 |
| 人工复核 | available | confirm/correct、追加历史、当前有效结果已实现 | 严重错误/歧义保持复核门禁 |
| 指标与洞察 | available | 回答级 Overview、趋势、SOV、引用、风险/质量及下钻已实现 | 分母零 null、失败排除、模式/环境不混算 |
| 现有报告 | available | 现有打印及 runs/citations/claims CSV 已实现 | CSV 权限、低敏、注入边界保持；GEO-1007/1010 |
| Opportunity 管理员显式评估方式 | manual-only | GEO-1006 受 CSRF 保护的 ADMIN API 复用现有 evaluator，显式范围/窗口/revision/幂等键，无自动 Action/Retest | 实现/本地验证已接受；现场获批后由管理员执行，操作见 Runbook §4.1 |
| Opportunity 管理员生产评估入口 | available | POST /api/v1/geo/opportunities/evaluate；真实 HTTP/PostgreSQL 验证 ADMIN、CSRF、ENGINEER 拒绝、冻结回执/原子审计及幂等；没有操作页面 | GEO-1006 实现已接受；0066 正式候选前滚及 GEO-1010 同候选现场验收尚未执行 |
| Opportunity 列表/详情、确认/忽略 | available | 现有工作台与服务端状态/证据已实现 | 机会需显式评估产生；保持来源历史 |
| 现有 Action API | available | 事实/内容/发布/补测应用服务协调及公共 API 已实现 | 人工调用；AI 仅草稿；GEO-1007/1010 |
| 现有 Retest API 与比较/解决 | available | preview/create、冻结基线、可比性门禁及显式解决已实现 | 不可比/未知版本阻断；不承诺因果；可复现的历史基线即使来自 CRON，人工 RETEST 仍按冻结矩阵执行，保留来源且不运行当前 Plan |
| MANUAL 内部试运行 | manual-only | 本地真实栈有证据，生产试用未执行 | GEO-1010；负责人、范围、时长、反馈需签署 |
| API Collection 初始试运行 | disabled | 采集/Worker/发送恢复已有实现，生产供应商批准与验收未取得 | 默认 false；后续启用需单独批准与验收 |
| Browser production Collection/会话 | disabled | GEO-1003 已实现 Settings/预检/部署入口硬拒绝 true 和会话材料；production Compose 无 Browser；实现已接受，现场未知 | GEO-1003 实现已接受＋GEO-1010 零启用/零材料证据 |
| Browser 真实界面 Adapter/生产证据采集 | deferred | GEO-804～807 延期；真实 Adapter/证据路径未实现 | ADR-006；801～803 done 保留 |
| CRON Plan 创建/启用及到期建批 | disabled | GEO-1005：CRON Plan 写命令/首次 run、PLAN 建批及 scheduled 新窗口均 409 GEO_PLAN_CRON_UNSUPPORTED；历史仅 UNSUPPORTED_SCHEDULE 只读，无写动作；Beat 无到期入口 | 实现/本地验证已接受；GEO-1010 核实同候选与现场历史披露，不原地停用/删除 |
| CRON 生产自动调度交付 | deferred | not implemented：无生产到期入口 | 后续重新排期；V1.0 不以自动执行为门禁 |
| Opportunity 自动调度 | disabled | 开关是评估资格，不证明自动调度；当前无生产周期入口 | GEO-1006/1007 保持无周期/隐式触发 |
| Opportunity 自动周期评估交付 | deferred | not implemented：没有周期注册；管理员显式 API 不代表自动调度 | 后续重新排期；V1.0 不以周期执行为门禁 |
| Opportunity CSV | not implemented | 当前固定 501，三类已有 CSV 不受影响 | 首发之外；GEO-1007 明确不可用，不伪装空导出 |
| Action/Retest 完整页面操作 | not implemented | 现有 API 可用，完整创建 action、retest preview/create UI 未交付 | 首发之外；明确页面与 API 组合操作边界 |
| 公共管理员重分析入口 | not implemented | 内部可追加 revision，无生产公共 Router/CLI 操作入口 | 首发之外；不回退 FAILED Run，不承诺指标资格恢复 |
| Overview/报告机会整合、Run Detail 指标资格占位 | not implemented | 开放机会等仍占位；详情资格字段不能代替洞察权威计算 | 首发不承诺完整整合；GEO-1007 披露边界 |
| 不可观测的“无引用”自动推断 | disabled | citation_absence_observable=False；零引用不能证明引用丢失 | 保持 UNKNOWN/不适用，不触发无依据自动机会 |

## 初始发布配置

| 项目 | prepare/expand/deploy | 获批 MANUAL enable/试运行 | 当前保证 |
|---|---|---|---|
| GEO_MONITORING_ENABLED | false | 按环境批准设 true | API/Worker/Beat 启动后核对实际值 |
| MANUAL Collection | 随总开关不开放新写入 | 启用；没有独立 MANUAL 环境键 | 人工采集/创建，确定性分析和复核继续执行 |
| GEO_API_COLLECTION_ENABLED | false | false（初始默认） | 保留已有代码，不自动回退到 API |
| GEO_BROWSER_COLLECTION_ENABLED | false | production **硬禁止 true** | GEO-1003 实现/本地验证已接受；现场 GEO-1010 |
| CRON Plan | 禁止新建和启用 | 全部历史 CRON Plan 只读，不能从当前 Plan 建批 | GEO-1005 已实现；旧 ACTIVE 原值保留但投影明确不支持；不新增存储状态 |
| GEO_OPPORTUNITY_EVALUATION_ENABLED | false | 显式评估获批时 true | 这是资格开关；GEO-1006 管理员显式 API 实现已接受，现场启用另需批准 |
| Opportunity 自动调度 | 无周期注册/隐式触发 | 关闭 | 不虚构新的已实现环境键；保持人工评估与自动调度分开 |

GEO_RETENTION_DRY_RUN=true、CELERY_CONCURRENCY=1 及既有数据/外发/备份安全条件按 runbook 保留。当前 production readiness 原文为 NOT_STARTED/NOT_VERIFIED，GEO-1002 不将策略值写成已观测事实。
