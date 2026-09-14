> 2026-09-07：用户已明确批准最新规划实施。以下 planning-only 文字记录上一轮授权；当前允许按本计划实施与验证，提交/归档/push 仍未授权。

# 技术设计：ContentVersion identity 最终防线

## 状态与权威边界

这是后续实施的候选方案，本轮不执行。继承 PRD 的 AC1–AC12、精确文件边界和依赖；不改变已批准的错误合同。当前静态实现已符合主要控制流，默认先补测试证据，只有失败证据才打开对应生产 owner。

两个唯一约束只作为数据库最终防线；不创建分类器或 HTTP mapper。测试读取结构化 sqlstate/constraint_name 证明命中了正确边界，生产 worker 继续使用自身通用异常失败路径。

## 事务数据流

| 路径 | 现有协调与提交 | 冻结失败结果 |
|---|---|---|
| provider 前 | Job FOR UPDATE；非 PENDING 早返；按 source_job_id lookup | 已有版本时沿用 SUCCEEDED 收敛，不发起 provider |
| provider 执行 | RUNNING/attempt/start/lease 先提交，执行前 context 校验 | 已提交阶段可保留；不修改 provider 请求语义 |
| worker final | 重新锁 Job，确认 RUNNING；锁 Task 后校验和 max+1；flush ContentVersion，再赋 pointer/revision 与 Job success/provider metadata，commit | root rollback；同一 Session 重新加载 Job，只提交 FAILED/GENERATION_FAILED/安全摘要/finished_at/清 lease |
| manual | 锁 Task，校验 OPEN、无主线及有效事实；共享 allocator max+1、flush、pointer/revision、commit | 原 IntegrityError 上抛，由 get_db root rollback，默认 500 |
| revision | 读取 source、锁 Task，复核当前主线/状态/事实；共享 allocator，flush、pointer/revision、commit | 与 manual 相同；不选择另一正文、不改号 |

HTTP root rollback owner 是 `backend/app/db.py:get_db`，本任务只读。测试不得在 route 捕获后主动 rollback 掩盖该 owner 是否生效。

## PostgreSQL 故障与正常并发的证据设计

所有 PG 用例使用既有 temporary_database 工具，迁移到实施 current head，保留真实 constraints/triggers。测试隔离在指定测试文件内，事件监听按目标 Session/Job/Task 精确过滤并 finally 移除；不改全局生产锁。第三方只用现有本地 HTTP provider 替身，明确它并非真实外部模型服务。

### source-job 两种不同情况（AC2–AC3）

1. 复用既有 duplicate worker 测试，保留一次 provider/一个版本/SUCCEEDED 断言；另建 PENDING + 已有 source 版本的合法结构 fixture，直接证明 provider 前 lookup（零调用），不靠修改终态 Job 模拟正常重复投递。
2. 精确 final-flush sentinel：用 blocked fake provider 打开已提交 RUNNING、尚未 final lock 的窗口。在隔离测试里由旁路连接插入并提交同 Job 的 ContentVersion，保持 Task pointer/revision 不动，然后释放 provider。worker 正常 max+1 避免 task/version 同时冲突，真正 INSERT 只撞 source_job_id unique；观察真实 DBAPI 23505 + 精确名称。该 fixture 是旁路异常写入模拟，不声称合法双 worker 会产生此 race。
3. 回滚后只保留预置 competitor，候选版本消失，Job FAILED 不采用 competitor 为 content_version_id；不再 source lookup/replay/provider/dispatch。可用只读查询事件追踪补证不发生 post-error source 回查，不能用 mock error 代替数据库结果。

### task/version 三路径（AC4–AC6）

- manual：创建无当前主线但有合法历史版本的 Task；revision：使用可修订的当前 APPROVED 或 AI DRAFT fixture；worker：使用可执行 Job 与合法历史版本且无当前主线。
- 在目标 Session 的 before_flush 仅将待插入候选 version 改为已存在版本号，其他 lineage/PK/source 保持合法且不冲突；由真实 PostgreSQL 拒绝。明确这是 allocator 失效 sentinel，不是正常并发。
- manual/revision 都经 HTTP 调用真实 service 和生产 get_db；可复用项目最小 FastAPI app 模式，启用现有 AppError handler 与 request context，保持 debug=False。记录异常后原抛，默认 500 不加稳定 schema。
- 正常锁对照不安装改号 hook：每个 allocator owner 作为等待方，在另一独立 Session 持有同一 Task FOR UPDATE 时启动命令。使用 event/barrier、有界 timeout 和 pg_stat_activity/pg_blocking_pids 证明等待，释放锁后验证 max+1；增加两个合法命令竞争同一主线的对照，后到者依据现有 CONTENT_MAINLINE_EXISTS/CONTENT_VERSION_NOT_CURRENT 或 worker 主线门禁拒绝。不能要求两个首稿都成功；不能通过在已持 Task 锁后 barrier 等待另一 allocator 来制造死锁。

### 晚期事务失败对照（AC6–AC8）

首次 ContentVersion flush 发生在 pointer/revision/success metadata 赋值前，其失败断言不能单独证明这些已赋值状态会回滚。因此每个 HTTP owner 与 worker 至少有提交前晚期故障对照：目标 before_commit hook 先真实 flush 所有候选状态，再在同一 transaction 用参数绑定 INSERT 触发精确 identity unique violation，原异常继续沿真实失败边界传播。worker 此时应已暂存全部非空 provider metadata，并通过独立连接最终确认其全部恢复到基线。hook 一次性、仅目标 final transaction 生效，不拦截 RUNNING 或 FAILED 的 commit；不把它描述成正常 final INSERT race，不改数据库约束为 deferred。

比较基线须包含候选 ID、全部版本 ID/载荷/revision、Task pointer/revision、Job content_version_id/status/provider_request_id/response_duration_ms/prompt_tokens/completion_tokens/total_tokens、review/audit 行集合与 dispatch 次数。finished_at 区分 rollback 的 success 值和失败事务新值。使用非空 provider 返回元数据，避免全 None 断言虚假覆盖。

### Session、HTTP 与对照

- 给测试 Session 加最小 rollback 观察：调用真实 super().rollback() 后、close 前，用该 Session 查询并记录成功；随后正常关闭。worker 也必须记录实际执行者 Session 的身份和可查询证据，另用独立连接检查持久化结果。
- 每个 unknown HTTP 检查 status=500、非 REVISION_CONFLICT，以及正文/头无 SQL、content_versions、精确 constraint、实际 DB message 和 traceback 信息；不规定默认500 body文案、media type或 request ID。
- expected_revision 对照使用真实 update_content_draft 请求，先保存使 revision 增长，再用旧 revision 返回既有409/ErrorEnvelope；与 allocator 错误注入完全隔离。

## 文档、兼容与回退

无公共 API、数据库结构、前端或 provider 行为变化，因此 contracts、router、generated、业务动作文档和 migration 保持零 diff。必要新增稳定知识只进入两个已允许 backend specs，避免重复维护合同矩阵。

若需生产修正，只修改失败的 authoritative owner，并保留既有 GENERATE/HUMANIZE、资格/状态门禁。不抽取 allocator 框架，不调整锁序以满足测试。回退以本任务允许文件中的候选 diff 为单位；不得 reset/stash/覆盖无关工作。catalog 不符或需要扩展零 diff 文件时返回决策，不在本任务迁移 schema。
