# GEO-301 模型边界

根contracts是权威，技术目标草稿冲突按Accepted ADR/GEO-002修订对齐。原文章级观测完全独立。

## 采样与尝试
cell由冻结prompt/profile稳定UUID与repeat_index生成SHA256；batch+cell+attempt唯一，attempt1无previous，后续必须恰好前序+1、同batch/cell/全部输入，前序为FAILED或BUDGET_BLOCKED（ANALYSIS错误不可重新采集）。previous唯一防分叉；旧attempt全行终态冻结。requested_run_count计初始attempt1，创建事务提交检查与实际roots一致；后续attempt不改此字段。初始矩阵提交后禁止再新增root。Batch status/时间/revision是可重建缓存，同批次显式retry允许再投影，终态不可变只约束Run采集/首次工作链，归档报告另行冻结。GEO-302拥有latest-attempt-per-cell的状态投影，无择优答案；GEO-303拥有原子创建与幂等载荷。

## 状态
Run固定PENDING/RUNNING/COLLECTED/ANALYZING/NEEDS_REVIEW/COMPLETED/FAILED/CANCELLED/BUDGET_BLOCKED；Batch固定PLANNED/QUEUED/RUNNING/COMPLETED/PARTIAL/FAILED/CANCELLED/BUDGET_BLOCKED。沿PRD补预算枚举，终态为Run COMPLETED/FAILED/CANCELLED/BUDGET_BLOCKED。重分析只创建AnalysisRevision，不倒退Run；未来当前分析指针由GEO-501另迁移并限定发布字段，301不建不存在实体的FK。GEO-302细化完整合法转换/动作；301数据库保护terminal和SENT/UNKNOWN不回NOT_STARTED，保留NOT_STARTED安全恢复结构但不实现Worker恢复。

## 快照和历史
输入schema_version=1，闭合typed prompt/topic、profile/Surface、subjects/alias/domain、规则revision与明确数据分级，不包含事实正文、AI凭据、Header、Cookie或浏览器路径。快照是当时完整业务输入，不读取当前ORM代替历史。Batch保存计划配置和规则revision，不存采集结果；Answer属于304。Profile/Prompt/Plan/User历史FK RESTRICT，放弃草稿SET NULL/CASCADE以保留稳定身份、快照不可变与已批准保留合同。subjects先保存完整字典快照，真实历史锁存/计数由303接入，不假装已有运行服务。

## 幂等和锁
调度唯一(plan_id,scheduled_for)，不包含revision；schedule_identity仅记录稳定摘要。手动创建和retry Idempotency-Key存储/载荷冲突属于303/命令任务。未来锁序资源→Plan→Batch→Run→后继，按UUID稳定序；数据库run INSERT锁Batch、链父FOR KEY SHARE及unique仲裁，写Batch同值revision建立RR冲突；基线无旧Batch/Run业务调用者。本次不改变Router/事务/审计语义。

## 验证
数据层直接PG反例覆盖终态、输入、初始数量、链身份、唯一与revision/lease/error结构；迁移旧数据逐行比较和metadata覆盖新增两表。Schema双端真实dump验证。所有用户指定完整命令是显式交付门禁，无需以共享文件位置扩大额外验证。
