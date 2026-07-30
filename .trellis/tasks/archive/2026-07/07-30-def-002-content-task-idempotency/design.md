# DEF-002 技术设计

## 核心不变量

一次由 `Idempotency-Key` 标识的普通内容任务创建意图，最多持久化一条 `ContentTask` 和一条成功审计；同键只能描述同一三字段载荷。不同键表示不同创建意图，即使业务输入相同也允许创建。

## 数据流与接口

1. 创建弹窗打开时生成一个 UUID 键；弹窗保持打开以及失败重试期间复用，关闭后再次打开才生成新键。
2. `POST /api/v1/content-tasks` 同时提交现有 body、CSRF 和必填 `Idempotency-Key`。
3. FastAPI 继续先执行会话、工程师角色和 CSRF 依赖，再把 8–128 字符 Header 传给内容规划服务。
4. 服务对命名后的键获取事务 advisory lock，读取 `content_tasks.idempotency_key`：
   - 已存在且三字段相同：直接返回原任务，不重新校验当前平台/事实状态，不追加审计。
   - 已存在但任一字段不同：抛出 `409 IDEMPOTENCY_CONFLICT`。
   - 不存在：执行现有平台、事实、产品校验，插入带键任务和一条审计后提交。
5. 数据库唯一约束保证任何非空幂等键最多属于一个任务；列表和响应不暴露该内部字段。

## 数据库与迁移

- 新增 `0032_content_task_idempotency`，在 `content_tasks` 增加可空 `VARCHAR(128) idempotency_key` 和命名唯一约束。
- 不回填历史任务：它们没有真实客户端请求键，伪造键没有业务价值。
- 发布修复任务继续由唯一 `source_publication_attention_id` 防重并保持 `idempotency_key=NULL`；本任务不改变其 API。
- downgrade 只删除唯一约束和新增列，不删除或改写任务。代码回滚必须与数据库 downgrade 配套，因为旧代码不发送 Header。

## 合同与兼容

- OpenAPI 创建任务端点引用现有 `IdempotencyKey` 参数，`201` 描述改为“已创建或返回幂等任务”，保留 `409`。
- `ContentTaskCreate` body 和 `ContentTask` response 不变，幂等键不进入响应或生成的业务类型。
- 这是有意的立即收紧：未传或长度非法 Header 返回 `422`，不增加可选键兼容路径。
- 同键同载荷重放保持 `201`，与现有创建接口和人工发布的重放方式一致。

## 并发、权限与审计

- advisory lock 使用内容任务命名空间，避免与其他端点偶然使用相同字符串时产生无关阻塞；PostgreSQL 是唯一业务状态来源。
- 唯一约束是并发兜底，服务的同键载荷比较是冲突语义所有者。
- 权限和 CSRF 依赖位置不变；重放不会绕过路由授权。
- 只有首次插入写 `content_task.created`；重放返回原任务，不伪造第二次成功业务事件。

## 受影响文件

- 合同与设计：`contracts/openapi.yaml`、`contracts/database.md`、`docs/GEO多平台内容运营系统方案设计.md`、`docs/GEO系统前后端技术与部署方案.md`。
- 后端：新 Alembic revision、`backend/app/models/content.py`、`backend/app/routers/planning.py`、`backend/app/services/content_planning.py`。
- 前端：生成的 `frontend/src/shared/api/schema.d.ts`、`frontend/src/features/content-tasks/ContentTasksPage.tsx` 及其组件测试。
- 验证：`backend/tests/integration/test_migrations.py`、`backend/tests/integration/test_publication_review_closure.py`。
- 不修改当前已脏的 `docs/deployed-full-functional-acceptance-plan.md`：其 R08/W6 已经表达防重要求；不修改任何 `artifacts/`。

## 风险与回滚

- 风险：旧客户端升级后缺少 Header 会收到 `422`；这是已确认的合同收紧，前后端必须同版本部署。
- 风险：锁顺序不一致可能造成等待；实现固定先取幂等 advisory lock，再进入现有平台行锁路径，并用并发测试验证。
- 风险：错误地使用三字段唯一约束会阻断合法重复任务；测试明确证明不同键同载荷仍可创建。
- 回滚：先回滚前后端到旧版本，再执行 Alembic downgrade；回滚会失去已记录键，但不会删除任务。若仅应用回滚而保留新增可空列，旧代码仍可运行，但不再提供幂等保证。
