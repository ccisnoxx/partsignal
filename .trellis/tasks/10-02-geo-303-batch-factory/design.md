# GEO-303 创建边界设计

创建服务是唯一事务 owner。共享配置仅在既有资源锁协议下读取；矩阵与资格复用 GEO-207，不新增费用或状态规则。快照模块批量读取安全列并显式转为 GEO-301 闭合快照，使用 registry 中已确认的 adapter_version。Prompt 与 Surface 首次引用锁存在同一事务内完成，快照保存锁存后的 revision。主体历史通过每 Batch 一组关系保护，避免1000次重复关联；完整性触发器与计划快照主体集合一致。

手工身份是 SHA256(固定命名空间 + actor UUID + 可见 ASCII key)，不保存原 key。请求摘要对命令来源与集合规范化后的完整输入计算，计划请求包含 plan UUID 和 expected_revision。一个身份只保存一个 batch 回执；鉴权始终先执行，再重放；重放跳过已变更的配置资格。

调度身份是 SHA256(plan UUID + UTC scheduled_for 固定微秒格式)，不含 revision。仅内部服务允许 SCHEDULED，必须 aware 时间；同窗口重放原批次，首次只允许 ACTIVE+CRON。工厂不计算下个窗口、不派发、不重试未知失败。

数据库先插入 PLANNED/revision0 Batch，再插入所有根 PENDING Runs 与主体链接，最后更新 QUEUED/revision1并提交；延迟约束确认请求数量和引用完整性。Run 输入复用 prompt×profile 单元快照，不乘主体数量；每根 repeat_index 1..repeat_count。创建回执仅 batch_id/requested_run_count/created_at，不包含可变状态。

0049 对既有快照回填主体关联且保持 Batch/Run JSON 原样。缺失引用触发真实 FK 失败，不忽略历史。守卫禁止关系和幂等回执 UPDATE/DELETE，禁止批次提交时遗漏选择的主体。Alembic 不导入运行时 metadata，降级安全停止。
