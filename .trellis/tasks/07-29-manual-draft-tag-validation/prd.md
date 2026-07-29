# 修复人工草稿标签校验一致性

## 目标

修复验收缺陷 DEF-03，使人工首稿与人工修订在提交前按服务端同一标签约束完成校验，并继续由服务端作为最终校验权威。

## 背景

- 验收页面：`/tasks/bfa650b8-7969-419a-b7de-8e5e46694eb6`。
- 当前人工首稿表单没有把“标签”标为必填，也没有提交前校验；空标签请求最终返回 HTTP 422，请求 ID 为 `7d687fc5-ec11-416d-9e1c-618088534041`。
- `ContentRevisionCreate` 同时用于人工首稿和基于既有内容版本的人工修订，不能只修复一个入口。
- 当前 OpenAPI 与后端请求模型只声明 `tags` 为必传数组；服务层复用 `GeneratedDraft` 后才执行真实标签边界，造成契约和校验时机不一致。

## 需求

1. `ContentRevisionCreate.tags` 的权威写入契约为：
   - 必须是数组；
   - 至少包含一个标签；
   - 每个标签必须是字符串、长度至少为 1，且不能只包含空白；
   - 不新增 trim、去重、数量上限、长度上限或默认标签。
2. OpenAPI、Pydantic 请求模型、服务端严格草稿结构和两个前端表单必须表达同一标签边界。
3. 人工首稿和人工修订的标签字段必须明确显示为必填，并复用同一份前端校验规则。
4. 空数组、仅含空白的标签、删除最后一个标签以及任一空白标签均不得触发请求；字段下方显示中文错误。
5. 标签恢复有效后，就地错误消失并可提交原有 payload，不静默过滤或改写标签。
6. 必填、错误说明和错误状态必须通过 Ant Form 与 Select 的既有语义对键盘和辅助技术可感知。
7. 服务端继续拒绝绕过前端提交的无效 payload，并通过现有 `422 VALIDATION_ERROR` 信封保留结构化字段位置；前端若收到该字段错误，应回填到标签字段，同时保留现有请求级错误提示。
8. 只处理 DEF-03，不修改审计筛选、删除后 404、平台类型唯一性、事实审计或 GEO 更正等其他缺陷。

## 验收标准

- [x] 人工首稿标签显示必填；空标签提交时出现中文就地错误，标签控件具有可感知的 required/invalid/error-description 语义，且未调用 POST。
- [x] 只有空白标签时不能提交。
- [x] 删除最后一个标签后不能提交。
- [x] 至少一个有效、且不存在空白项的标签时，人工首稿提交现有 `ContentRevisionCreate` payload，不 trim、不去重、不补默认值。
- [x] 人工修订入口复用同一规则；无效标签不请求，有效标签仍可创建新版本。
- [x] 直接请求人工首稿或人工修订接口并提交空数组/空白标签时，服务端返回 `422 VALIDATION_ERROR`，结构化错误位置指向 `body.tags`。
- [x] 冻结 OpenAPI、运行时 OpenAPI 和生成的 TypeScript 类型保持一致。
- [x] 最相关前端组件测试、后端契约/请求测试、前端 typecheck 与 lint 通过。

## 范围外

- 不改变已存在 `ContentVersion` 输出中历史标签的可读形状。
- 不增加标签 trim、去重、最大数量或最大长度。
- 不增加默认标签、静默过滤、422 成功兜底或兼容字段。
- 不改动内容状态机、AI 生成规则、审核、发布或数据库结构。

## 技术说明

- 后端真实边界见 `backend/app/schemas/geo_files.py:389-404` 和 `backend/app/services/content_production.py:626-638`。
- 共享请求模型见 `backend/app/schemas/content.py:276-281`，两个 HTTP 调用方见 `backend/app/routers/production.py:274-338`。
- 前端人工首稿缺失规则见 `frontend/src/features/content-tasks/ContentTasksPage.tsx:694-753`；人工修订同样缺失规则见 `frontend/src/features/content-editor/RevisionForm.tsx:24-100`。
- 冻结契约见 `contracts/openapi.yaml:1384-1402`、`contracts/openapi.yaml:1471-1489` 与 `contracts/openapi.yaml:3290-3299`。
