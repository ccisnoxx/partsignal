# DEF-03 数据流与权威边界

## 完整数据流

```text
ManualDraftModal / RevisionForm
  → Ant Select(mode="tags")
  → 共享 contentTagRules
  → Schema<"ContentRevisionCreate">
  → POST manual-versions / revisions
  → ContentRevisionCreate(tags: 非空 list，元素至少包含一个非空白字符)
  → _validated_manual_draft()
  → GeneratedDraft(tags: 复用相同 ContentTag)
  → 无效时 422 VALIDATION_ERROR
  → 前端按 error.details.errors[*].loc == body.tags 回填字段错误
```

## 已确认 owner

- 写入 payload owner：`ContentRevisionCreate`。它被人工首稿和人工修订两个接口共同复用。
- 服务端最终请求边界：`ContentRevisionCreate`。要求标签数组至少一项、元素长度至少 1，且每项匹配 `\S`；`GeneratedDraft` 复用同一 `ContentTag`。
- HTTP 校验错误 owner：`validation_error_handler`。Pydantic 请求错误使用 `422 VALIDATION_ERROR`，结构化位置保存在 `error.details.errors[*].loc`。
- 前端表单 owner：人工首稿与人工修订是两个独立 Ant Form，共享 `contentTagRules` 和精确的 `body.tags` 服务端错误识别。

## 调用方

- 人工首稿：`POST /api/v1/content-tasks/{content_task_id}/manual-versions`。
- 人工修订（包括 AI 草稿编辑后创建人工版本）：`POST /api/v1/content-versions/{content_version_id}/revisions`。
- AI 原始生成与自然化也使用 `GeneratedDraft`，但不使用 `ContentRevisionCreate` 或前端表单；共享标签类型时必须保持其现有严格输出边界。
- 内容版本读取、预览和发布只消费 `ContentVersion.tags`，不属于本次写入校验变更。

## 修复前契约差异

- 冻结 OpenAPI：`tags` 仅为 `array<string>`，没有 `minItems`、元素 `minLength` 或非空白模式。
- Pydantic `ContentRevisionCreate`：`tags: list[str]`，同样接受空数组和空白字符串。
- `GeneratedDraft`：`Field(min_length=1)` 约束数组和元素，并用模型校验拒绝空白标签。
- 因此验收 422 来自服务层，而不是可生成、可复用的请求契约；前端生成类型无法承载运行时规则，必须由 Ant Form 复用明确的运行时校验。

## 不变行为

- 不 trim 或改写标签；只用空白检查判断有效性。
- 不去重、不限制数量或长度。
- 不改变历史 `ContentVersion.tags` 输出契约。
- 不放宽 `GeneratedDraft`，不增加默认标签或失败兜底。
