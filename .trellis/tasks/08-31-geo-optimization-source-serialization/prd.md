# GEO 优化来源串行化

## 1. 背景与问题

Frontend V2 功能合同一致性基线已经确认：`POST /api/v1/geo-insights/optimization-content-tasks` 会在 PostgreSQL 默认 `READ COMMITTED` 下先调用 GEO Insights 权威读模型复算异常和 `basis_snapshot`，之后才通过普通 ContentTask 创建服务取得 `PlatformProfile → Product → FactVersion` 行锁。人工 GEO 观测的新建、更正和删除则先锁 Product；因此两条命令没有在读取 GEO 来源之前共享同一个串行化点。

当前精确 stale 时序如下：

1. 观测事务 B 锁定 Product，写入尚未提交的新观测、新更正链尾或删除链。
2. 优化事务 A 取得其 Idempotency-Key advisory transaction lock，但尚未请求 Product 锁。
3. A 的多条 `READ COMMITTED` 查询看不到 B 的未提交状态，按旧链尾构造旧 basis。
4. B 提交并释放 Product 锁。
5. A 才按 `PlatformProfile → Product → FactVersion` 取得行锁；锁后不再读取或复算 GEO 来源。
6. A 将旧 source identity 与旧 `basis_snapshot` 同新 ContentTask 一起提交；该来源随后不可原地修订。

问题 owner 不是数据库 JSONB 结构，也不是任务与来源的原子提交。人工 GEO 来源集合的既有串行化 owner 是 Product 行，目标资源的既有统一锁序 owner 是内容任务创建服务。

## 2. 唯一目标

消除 GEO optimization ContentTask 创建流程的 stale basis 并发窗口：在 replay miss 后，命令必须先进入既有 `PlatformProfile → Product → FactVersion` 权威锁域，以锁后重新读取的资源状态为准，并在 Product 锁持有期间调用现有 GEO Insights 计算 owner，随后在同一事务内持久化与该线性化状态一致的 ContentTask 和 `ContentTaskGeoSource`。

本 Task 只交付这一项后端一致性修复；一次 review 可以只判断“来源复算是否已经进入既有锁域，以及旧 basis 是否仍可能落库”。

## 3. 功能要求

### R1. 冻结唯一锁序和 owner

- replay miss 后必须按 `PlatformProfile → Product → FactVersion` 顺序取得行锁，不得在 GEO 服务中先单独锁 Product。
- 普通 ContentTask 创建和 GEO optimization 创建必须复用内容任务服务中的同一个目标资源锁定与资格校验 owner。
- Product 锁从首次 GEO 来源读取之前保持到 ContentTask、GEO source 与 basis 一次提交或事务回滚。
- 不新增第二套 advisory lock、Product-first 协议、锁顺序开关或“已锁定”兼容旁路。

### R2. 锁后状态必须新鲜

- `PlatformProfile`、`Product`、`FactVersion` 的锁定查询必须以数据库锁后值为准；不得因 SQLAlchemy identity map 已加载旧实例而继续使用旧的 `is_active`、`status`、正文或归属。
- 平台活动、产品活动、事实已批准且正文非空、事实属于产品等既有门禁保持在共享 owner 中。
- 不通过提高整个 endpoint 隔离级别掩盖锁时点错误；继续使用 PostgreSQL 默认 `READ COMMITTED`，由既有行锁 owner 提供所需串行化。

### R3. 锁内复算和持久化

- GEO 来源复算继续调用唯一的 `get_geo_insights → _content_rankings/_question_coverage` owner，不复制阈值、分母、链尾或完整性规则。
- source identity、typed basis 构造、发布成果归属校验继续由 GEO optimization 命令协调。
- ContentTask 先 flush、GEO source 后写入、二者最终一次 commit 的现有原子边界保持不变。
- 任何异常、冲突或数据库失败都不得留下孤立 ContentTask、`ContentTaskGeoSource`、AuditLog 或其他业务副作用。

### R4. 幂等语义保持

- 同 key、同完整 source+target 的精确 replay 仍在当前洞察复算前直接返回原不可变任务；洞察后来变化不得重写历史 basis。
- 同 key 任一 source 或 target 字段不同，仍在复算前返回 `409 IDEMPOTENCY_CONFLICT`。
- 不改变 `content-task-create:{idempotency_key}` advisory transaction lock 命名域。
- 不在本 Task 处理普通 ContentTask endpoint 与 GEO endpoint 的既有跨 endpoint replay 比较不对称。

### R5. 合同和成功行为保持

- HTTP method/path、请求体、`Idempotency-Key`、CSRF、角色权限、响应 schema、错误 envelope 和 201 成功结果不变。
- `contracts/openapi.yaml`、generated client、数据库表/列/约束和迁移不变。
- 正常无并发创建仍产生一条 ContentTask 和一条 typed、不可变 GEO source；同键精确 replay 仍返回同一任务。
- 当前命令成功、重放及失败均不写 AuditLog；本 Task 不新增审计 action。
- 当资源失效与 GEO 异常失效同时存在时，命令按既有锁域先验证锁后目标状态；这只确定竞态下的线性化结果，不新增兼容错误或前端兜底。

## 4. 验收标准

- [x] AC1：代码中只有一个 `PlatformProfile → Product → FactVersion` 目标资源锁定 owner，普通创建与 GEO optimization replay miss 均复用它。
- [x] AC2：GEO optimization 在首次 `_geo_insight_filter_options`、`_geo_insight_rows` 或其他 GEO source 查询之前已取得三类目标资源锁，Product 锁持续到最终 commit/rollback。
- [x] AC3：锁定查询强制使用锁后数据库值；并发停用 PlatformProfile、停用 Product 或退役 FactVersion 后，等待方不得以 identity map 旧状态创建任务。
- [x] AC4：GEO 规则计算仍只调用现有 `get_geo_insights` owner，没有复制规则、阈值、basis schema、来源验证或锁协议。
- [x] AC5：真实 PostgreSQL 双事务测试确定性交错“观测更正事务持有 Product 锁并写入未提交的新链尾 → 优化命令开始并被该事务阻塞 → 更正提交 → 优化继续”；更正使异常消失时，优化只能返回 `GEO_INSIGHT_STALE`，不得持久化旧 basis。
- [x] AC6：真实 PostgreSQL 资源新鲜度测试覆盖 PlatformProfile、Product、FactVersion 各自被并发锁定并失效；等待方读取提交后的状态并失败，且不创建任务或来源。
- [x] AC7：AC5、AC6、stale、invalid、same-key conflict 和来源写入失败后，相关 ContentTask、`ContentTaskGeoSource`、AuditLog 及其他命令业务行均不增加；任务已 flush 后的失败也必须整体回滚。
- [x] AC8：同 key 同完整 payload 的并发仍恰好产生一个任务和一个来源；同 key 任一 source/target 不同仍在复算前 `IDEMPOTENCY_CONFLICT`。
- [x] AC9：正常成功的 HTTP/API shape、权限、201 响应、source/basis JSON shape、数据库结构和不可变历史语义与当前合同一致；OpenAPI、generated client、frontend、迁移均无 diff。
- [x] AC10：实现只触及共享内容任务锁/构造 owner、GEO optimization 编排及直接相关测试；required validation 全部通过，未通过或未运行项有准确归因。

## 5. 明确排除

- frontend、页面交互或 GEO 页面体验优化。
- OpenAPI、generated client 和 database migration；如实施时发现现有合同确需改变，只报告并停止扩大范围。
- QueryTopic 并发/锁定后续问题。
- 删除对话框、409 UI、非 2xx contract 及其他 Frontend V2 基线子任务。
- 普通与 GEO endpoint 的跨 endpoint 幂等比较不对称。
- `content_task_geo_sources` 当前 DELETE 数据库守卫缺口。
- 发布成果删除协议、修复任务锁序、GEO 语义去重或不同 Idempotency-Key 去重。
- 无关重构、生产数据写入、部署、提交、推送和本规划阶段实施修复。

## 6. Task 与状态约束

- 本 Task 是 `frontend-v2-functional-contract-conformance-baseline` 的独立后续 Task，已获用户批准并以 `in_progress` 进入实施。
- `task.py start` 已在用户批准后运行；完成提交前保持 `in_progress`。
- `v2-live-readonly-acceptance` 保持 `in_progress`，不归档、不修改。
- 父 Task 不归档；现有脏文件、acceptance artifacts 和其他 Task 内容全部保持不动。
