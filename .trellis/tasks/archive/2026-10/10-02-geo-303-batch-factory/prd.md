# GEO-303 Task Brief：批次工厂、计划快照和创建幂等

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID | GEO-303 |
| 发布增量 | R2 |
| 状态 | done（manifest）/ completed（Trellis）；2026-10-02 本会话用户人工审查并接受实现与测试证据 |
| 负责人 | Codex 主代理 |
| 依赖 | GEO-302、GEO-207，清单与人工验收记录均为 done |
| 分支 | geo/GEO-303（当前分支）；无提交或外部写入授权需求 |
| 关联 PR/Commit | 无 |

## 2. 目标

系统从计划或临时完整配置生成不可变执行快照，原子创建一个 Batch 与全部根 Runs，并通过持久化身份保证手工重放和调度窗口不会重复创建。配置后续变化不影响已提交批次。

## 3. 关联需求

GEO-303 WBS/manifest deliverables 与 acceptance；计划执行矩阵、回答级运行及历史配置冻结合同。

## 4. 必读文档

已读取用户列出的 README、delivery 01/02/04/05/manifest、product 02/03、business 02/03、technical 01/02/03/04/05/07、Accepted ADR-001/002/003；根/后端/前端 AGENTS、Trellis workflow/backend spec、GEO-207/301/302 task 记录；根 OpenAPI/数据库相关权威单元、0045–0048 迁移及锁/资格/矩阵/快照/计划 API 和测试。大型合同按结构与完整相关单元读取。

## 5. 当前行为

已有纯矩阵展开、资格预览、0048 Batch/Run 不可变与延迟完整性约束。计划 run-now 为 501，无工厂或创建幂等。R1 页面保持配置与预览，不提供运行交互。无回答级 Worker。基线单元 95 passed，PostgreSQL 集成 36 passed，命令及日志在 evidence/。

## 6. 目标行为

首次请求冻结计划、规则、prompt/topic、profile/surface、主体及活动字典；创建 requested_run_count 个根 Runs。手工同用户同键同规范请求返回同一创建回执，异载荷 409；调度按 plan+UTC window 唯一，revision 不进入身份。返回已提交创建回执，不依赖以后批次状态。

## 7. 范围内

- 应用服务事务、资格重验与完整快照；计划及临时创建 HTTP 边界。
- 手工幂等持久化、调度内部工厂、批次主体历史引用及必要删除保护。
- 增量迁移、根合同、generated 类型、创建审计、定向 PostgreSQL 测试。

## 8. 范围外

GEO-305/306/405/705；Collector 接入、派发/执行/采集/分析/指标/机会/重测；批次读模型和页面、调度循环、无关重构或升级依赖。

## 9. 业务不变量

1. PostgreSQL 唯一状态源；创建成功前事务不提交任何部分。
2. requested_run_count 等于全部根 Runs；输入快照不加载秘密，费用未知保持 null。
3. 复用既有状态与 revision；PLANNED 插入后 QUEUED/revision=1，Runs PENDING/revision=0。
4. 身份重放不受后续配置修改影响；首次创建锁内重验资格。
5. 不调用外部服务，不使用 Redis，不实现 RETEST。

## 10. 契约变化

OpenAPI：计划 run-now 与 observation-batches POST 返回稳定创建回执，required Idempotency-Key；临时请求为闭合判别联合，拒绝客户端 actor/status/snapshot/schedule 字段。错误复用 REVISION_CONFLICT、IDEMPOTENCY_CONFLICT、GEO_PLAN_*。

Database：0049_geo_batch_creation 增加 geo_batch_creation_requests（哈希身份/请求摘要/Batch FK）、geo_batch_subjects（主体/角色历史 FK）。既有快照回填主体引用，不修改历史；不可变触发器与新批次引用完整性延迟守卫。FK RESTRICT；禁止破坏性降级，前向修复。

## 11. 后端实现

Router 仅认证、CSRF、schema、调用应用服务。Service 手工锁序 User→创建身份 advisory transaction lock→AI/产品/品牌/主体/Topic/Prompt/Surface/Profile→Plan→新 Batch→Runs；调度省略 User。READ COMMITTED 锁后读取。幂等回执优先；首次计划创建检查 expected_revision 和非 ARCHIVED；调度仅 ACTIVE+CRON。成功审计与批次同事务，重放不追加成功审计；系统创建通过 Batch 来源记录，不伪造 actor。仅按精确 SQLSTATE/约束名映射冲突。

## 12. 前端实现

仅生成公共类型；不新增路由/query key/URL 状态/运行 UI。R1 页面运行占位明确留到后续页面任务。

## 13. 测试计划

Unit/Contract：闭合输入、创建身份规范化、运行时/根合同一致。
PostgreSQL：计划/临时冻结；同键并发和异载荷；调度同窗口跨 revision；1000 runs；插入中途、审计失败/完整性失败全回滚；停用/修订/引用保护；0048 非空前滚与 metadata 对齐。
Security：角色、CSRF、未知字段拒绝；安全快照/审计不带凭据。无真实 AI。
Frontend/E2E：无新增用户页面，generated 类型通过 typecheck；不新增 E2E。

## 14. 验收标准

1. 任一成功创建回执的 requested_run_count 与数据库根 Runs 一致，包含1000边界。
2. 同一手工身份并发返回一个 batch；不同请求冲突；调度同窗口不受 revision 变化影响。
3. 提交后的 Plan/Profile/Prompt 与主体字典变更不改变历史快照。
4. 任一创建阶段失败没有 Batch/Run/幂等/引用/成功审计或首次引用锁存部分提交。

## 15. 验证命令

`git diff --check`、`make contract-check`、`make lint`、`make typecheck`、`make test-unit`、`make test-integration`，及明确记录的定向 pytest。隔离 compose 覆盖 COMPOSE make 变量，避免碰触用户开发数据库。

## 16. 数据和上线

0048→0049 增量前滚；回填既有快照主体引用，引用缺失明确失败且迁移原子。先迁移再部署工厂；不引入运行开关或兼容双写。历史表不可安全降级，保留历史并前向修复。创建工厂不派发，后续 GEO-305 接入稳定 IDs。

## 17. 风险与开放问题

| 风险 | 处理 |
|---|---|
| 并发修改资格/身份 | 复用全资源锁协议与锁后事实读取 |
| 历史资源被删除 | RESTRICT 关系、Prompt/Surface 首次引用锁存及真实引用投影 |
| 快照分类 | 工厂明确定为 INTERNAL，不赋予外发授权；无 Product 事实正文 |
| 1000次创建成本/部分提交 | 批量快照查询、分块插入，数据库延迟完整性+单次提交 |
| 高后果边界 | 候选完成后独立只读 critical_reviewer 复核 |

停止条件严格采用用户列出的五类，不自行扩展。

## 18. 完成证据

evidence/start-files.json 与 baseline/ 保存任务起点；baseline-unit.log（95 passed）、baseline-integration.log（36 passed）。最终实现、验证、迁移与独立复核证据见 implement.md；无 PR/Commit。

## 19. 后续任务

GEO-304 回答证据、GEO-305 派发、GEO-306 批次读模型/API、GEO-307 运行页面、GEO-405/GEO-705；本任务不实施。
