# Phase 3 架构与切片设计

## 切片切分与迁移链

```text
0074_assignments_sla_inbox (Phase 2 head)
  -> 0075_prompt_versioning_and_brief_v4
  -> 0076_quality_gate_and_duplication
  -> 0077_publication_package_and_precheck
  -> 0078_public_page_health_checks
```

## 关键架构不变量

1. **锁序与事务隔离**：
   - 写命令统一先 `discard_auth_heartbeat(db)` -> 按 UUID 升序 `User (FOR SHARE)` -> `SessionRecord (FOR SHARE)` -> 业务锁序（`PlatformPromptBindings` advisory lock / `ContentTask -> ContentVersion` / `PublicationWork`）。
   - 所有 `REPEATABLE READ` 读快照依赖统一设置 `db.autoflush = False`。
2. **不可变与受控删除边界**：
   - `platform_prompt_versions` 发布后正文永久不可变；被 `platform_profiles` 或 `generation_jobs` 引用的版本通过 `ON DELETE RESTRICT` + 触发器禁止删除。
   - `content_quality_check_jobs` 与 `published_article_health_checks` 为追加不可变记录；接入 `0045` 已归档内容任务永久删除清理范围（不破坏保留期间不可变合同）。
   - 所有新增用户外键（`platform_prompt_versions.created_by/published_by`、`content_quality_check_jobs.created_by`、`published_article_health_checks.triggered_by`）全部接入 `identity.py` `USER_IN_USE` 预检。
3. **契约优先与向后兼容**：
   - 保持 `content-markdown-v2`、`content-markdown-v3`、`humanization-markdown-v2` 全部既有历史快照可读；`content-markdown-v4` 仅用于带 `ContentBriefSnapshot` 的新任务生成。
   - `PublicationPackage` 采用纯加法字段扩展，保留全部既有 8 字段。
   - 既有 `PUT /api/v1/platform-prompts/{id}` 保持可用并同步生成新不可变版本（与显式版本管理接口并存，避免破坏既有入口与前端/集成测试）。
