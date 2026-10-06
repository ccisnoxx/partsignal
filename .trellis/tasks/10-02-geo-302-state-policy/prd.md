# GEO-302 Task Brief

## 1. 基本信息
GEO-302 / R2；负责人主代理；当前分支 geo/GEO-302；依赖 GEO-301 在 manifest 为 done，Trellis 为 completed，且包含2026-10-02用户人工接受记录。状态经历 planned→in_progress→review；2026-10-02本会话用户已人工审查并接受实现与测试证据，manifest=done、Trellis=completed。本次只记录验收，不提交/部署/归档，不实施后续任务。

## 2. 目标
服务端统一裁决回答级 Run 合法转换、Batch 状态、retry/cancel资格和 typed workflow/actions，前端消费投影无需复制状态机。

## 3. 关联需求
WBS GEO-302完整任务行；CAP-GEO-05；AC-BATCH-01/02、AC-RUN-05/06、AC-SEC-02；Accepted ADR-001/002/003及GEO-301已接受的cell/attempt、终态与Batch缓存合同。

## 4. 必读文档
已读根/backend/frontend AGENTS、Trellis workflow/spec、GEO-301 task.json/prd/design/implement。用户指定README、路线图、WBS、执行指南、任务模板、manifest、PRD、页面规格、领域模型/状态机、技术/数据/API/前端/Worker/测试文档、ADR-001/002/003；大型PRD/OpenAPI读取相关完整维护单元。当前0048 ORM/Schema/迁移/守卫及相关测试已核对。

## 5. 当前行为
0048已建立Batch/Run和输入/身份/终态/attempt/revision/lease最终防线；无状态策略/动作。Plan run-now501，无Batch/Run HTTP执行入口、工厂、答案或Worker。旧GeoObservation独立。大量前序dirty work保留，起点副本与hash清单在evidence/baseline和start-files.json。

## 6. 目标行为
纯策略表达全部合法边，非法/重复/终态转换稳定409。人工PENDING提交到COLLECTED；自动模式先RUNNING，恢复仅允许过期撤销lease且NOT_STARTED。retry是采集失败追加attempt资格，不是状态回退；分析失败不能重采集。Batch按每cell最新attempt确定性投影，成功/混合/无成功预算/失败/全取消互斥；非终态优先。workflow字段全部required、typed，无隐式默认。

## 7. 范围内
Run纯策略/守卫、Batch完整集合投影、retry/cancel资格；独立workflow公共组件、generated类型；表驱动/合同测试、必要权威文档、指定门禁和独立复核。

## 8. 范围外
GEO-303工厂/原子创建/幂等键、304答案/引用/证据、305人工草稿提交、306读API、307页面、401+Collector/Worker、分析/复核执行、指标/机会、旧GeoObservation迁移与真实外部调用。

## 9. 业务不变量
PostgreSQL唯一事实源；Run终态不退，输入不变；重试同cell追加不改原Run；Batch缓存可由最新attempt重建，不能从分页子集重建；cancel仅未开始。Redis仍只传稳定ID；策略无数据库/网络副作用。

## 10. 契约变化
OpenAPI只新增独立GeoRunWorkflowProjection/GeoBatchWorkflowProjection及各自闭合token；无endpoint，GEO-301基础Out不变。数据库文档补策略与现有约束衔接；无表/列/约束/索引变化，无Alembic revision，head保持0048，无数据回填/历史迁移。

## 11. 后端实现
services/geo_run_policy.py拥有Run边/资格；geo_batch_policy.py拥有完整集合latest-attempt投影。调用方显式提供当前非敏感事实、操作者及真实命令可用性；读投影不是授权。无Router/ORM写入，锁/revision/事务/审计在后续Application Service；沿已有资源→Plan→Batch→Run稳定顺序，旧DB终态与唯一后继最终仲裁保留。

## 12. 前端实现
仅重生成schema.d.ts，无route/query key/URL/UI变化。未来消费stage/primary_task/actions，不能从status/分页推导资格。当前无可运行的新HTTP旅程。

## 13. 测试计划
基线定向unit95/隔离PG集成31通过。新增所有9×9×3状态边、上下文守卫/恢复、四终态、retry/cancel、角色/资格/命令可用性、729种Batch组合及latest-attempt/空集/缺cell/重复attempt/漏后继、标准OpenAPI真实dump正反例，最终1355定向通过。用户最低门禁与contract-check全部实际通过。

## 14. 验收标准
任意终态目标回退/自转换均409；已发送/UNKNOWN不能恢复；人工不会伪装自动采集；分析失败不投影采集retry；单后继不可重试；Batch不以历史成功择优、不将旧失败当额外cell；typed动作与同一守卫一致。

## 15. 验证命令
精确日志留evidence：git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration（本task专用Compose）；uv run --project backend pytest定向；隔离alembic upgrade head验证现有0048。

## 16. 数据和上线
无新配置/开关/生产操作；纯策略尚无HTTP接线。隔离PG16/Redis/fakeOSS，收尾清理geo302专用project/volumes，恢复Colima停止/default。源码回退不涉及数据。

## 17. 风险与开放问题
已接受GEO-301明确Run终态冻结、Batch可因新attempt重投影，不存在需要改ADR的冲突。新增策略必须不假装后续命令已上线；Worker锁/lease真实性由后续接线保证。仅用户五项停止条件可blocked；环境失败记录限制。

## 18. 完成证据
基线95单元/31集成；最终1355定向、2636后端单元/1067前端单元、656集成以及contract/lint/type/diff全部通过。独立复核1项P2已先红后绿修复并复核，无未解决confirmed finding；digest/audit-verify通过。精确命令、迁移前滚、限制、增量diff和环境恢复见implement.md/evidence。

## 19. 后续任务
GEO-303、GEO-304、GEO-305、GEO-306及其后续按manifest进入；本次不实现。
