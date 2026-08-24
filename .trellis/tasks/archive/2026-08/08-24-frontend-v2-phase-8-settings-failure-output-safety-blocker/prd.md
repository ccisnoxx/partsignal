# Frontend V2 Phase 8 Settings Failure Output Safety Blocker

## 1. 目标

关闭 A28：让 backend `Settings` 的正常 representation 和验证错误字符串不展开连接配置或 credential，同时保留具体 validator 的中文错误原因和可归因测试失败。

## 2. 已确认事实

- Phase 8 recheck 的意外 Settings failure traceback 展开了截断的开发连接配置表示；具体值未写入 Task evidence，但敏感输出保证已失败。
- `backend/app/config.py` 当前所有字段使用普通 `str`，`SettingsConfigDict` 未启用 `hide_input_in_errors`，连接和 credential fields 也未设置 `repr=False`。
- 直接消费者依赖这些字段仍为 `str`；改为 `SecretStr` 会扩散到 DB、Redis、Cookie、storage、AI credential 调用方，不是最小修复。
- 当前本地 Pydantic `2.13.4` / pydantic-settings `2.14.2` 原生支持 `hide_input_in_errors`；受控 probe 证明它会去除 ValidationError 的 input value，`Field(repr=False)` 会从 model repr 移除 marker，同时保留公开字段诊断。
- pytest/第三方 frame 是否仍会展开调用参数必须由受控 marker 的真实失败输出验证，不能只凭模型 API 推断。
- 当前 recheck artifacts 尚未提交；本 Task 不得在 dirty recheck 分支上启动。

## 3. Requirements

### R1. 候选与修改边界

- 等待 recheck evidence 提交并回到 clean `main`；按一个 child 一次的规则，在 A27 完成或用户调整顺序后再启动 A28。
- 首选修改仅限 `backend/app/config.py` 与现有 backend unit owner；不修改 API、数据库、OpenAPI、frontend、E2E runner 或业务行为。
- 用户批准规划前保持 `planning`；不创建分支、不运行 `task.py start`、不修改产品文件。

### R2. Settings 自有输出面

- 在 `SettingsConfigDict` 启用 Pydantic 原生 `hide_input_in_errors=True`，保留现有 env file/extra 合同。
- 对可能包含 credential/capability 的字段使用 `Field(repr=False)`：database/Redis URL、session secret、开发 storage signing key、OSS access key ID/secret、AI credential encryption key。
- 保持字段运行时类型、alias、默认值、validator 顺序和所有调用签名不变；不引入 `SecretStr` 迁移、wrapper、全局 scanner 或静默异常处理。
- 非敏感 validator message、field name、error type 必须继续可见，不能把配置失败改为笼统错误或成功。

### R3. 受控 regression

- 使用唯一受控 marker 构造合法 Settings，断言 `repr(settings)` 不含任一敏感 marker，且非敏感字段仍可诊断。
- 构造必然失败的 Settings，断言 `str(ValidationError)` 不含 marker、连接 scheme 或 `input_value`，同时包含预期 validator message。
- 用受控子进程/pytest failure capture 验证实际 stderr/report 不含 marker；只输出布尔/计数，不把 marker 或配置值写入 evidence。
- 若 model-owned 改动后第三方 pytest frame 仍暴露 marker，立即停止并报告残余 owner；不得擅自修改全局 pytest traceback、Makefile 或 runner。

### R4. 验证与关闭

- Required：目标 Settings regression、完整 backend unit、backend Ruff、backend mypy。
- Optional：根 `make test-unit`；只有用户批准且与当时候选/环境 owner一致时运行。不得在本 blocker 运行 `make verify` 或 E2E。
- A28 只有在受控 marker 从 Settings repr、ValidationError 和实际 failure output 三个面均消失，现有 Settings tests 全绿，且字段合同不变时关闭。
- A28 关闭后 Phase 8 仍 `NOT_MET`；必须等待 A27/A28 都关闭后由用户决定是否创建新的独立 Exit Gate recheck。

## 4. Acceptance Criteria

- [x] clean `main` 冻结候选，A27/recheck 前置状态明确且无未识别 dirty 文件。
- [x] Settings 的敏感字段不出现在 model repr，非敏感诊断仍保留。
- [x] ValidationError 不包含 input value 或受控敏感 marker，具体 validator message 保留。
- [x] 受控真实 failure output 不包含 marker。
- [x] Settings 字段仍为现有 `str` 合同，alias/default/validator 和消费者无需迁移。
- [x] 目标 regression、完整 backend unit、Ruff、mypy 通过；没有为了通过修改既有业务断言。
- [x] 未修改 API/DB/前端/E2E/Makefile/全局 pytest runner，未新增 scanner、依赖或 fallback。
- [x] 父任务只更新 A28 状态；Phase 8 不标记完成，不运行最终 Gate或 Phase 9。
- [x] 展示 diff/commit plan并等待批准；不自动 commit、push、PR 或 archive。

## 5. Out of Scope

- A27 的 `.env` 两键隔离或最终门禁调用环境。
- `SecretStr` 全量类型迁移、集中日志脱敏框架或仓库级 secret scanner。
- 修改 pytest 全局 traceback 格式、Makefile、CI、E2E runner；若模型边界不足，另行请求授权。
- 运行 `make e2e`、`make verify`、更新 `07/08` 或开始 Phase 9。

## 6. Blocking Questions

无。首选最小机制、验证边界和升级停止条件均已由本地版本与调用方检查确定；等待用户批准后启动。
