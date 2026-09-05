# T2 数据库 catalog 与 diagnostics preflight

执行环境：`deploy/compose.dev.yaml` 的 PostgreSQL 16 开发数据库，Alembic head `0038_published_article_delete`。

## Catalog 结果

- `uq_ai_channel_headers_channel_id`：`pg_constraint.contype=u`，表 `ai_channel_headers`
- `uq_ai_models_channel_id`：`pg_constraint.contype=u`，表 `ai_models`
- `uq_platform_types_slug`：`pg_constraint.contype=u`，表 `platform_types`
- `uq_platform_profiles_slug`：`pg_constraint.contype=u`，表 `platform_profiles`
- `uq_platform_prompt_templates_name`：`pg_constraint.contype=u`，表 `platform_prompts`
- `uq_platform_accounts_profile_identifier_normalized`：unique index，定义为 `(platform_profile_id, lower(btrim(account_identifier)))`

## 真实 unique violation 结果

在单个显式事务中分别触发六条 unique violation，并在最后执行 `ROLLBACK`；观察到：

| identity | `RETURNED_SQLSTATE` | `CONSTRAINT_NAME` |
| --- | --- | --- |
| AI Header | `23505` | `uq_ai_channel_headers_channel_id` |
| AI Model | `23505` | `uq_ai_models_channel_id` |
| platform type | `23505` | `uq_platform_types_slug` |
| platform profile | `23505` | `uq_platform_profiles_slug` |
| platform prompt | `23505` | `uq_platform_prompt_templates_name` |
| platform account | `23505` | `uq_platform_accounts_profile_identifier_normalized` |

事务最终输出 `ROLLBACK`，未保留 preflight 数据。Catalog 名称和 diagnostics 与已批准设计一致，未触发停止条件。
