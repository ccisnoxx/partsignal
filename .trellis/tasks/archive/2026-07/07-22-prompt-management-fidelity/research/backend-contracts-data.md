# Prompt 后端契约调查

## 权威数据模型

- `backend/app/models/configuration.py:61-80`：`platform_prompts` 以 `platform_profile_id` 为主键，FK `platform_profiles.id ON DELETE CASCADE`，每个具体平台至多一个 Markdown Prompt；字段 `template_markdown`、`revision`（默认 0）、`updated_by`（users RESTRICT）、创建/更新时间。
- `backend/app/models/configuration.py:83-99`：`content_humanization_prompts` 单例，CHECK `id = 1`；Markdown、revision、updated_by（RESTRICT）及时间字段。数据库契约明确迁移 0017 不插入初始行、无删除 API/环境 fallback/平台复制（`contracts/database.md:125-131`）。
- `contracts/database.md:107-113`：0014 将 Prompt 所有权从平台类型迁移到具体平台；无类型级兼容端点、双读写或 fallback。平台可以缺 Prompt；任务创建要求 ACTIVE 规则和当前 Prompt。平台 Prompt 可在迁移后分化，降级需备份。

## OpenAPI 与路由

- `contracts/openapi.yaml:705-743`：`GET/PUT/DELETE /api/v1/platform-profiles/{platform_profile_id}/prompt`，GET/PUT/DELETE 分别 200/200/204；PUT、DELETE 声明 CSRF，PUT 409 错误；Prompt 输出含 platform_profile_id/template_markdown/revision/updated_by/created_at/updated_at。全局自然化端点在 `:743-768`，仅 GET/PUT（无 DELETE），GET 404，PUT 409。
- `backend/app/routers/configuration.py:352-363`：平台 GET 要求 `AdminUser`，缺行返回 404；`:366-386` PUT 要求 AdminUser + `CsrfProtected`；`:389-406` DELETE 同样要求 AdminUser + CSRF。
- `backend/app/routers/configuration.py:206-217`：全局 GET 仅 AdminUser、缺 singleton 返回 404；`:220-238` PUT AdminUser + CSRF。

## 输入校验、revision 与事务

- `backend/app/schemas/configuration.py:309-337`：两类 PUT 均 `template_markdown: str = Field(min_length=1)`、`expected_revision: int | None = Field(ge=0)`。Schema 只保证长度（空白字符串由 service 再拒绝）。
- `backend/app/services/platform_configuration.py:401-446`：平台 PUT 先确认 profile 存在（404）；按行 `FOR UPDATE`；strip Markdown，空值 `VALIDATION_ERROR` 422。首次创建必须 expected_revision 为 null，否则 `REVISION_CONFLICT` 409，revision=0；更新必须精确匹配 revision，成功后 +1、更新 actor；写 `platform_prompt.saved` 审计 details revision，commit。不存在 profile 的 PUT 返回“平台”404，而不存在 Prompt + expected_revision 非空返回 409。
- `backend/app/services/platform_configuration.py:449-491`：全局 singleton 相同逻辑，锁 id=1；首次 null revision 创建 0，后续精确匹配并递增；审计 action `content_humanization_prompt.saved`、target_type `ContentHumanizationPrompt`、target_id `UUID(int=1)`、details revision。
- `backend/app/services/platform_configuration.py:494-515`：平台 DELETE 锁定 Prompt；不存在返回 404；物理删除并写 `platform_prompt.deleted` 审计后 commit。无 expected_revision，故删除无乐观锁；全局自然化无删除服务。

## 权限、CSRF、审计及测试证据

- 路由依赖 `AdminUser`，工程师 GET 被拒（集成测试 `backend/tests/integration/test_publication_review_closure.py:402-500`）；PUT/DELETE 通过 `CsrfProtected`，CSRF 失败由通用依赖处理（本调查未发现 Prompt 专用绕过）。
- 同测试验证全局 Prompt：缺失 GET=404；空白 PUT=422 code `VALIDATION_ERROR`；首次创建带 null 得 200 revision 0 且正文 trim；重复首次创建 409 `REVISION_CONFLICT`；expected_revision=0 更新到 revision 1；过期 revision 再写 409；DB `updated_by` 为管理员，审计 details 依次 `[{revision:0},{revision:1}]`。
- 平台 Prompt 生命周期/删除及审计在同测试文件约 `:1106-1203`（符号 `delete_platform_prompt` 调用与 `platform_prompt.deleted` 断言）；迁移所有权约 `backend/tests/integration/test_migrations.py:849-1020`；自然化迁移约 `:1157-1332`。

## 已确认缺口 / 不可猜测项

- OpenAPI 的 Prompt PUT schemas 仅 `min_length:1`，业务实际 strip 后拒绝全空白；未见 Markdown 最大长度或模板语法校验，不能臆测应新增。
- 平台 DELETE 不携带 expected_revision，存在并发删除/更新时最后提交者语义；这是现有实现，契约未要求改变。
- 审计只保存 action、actor、target、revision（删除无正文），未发现 Prompt 历史版本表；数据库契约称当前值而非 append-only。不得推断需要版本历史/恢复接口。
- 自然化 Prompt 的读取缺失为 404，生产任务相关服务通过“配置存在”判断；无环境默认值。未知 Prompt 时应保持显式失败，不能补默认文本。
