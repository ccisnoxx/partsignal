# 技术设计

## 核心不变量

只有被权威业务 owner 明确认定的数据库约束，才能转换为具体领域错误；未知 `IntegrityError` 不得被猜测为 revision conflict。失败必须保留为显式 server error，并依赖既有请求 Session 生命周期完成 rollback/close。

## 当前与目标路径

当前路径：

`route/service -> unknown IntegrityError -> app-level integrity_error_handler -> 409 REVISION_CONFLICT`

目标路径：

`route/service -> unknown IntegrityError -> framework default exception boundary -> 500`

已知路径保持不变：

`service command -> verified constraint/revision/state mapping -> AppError -> ErrorEnvelope`

## 权威修改点

1. `backend/app/errors.py`
   - 删除 SQLAlchemy `IntegrityError` 导入和 `integrity_error_handler`。
   - 保留 `AppError`、校验错误和其他领域错误 helper。
2. `backend/app/main.py`
   - 删除 SQLAlchemy `IntegrityError` 导入、handler 导入和应用级注册。
   - 不新增通用 500 handler。
3. `backend/tests/integration/test_ai_channel_management.py`
   - 新增独立真实 PostgreSQL HTTP sentinel，避免把异常处理验收埋入过长的 CRUD 场景。
   - 创建管理员、合法 channel 和第一条 model；记录 channel/model revision 及成功审计基线。
   - 使用实际应用的 `debug=False` 配置和 `TestClient(..., raise_server_exceptions=False)` 发起重复 `(channel_id, model_id)` 创建。
   - 只固定 500 status 和敏感内部信息不得出现，不把框架默认 body/header/code 固定为公共合同。
   - 使用请求结束后的新 Session 查询模型、审计与 revision，并执行独立查询证明连接/事务可继续使用。
4. `backend/tests/unit/test_runtime_response_metadata.py`
   - 证明应用 exception handler 集合不再包含 SQLAlchemy `IntegrityError`，且现有业务/校验 handler 与运行时 response metadata 未漂移。
   - 不给任一 operation 添加 500 metadata。
5. `.trellis/spec/backend/error-handling.md`
   - 记录 verified mapper 与 unknown re-raise/default 500 的边界。
   - 明确默认 500 body 不是冻结的 ErrorEnvelope 合同。

## Sentinel 的约束与副作用证明

- 必须由 PostgreSQL 真实 unique constraint 触发，不能直接构造或 mock `IntegrityError`。
- 失败请求使用唯一 request ID，以精确排除 `ai_model.created` 的 SUCCESS AuditLog。
- 不读取或向客户端暴露 `diag.constraint_name`；约束身份只作为测试数据库触发路径的内部证据。
- failure request 的 Session 由既有依赖生成器负责 rollback/close；验证使用新的 Session，避免误把测试对象状态当成持久化结果。
- 失败前后的 channel/model revision 和模型计数必须相等，唯一允许存在的是预先成功创建的第一条模型。

## 合同与兼容性

- 本任务删除错误的全局行为，但不创建新的稳定公共错误协议。
- OpenAPI 当前没有承诺默认 500 response；因此不修改 `contracts/openapi.yaml`、router `error_responses(...)` 或 generated client。
- 已有服务层正确 mapper 和 `expected_revision` 分支继续使用 `AppError`，其 ErrorEnvelope/status/code/details 必须由回归测试证明未受影响。

## 风险与回退

- 风险：测试若复用全局 `app`，其他测试可能受 dependency override 或 debug 状态污染。测试必须在 `finally` 中清理 override 并关闭 client。
- 风险：断言默认 body 会把框架实现细节误升格为合同。只对泄漏关键词做负向检查。
- 风险：失败事务未正确结束会污染后续查询。以请求后独立 Session 查询作为验收。
- 回退只需恢复两个 handler 相关删除和对应测试/spec；不涉及 migration 或持久化数据迁移。

