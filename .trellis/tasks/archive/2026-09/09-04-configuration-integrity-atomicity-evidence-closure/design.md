# 配置 IntegrityError 原子性证据收口设计

## 1. 设计目标

本任务只为已批准、已实现的 duplicate 合同补充失败后持久状态证据。生产代码、数据库约束、并发模型、HTTP error envelope 和前端恢复行为均不变。

## 2. 证据模型

每个失败路径遵循同一个最小模式：

1. 复用现有成功 setup，在 duplicate 请求前记录必要的 canonical snapshot。
2. 给 duplicate 请求设置唯一 `X-Request-ID`，继续断言既有 status/code/structured loc。
3. 让失败请求完整结束，不重用请求依赖中的 Session 作为验证依据。
4. 打开新 Session，按主键和 owner 重读 canonical rows，比较 identity/configuration/revision/state/count。
5. 按 request ID + action + `outcome=SUCCESS` 断言失败请求没有成功审计，并用简单查询证明新 Session 可用。

该模式只在两个现有 test body 内增加少量 snapshot/assertion，不抽取全局 assertion framework，不重复现有 PostgreSQL graph。

## 3. AI Header/Model 路径

### 3.1 Header create/update

- Owner 是现有长链路 `test_ai_channel_api_enforces_permissions_contract_and_secret_redaction`。
- create duplicate 保留原 Header identity，channel revision 不变，Header 行数不变，无 `ai_channel_header.created` SUCCESS audit。
- update duplicate 保留被更新 Header 的 name/normalized name、敏感性和 plain/encrypted 存储形态，channel revision 不变，无 `ai_channel_header.updated` SUCCESS audit。
- Header 成功路径会失效模型；测试必须使用一条可观测 model sentinel，在 duplicate 前后比较 revision/enabled/test state。sentinel 只服务于测试观测，验证后恢复原长链路所需基线，不改变生产 fixture。

### 3.2 Model update

- 复用长链路中已创建的两个 Model。
- duplicate 前记录第二个 Model 的所有可变持久字段；失败后新 Session 按 id 重读并比较，同时断言同渠道行数不变。
- 使用唯一 request ID 检查 `ai_model.updated` SUCCESS audit 不存在。

## 4. Platform Prompt 路径

- Owner 是 `test_platform_prompt_duplicate_paths_share_field_error_and_diagnostics`。
- 保存第一条 Prompt 的纯标量 snapshot（id/name/Markdown/revision），避免 rollback 后读取过期 ORM 对象。
- precheck 失败和真实 constraint 失败使用不同 request ID；最后在新 Session 中统一断言仅有原行、snapshot 不变，两个 request ID 都没有 `platform_prompt.created` SUCCESS audit，且 Session 可执行新查询。

## 5. 文件与成本边界

只修改：

- `backend/tests/integration/test_ai_channel_management.py`
- `backend/tests/integration/test_platform_workspace.py`

本子任务目标净增不超过 120 行，硬上限 150 行。如果 model sentinel 或持久 snapshot 需要生产 hook、新 fixture framework 或超过上限，立即停止，不得用更弱断言替代。

## 6. 验证与返回父任务

- 先运行两个精确 test node，再运行两个受影响 integration 文件。
- Ruff 只检查两个允许文件，并运行 `git diff --check`。
- 新的独立 `trellis-check` 只复核四条失败原子性、Session 清理、审计和文件边界。
- 子任务通过后不在这里运行 contract gate；返回父任务，由父任务运行唯一一次 `make contract-check` 和最终跨层 review。

## 7. Rollback Boundary

本子任务只增加测试断言和必要的测试数据。若回滚，只精确移除本子任务新增的 snapshot/sentinel/audit 断言，不回滚父任务的 mapper、并发测试、合同、文档或 specs，不使用 Git checkout/reset/stash。
