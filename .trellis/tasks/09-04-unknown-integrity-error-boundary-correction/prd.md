# Unknown IntegrityError 默认失败边界

## 目标

撤销全局 `IntegrityError -> REVISION_CONFLICT` 伪装，使没有明确领域映射的 SQLAlchemy `IntegrityError` 进入 FastAPI/Starlette 现有默认 server-error boundary，并以真实 PostgreSQL HTTP sentinel 证明失败不泄漏且事务无部分写入。

## 背景与已确认事实

- `backend/app/errors.py` 当前把所有 `IntegrityError` 统一转换为 `409 REVISION_CONFLICT`。
- `backend/app/main.py` 在应用级注册该 handler，因此未知约束也会被错误声明为 revision 冲突。
- 服务层已有的真实 revision、状态、幂等和已知约束映射继续由现有 `AppError` 路径负责；本任务不改变它们。
- `AIModel(channel_id, model_id)` 的真实唯一约束可作为 unknown integrity sentinel，且创建路径已经具备事务 rollback/close 责任边界。

## 需求

1. 删除全局 `IntegrityError` handler 及应用注册，不新增替代性的全局数据库异常映射。
2. 未被服务层识别并显式转换的 `IntegrityError` 必须保持未处理状态，最终由框架默认边界返回 HTTP 500。
3. 不新增公共错误 code、500 JSON envelope、response schema、OpenAPI status 或 generated client 类型。
4. 以合法 AI channel 下重复创建相同 `(channel_id, model_id)` 的真实 PostgreSQL `23505` 作为 HTTP sentinel；应用必须以 `debug=False` 运行，客户端必须使用 `raise_server_exceptions=False`。
5. sentinel 必须证明：响应是 500 而非 409/`REVISION_CONFLICT`；响应不泄漏 SQL、表名、约束名、数据库消息或 stack；失败后没有第二条 AIModel、没有 `ai_model.created` 成功审计、原 channel/model revision 不变，且新的独立查询仍可成功执行。
6. 保留真实 `expected_revision` 冲突和至少一个已有正确 constraint mapper 的现有 status/code/details 行为。
7. 更新后端错误处理规范，明确 unknown integrity 原样抛出、进入默认 server-error boundary，且该默认 500 body 不是稳定公共 JSON 合同。

## 文件边界

允许修改且仅允许修改：

- `backend/app/errors.py`
- `backend/app/main.py`
- `backend/tests/integration/test_ai_channel_management.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `.trellis/spec/backend/error-handling.md`

只作为验证目标，不修改：

- `backend/tests/integration/test_platform_types.py`
- `backend/tests/unit/test_contract.py`

禁止修改：

- `contracts/openapi.yaml`
- generated client 与全部 frontend 文件
- services、migrations、数据库 schema、权限和状态转换实现
- 与本任务无关的用户现有工作区变更

## 验收标准

- [ ] `backend/app/errors.py` 不再导入 SQLAlchemy `IntegrityError`，也不存在对应 handler。
- [ ] `backend/app/main.py` 不再导入或注册全局 `IntegrityError` handler。
- [ ] 真实 PostgreSQL duplicate AI Model HTTP sentinel 返回 500，且不被表示为 409 或 `REVISION_CONFLICT`。
- [ ] sentinel 响应不包含 SQL、表名、constraint name、DB message 或 stack，且测试不冻结默认 500 body/code/header。
- [ ] sentinel 失败无第二条模型、无成功审计、无 revision/其他部分状态变化；请求后的独立查询成功。
- [ ] 一个真实 revision conflict 和一个现有正确 constraint mapper 回归保持原有语义。
- [ ] runtime metadata 与冻结合同测试通过，`make contract-check` 通过，OpenAPI/generated client 无变更。
- [ ] 错误处理规范与实现一致，实际产品代码/测试/spec diff 严格限定在五个允许文件内。

## 非目标

- 不在本任务收敛 platform type/profile/prompt/account、content/generation、publication/GEO 的具体约束映射。
- 不决定或新增 AI Header/Model 的公共 duplicate code。
- 不把所有 500 转换为统一错误信封，也不为默认 500 建立稳定 wire contract。
