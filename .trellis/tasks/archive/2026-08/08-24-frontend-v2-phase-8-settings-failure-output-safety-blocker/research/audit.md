# A28 Settings 失败输出审计

## 当前风险面

- `Settings` repr 会包含普通字符串配置；连接 URL、session/storage/OSS/AI credential 可能随 traceback 或调试输出展开。
- ValidationError 默认包含截断 input value；这仍可能泄漏连接或 credential 片段。
- pytest 第三方 frame 是否显示 init kwargs 是独立输出面，必须用受控 marker 实测。

## 本地能力证据

- Pydantic `2.13.4`、pydantic-settings `2.14.2`。
- `ConfigDict` 支持 `hide_input_in_errors`。
- 受控 probe：启用该配置后错误字符串不含 marker，也不含 `input_value=`；`Field(repr=False)` 后 model repr 不含 marker但仍含公开字段。
- 当前敏感字段消费者直接需要字符串；`SecretStr` 会要求多处 `.get_secret_value()`，扩大修改与回归面。

## 最小方案

1. Settings model config 加 `hide_input_in_errors=True`。
2. 只给敏感字符串字段加 `repr=False`，保持类型和 aliases 不变。
3. 新增 marker regression 覆盖 repr、ValidationError 和捕获的实际失败输出。
4. 若 pytest 第三方 frame 仍泄漏，停止并报告；不把全局 traceback 改动偷渡进本 Task。

## 实际安全声明边界

该方案只保护 backend Settings 自有 representation/error input，不等于全局日志脱敏或 secret scanner，也不替代 A27 的环境 allowlist。

## 实施证据（2026-08-24）

固定候选：`deed51ddfc7430db93b4ff7035117c812335a604`。

受控基线只输出布尔和命中数：

- Pydantic `2.13.4`、pydantic-settings `2.14.2`。
- `Settings` repr 命中 7 个敏感字段值，公开字段仍可见。
- ValidationError 保留具体中文原因且仍显示 `input_value=`；随机 marker 因 Pydantic 截断恰好未命中，因此不能替代输入隐藏保证。
- 受控失败子进程为非零退出；随机 marker 基线恰好未命中。

模型 owner 收口后：

- 七个敏感字段仍为 `str` 且 `repr=False`。
- ValidationError 不再显示 `input_value=`，具体中文原因保持可见。
- 受控失败子进程 marker 命中数为 0，`input_value=` 不可见。
- 该结论只覆盖 Settings 自有 repr、ValidationError 与受控 Python failure output；未引入或声称存在全局日志脱敏、pytest traceback 过滤或仓库级 secret scanner。
