# R2 人工回答级观测验收（GEO-308）

状态：本地验收完成，`review`，等待人工接受。任务状态以 [task-manifest](./task-manifest.yaml) 为准；只有人工接受后才能成为 `done`。

## 1. 试用范围与入口

R2 支持人工采样、原始回答和引用、受控证据文件、草稿及不可变正式提交。管理员先维护已启用且具备资格的 MANUAL 观测面/采集配置、监测对象、问题变体和计划。工程师进入 `/geo/runs`，选择“创建运行批次”，搜索计划并确认创建，然后在运行列表选择 PENDING 的“人工录入”。

试用环境须按 [配置说明](../../production-configuration.md) 显式启用 `GEO_MONITORING_ENABLED=true` 并让服务重新加载启动配置；API 采集、浏览器采集和机会开关继续关闭。配置文件写入不等于运行进程已加载。本任务只在隔离测试环境观察该配置，不发布或更改生产环境。

录入回答原文、采集时间、截图和引用后，可以保存草稿；服务端草稿在刷新后恢复。提交前确认内容，选择“正式提交人工观测”。成功后以运行详情中的原文、SHA-256、引用实际位置、证据图片和时间线核对；已提交回答不提供原地编辑。失败或 revision 冲突保留本地输入；结果不确定时使用现有同键确认入口，不重复创建新的提交身份。

成功提交停在 `COLLECTED`，回执为 `analysis_dispatch=NOT_IMPLEMENTED`。三次人工采样均提交后，批次 `pending_manual_count=0`、`collected=3`、`completed=0`；未知费用保持未知。分析、复核、指标、机会和自动采集不属于 R2 当前可试用能力。

## 2. 新旧 GEO 兼容

| 入口 | 当前语义 | 验收证据 |
|---|---|---|
| `/geo/runs` / 运行中心 | 独立回答级 Batch/Run、人工录入和不可变原始证据 | 三次采样真实栈 E2E |
| `/geo/observations` / 观测记录 | 现有文章关系观测，包含旧列表筛选 | 导航、旧筛选书签和整页刷新 |
| `/geo/observations/new` | 现有文章观测登记 | 真实截图上传、原记录创建 |
| `/geo/observations/{id}` 与 `/{id}/correct` | 不可变原记录与追加更正链 | 历史节点、tail 列表、原附件保留 |
| `/geo/insights` | 现有文章关系洞察及优化任务来源 | 原统计复算、优化任务不可变来源 |

两个入口共存，不改旧 URL、query schema、query key 或旧指标分母。运行中心数值搜索词按已安装 Router 解析后的状态验收，问题库测试手工导航按 Router 序列化构造URL，JSON 引号编码不视为筛选变化。新 Run 不混入文章观测统计。兼容验收同时核对工作台发现/提及/准确率、更正后列表与历史详情、真实 Insights 和优化任务。

## 3. 并发与不可变证据

| 情形 | 预期结果 | 当前测试 |
|---|---|---|
| 取消存储事务先提交，manual-submit 实际等待 | 409 `INVALID_STATE_TRANSITION`；无回答/提交身份/成功审计 | `test_cancel_commits_before_waiting_submit` |
| 正式提交先持锁，取消存储事务实际等待 | 取消资格 409 `GEO_RUN_ALREADY_STARTED`；仅一次完整提交 | `test_submit_commits_before_waiting_cancel_or_save[cancel]` |
| 正式提交先持锁，保存草稿实际等待 | 保存 409 `INVALID_STATE_TRANSITION`，不重建草稿 | 同上 `[save]` |
| 保存先持锁，旧 revision 提交实际等待 | 409 `REVISION_CONFLICT`，current_revision=1，保留赢家草稿 | `test_saved_revision_commits_before_waiting_submit` |
| 已提交聚合的 SQL 改写/同值更新/删除 | 精确 SQLSTATE `23514` + 具名约束；整笔事务回滚、全行事实不变、原回执重放 | `test_committed_aggregate_attack_rolls_back_entire_transaction`，14 类 |
| 已提交 CANCELLED Run 追加回答或重开 | `ck_geo_answers_submission` / `ck_geo_runs_terminal`，终态与完整聚合不变 | `test_committed_cancelled_run_cannot_accept_late_result`，2 类 |

锁竞争以 `pg_blocking_pids` 观测指定持有者，使用独立 PostgreSQL Session、不同 actor、有界等待和 `finally` 解锁。应用提交沿用 User → 幂等 advisory lock → Surface → Profile → Batch → Run → Draft → UUID 排序文件锁；草稿没有提交幂等锁。Run revision 和草稿 revision 独立维护。

取消目前只有既有策略，没有生产 Application Service / HTTP / UI 命令。取消测试专用 writer 使用 Batch → Run 行锁及现有 `require_cancellable` / `run_transition`；它不代表取消审计、草稿清理、批次缓存刷新或队列恢复已交付。该限制不得被测试通过掩盖。

SQL 反例覆盖 Batch/Run 冻结输入、Answer/Citation、创建幂等身份、主体引用、正式提交身份和被引用文件。测试先做合法业务行更新，再触发非法操作，rollback 后从新 Session 比较完整 JSON 行；详情比较只排除每次读取生成的 `as_of` 与短期签名，数据库事实逐字相等。

## 4. 合同、迁移与安全

GEO-308 不改变 OpenAPI、数据库合同、生产代码、迁移或 ADR；head 仍为 `0051_geo_manual_collection`。现有集成用例继续证明空库前滚、0048 旧文章数据保留、0050/0051 非空原始证据保留、metadata 对齐和不可逆降级的明确停止。没有回填、历史数据修改或生产迁移。

验证使用任务独立 PostgreSQL 16、Redis 和本地 fake-OSS / fake OpenAI-compatible 服务。API/BROWSER Collector 与机会开关关闭；不访问真实外部 AI。角色、CSRF、SSRF、TLS、文件上传者、签名与不可变守卫均保持原实现。工程师 E2E 创建自己的账号并完成真实首次改密，测试密码与会话秘密在产物前登记扫描。

旧上传验收仍要求唯一 PUT、正确来源/路径/CSRF、204 和 VERIFIED；增加签名下载完整字节、长度和 SHA-256 验证。Chromium 不暴露 Blob 的 `postDataBuffer` 不能代表传输失败，实际对象下载是验收依据。

## 5. 实际门禁和追踪

完整命令、退出码、时间、日志和首次失败诊断统一保存于 [实施记录](../../../.trellis/tasks/10-02-geo-308-r2-acceptance/implement.md) 与该任务 `evidence/`。基线后端 1,382、前端 59、人工观测集成 77 项通过；新增 R2 PostgreSQL 定向 20 项通过。后端完整单元2717、前端1121、集成790通过；make e2e与恢复门禁的真实栈26及fixture498通过/54预期跳过，最终专项5通过。首次verify因问题库E2E手工URL丢失数值筛选失败，修正测试后复用输入未变的成功合同/单元/集成，恢复verify退出0；构建、部署脚本、配置和秘密扫描通过。实际命令与复用依据逐项列于实施记录。

Task Brief：[prd.md](../../../.trellis/tasks/10-02-geo-308-r2-acceptance/prd.md)；测试设计：[design.md](../../../.trellis/tasks/10-02-geo-308-r2-acceptance/design.md)。本任务等待人工接受，不提前实施 GEO-401 及后续任务。
