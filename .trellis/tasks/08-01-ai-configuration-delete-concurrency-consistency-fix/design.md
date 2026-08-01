# AI 配置删除并发一致性修复：技术设计

## 1. 设计结论

复用 `ai_configuration.py` 已有的 SQLAlchemy `select(...).with_for_update()` 模式，在两个删除命令的目标读取处建立 PostgreSQL 行锁。锁、存在性判断、成功审计、业务副作用和提交仍位于同一个服务事务，不新增通用抽象、数据库结构或 API 字段。

## 2. 权威不变量

同一目标的并发删除只能有一个成功者：

1. 每个 HTTP 请求持有独立数据库会话和事务。
2. 服务先锁定删除目标；不存在则使用既有 `not_found` 返回 404。
3. 只有持锁且仍拥有目标的事务可以追加成功审计、执行副作用并提交。
4. 等待方在成功事务提交后重新取得 READ COMMITTED 可见性，锁定查询返回空并结束；不得消费旧 ORM 对象。

因此，审计数量由同一个目标行所有权决定，而不是由请求到达次数决定。

## 3. 服务层改动

### 3.1 AI 渠道

`delete_ai_channel` 将非锁定 `db.get(AIChannel, channel_id)` 改为项目既有形式：

```python
channel = db.scalar(
    select(AIChannel).where(AIChannel.id == channel_id).with_for_update()
)
```

后续 `append_audit -> db.delete -> db.commit` 顺序不变。渠道关系仍由当前 ORM cascade 和数据库外键处理，生成作业的 `SET NULL`/快照历史合同不变。

### 3.2 AI Header

`delete_ai_channel_header` 将非锁定 `db.get(AIChannelHeader, header_id)` 改为目标 Header 的锁定查询。Header 不存在时立即 404；存在时继续沿用当前的父渠道锁、Header 删除、`invalidate_channel_models`、成功审计和提交顺序。

该方案保持现有 Header 更新与删除的“目标 Header -> 父渠道”顺序，不借本缺陷扩展为全部配置命令锁序重构。当前问题只需要让等待方在目标删除后无法继续使用过期对象。

## 4. HTTP 与数据流

```text
DELETE + ADMIN + CSRF
  -> configuration router
  -> 独立 Session
  -> SELECT target FOR UPDATE
       -> 无行：既有 404
       -> 有行：业务副作用 + 一条 SUCCESS 审计 + DELETE + COMMIT
  -> 204
```

- 不增加请求字段、响应体或错误码。
- OpenAPI 已声明 204/404，无需修改。
- 不改变审计的 action、target_type、target_id、result_message 或脱敏边界。
- 不改变 Header 删除导致渠道和模型失效的现有语义。

## 5. 回归测试设计

在 `test_ai_channel_management.py` 新增一个聚焦并发删除的 PostgreSQL 集成测试，复用现有 `temporary_database("head")`、FastAPI 依赖覆盖和真实 CSRF/ADMIN 会话：

1. 创建管理员、两个独立渠道及必要 Header/模型。
2. 每个缺陷入口使用两个独立 `TestClient`，通过 `Barrier(2)` 同步发起相同 DELETE。
3. 状态码排序后断言 `[204, 404]`。
4. 查询 PostgreSQL，断言目标最终状态、成功审计数量和 Header 删除的 revision/失效副作用。
5. `finally` 清理 FastAPI dependency overrides、关闭客户端和 engine；`temporary_database` 强制删除隔离库。

第二轮 `delete-concurrency-probe.py` 作为发现证据和补充手工验收，不复制进产品测试，也不建立第二套测试框架。

## 6. 文件边界

| 文件 | 计划改动 |
| --- | --- |
| `backend/app/services/ai_configuration.py` | 两个删除目标改为锁定读取；必要的中文契约说明 |
| `backend/tests/integration/test_ai_channel_management.py` | 新增真实 PostgreSQL/FastAPI 并发回归 |
| `.trellis/spec/backend/ai-configuration-guidelines.md` | 补充删除并发合同和必需测试 |

不修改 router、模型、OpenAPI、`contracts/database.md`、迁移、前端或部署文件。

## 7. 取舍、风险与回滚

- 取舍：只修复已经证实的两个目标读取，不抽象一个只有少量调用者的锁助手。
- 风险：并发测试若共享 TestClient 或数据库会话会得到伪证据；设计要求每个请求独立客户端和会话。
- 风险：锁必须在成功审计和副作用之前取得，否则仍可能产生双审计或双 revision。
- 回滚：没有迁移或数据转换；如出现回归，可整体回退服务、测试和规范的同一提交。
