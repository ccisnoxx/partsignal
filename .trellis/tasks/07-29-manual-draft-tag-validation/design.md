# 技术设计

## 边界与不变量

唯一不变量：所有新建人工内容版本的 `tags` 必须为非空数组，且每个标签包含至少一个非空白字符。服务端请求边界最终裁决，前端只做同规则的提前反馈。

本次不修改数据库和内容版本读取契约；只收紧 `ContentRevisionCreate` 写入契约。历史内容仍按原样读取。

## 后端与契约

1. 在内容 Schema 中定义一个可复用、非变换的标签类型：字符串长度至少 1，并通过正则要求包含非空白字符。
2. `ContentRevisionCreate.tags` 使用该类型并设置数组最少一项。
3. `GeneratedDraft.tags` 复用同一标签类型，保留 AI 输出与人工输入一致的边界；删除已经被类型覆盖的重复标签空白分支，正文空白校验保持不变。
4. 同步 `contracts/openapi.yaml` 的 `ContentRevisionCreate.tags` 为 `minItems: 1`，item 声明 `minLength: 1` 和相同 pattern。
5. 重新生成 `frontend/src/shared/api/schema.d.ts`，并用现有契约检查确认运行时 OpenAPI 与冻结契约一致。

不使用 `strip_whitespace`、normalizer 或 validator 返回改写值，避免改变 payload 与保存内容。

## 前端

1. 在 `frontend/src/shared/` 放置一份内容标签 Ant Form 规则和结构化 `body.tags` 校验错误识别函数。
2. 人工首稿与 `RevisionForm` 导入同一规则，`required: true` 负责必填语义，自定义 validator 同时拒绝空数组和任一全空白项。
3. 两个表单继续通过 `onFinish` 发出原 payload，不过滤、trim 或补值。
4. 表单收到服务端 `VALIDATION_ERROR` 且结构化位置指向 `body.tags` 时，使用 Ant Form `setFields` 将同一中文错误放回标签字段；请求级 Alert 保持现状。
5. 使用 Ant Form 原有 `scrollToFirstError`、Select 键盘交互、`aria-required`、`aria-invalid` 和描述关联，不新增焦点或可访问性实现。

## 兼容性与回滚

- 收紧的是已经由服务层执行的既有业务规则，不放宽也不新增可成功写入的数据形状；差异仅是更早、结构化地拒绝无效请求。
- AI 草稿输出继续使用相同边界；不改变成功数据。
- 若需回滚，可恢复请求 Schema/OpenAPI 和两个 Form rules；没有迁移或持久数据回滚。

## 取舍

- 不抽取完整内容表单组件：两个表单的状态、预览和提交生命周期不同，只共享已经确认会漂移的标签规则。
- 不建立通用服务端字段错误映射框架：本次只识别已有 Pydantic 错误信封中的精确 `body.tags` 路径，避免扩大 DEF-03。
