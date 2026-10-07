# GEO-1010 治理设计

## 决策与权威边界

本设计只描述任务组织、交付归属和证据门禁，依据[ADR-008](../../../docs/geo-monitoring/05-decisions/ADR-008-manual-pilot-ui-first-delivery-and-candidate-ownership.md)。不更改业务状态机、API、数据库、部署状态所有者或任务系统实现。原 ADR-006/007、GEO-1009 失败/成功历史及 GEO-904/905/906 的现场未知保持。

manifest 顶层 GEO-1010 是聚合任务，其 children 是稳定仓库相对路径。Trellis 原生 parent/children 保存目录名、双向一致；子任务 meta.display_id 供人阅读，meta.dependencies 保存独立验收依赖。依赖图只包含前置任务，不把 children 反向作为父任务依赖，避免构造父子循环。父任务 review 条件以三个 children done 及集成工作验收另行裁决。

仓库没有独立 task.json JSON Schema 或通用 task-manifest validator；TaskData 是只读类型声明，task_store.create 提供写入初值，task.py validate 检查 JSONL 上下文。治理校验从这些现有字段/nullable 初值派生离线 JSON Schema，不注册新 schema 或扩大任务系统。顶层编号继续 GEO-数字；保留既有根字段和全部其他任务行。

## 子任务所有权与交接

| 所有者 | 输入 | 输出与接收门禁 |
|---|---|---|
| UI | 已接受的 evaluator、Action、Retest API、available_actions 和不可变历史 | 最小页面闭环、类型/组件/真实栈证据及人工接受；不重写服务端规则 |
| DEPLOY | UI done 后的 clean pushed main、目标/阶段授权、真实身份及恢复材料 | 同候选 archive/images/manifest/schema/hash、完整门禁、内部 readiness/smoke/停止恢复，人工接受后交 UAT |
| UAT | 已接受且绑定候选的内部环境、获批真实样本/人员 | 流程/性能/反馈/缺陷任务、具名内部 Go/No-Go 与人工接受 |
| 父任务 | 三个子任务的独立接受和集成工作验收 | 先 review，另有人工接受才 done；不代签生产 Go |

GEO-1009 的成功 SHA `e5949ab66989c1277424cfe9ab8b93e10ce10046` 只证明该版本完整门禁。接受治理提交与本规划提交有各自 Git 身份，不能冒称执行过完整门禁。DEPLOY 在 UI done 后选定新的固定 main；所有候选证据绑同一个实际 SHA，不拿旧版本成功覆盖 UI 变化。工件尚未生成、恢复输入尚未批准或目标未知时保持未知，不填假 digest/namespace/账号。

## 状态和失败边界

父任务 ready → 任一子任务实际开始后 in_progress → 三项 done＋集成工作验收后 review → 显式人工接受后 done。本次只设置 ready/planned，不运行 task start，不自动激活、归档或跳过人工接受。

UI 的接口不匹配、权限/幂等/revision/比较失败通过现有服务端合同显式处理；领域规则缺口另行明确。DEPLOY 缺授权、候选身份、恢复路径或 readiness 不通过时停止对应阶段，沿既有 runbook 保持维护隔离，不手改发布状态、不 downgrade。UAT 发现代码问题另建缺陷任务；新候选通过修复接受和获批部署后再验证受影响流程，旧结果保留身份，不静默改阈值或样本分母。

Scheduler 保留现有分析/lease 恢复、PENDING 补投递、retention dry-run 及既有应用恢复/清理；关闭业务 CRON 和周期 evaluator。API/Browser 自动采集关闭；MANUAL 人工观测与管理员显式评估按获批内部范围执行。

## 独立验收与证据

每个 implement.md 初始化为未开始模板；实际命令、结果、候选/环境/时间、操作者、缺口和人工接受仅在执行后填写。UI 关键动作必须用页面；DEPLOY 本地检查不代替现场；UAT 页面耗时不代替 API 时间，实测及具名调整完整保存。

治理规划只离线核对 YAML、ID/依赖无环、双向父子、Trellis 字段、链接、文档哈希、diff 与受保护路径。不重跑已接受应用门禁，不启动环境。子任务 brief 为独立范围/验收权威；本设计不复制 UI 组件设计或部署 runbook。
