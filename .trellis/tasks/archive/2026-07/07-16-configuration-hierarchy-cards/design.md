# 技术设计

## 1. 权威数据关系

本次直接收敛为以下关系，不引入绑定表或可复用 Prompt 库：

```text
PlatformType 1 ── N PlatformProfile 1 ── 0..1 PlatformPrompt
                                  └── N PlatformProfileVersion
```

- `PlatformType` 只负责分类。
- `PlatformProfile` 是具体平台身份和当前 Prompt 的唯一所有者。
- `PlatformProfileVersion` 是不可变平台规则，任一时刻允许没有 `ACTIVE` 版本。
- `GenerationJob.input_snapshot` 是单次生成实际使用配置的不可变历史。

## 2. 数据库迁移

新增 Alembic revision `0014`，通过新表复制后替换旧表：

1. 创建临时表，使用 `platform_profile_id` 作为主键和外键，保留 Markdown、revision、维护人和时间字段。
2. 按 `platform_profiles.platform_type_id = 旧 platform_prompts.platform_type_id` 执行集合复制，同一类型下每个平台得到一份独立 Prompt。
3. 无具体平台的旧 Prompt 不产生新记录。
4. 删除旧表，将临时表改为 `platform_prompts`。
5. 新外键使用 `ON DELETE CASCADE`，因为 Prompt 是平台拥有的当前配置，不是业务历史。

迁移后 ORM 和数据库文档只保留 `PlatformPrompt.platform_profile_id`。平台级 Prompt 分化后无法可靠合并回类型级 Prompt，因此 downgrade 不猜测合并，应用回滚依赖迁移前 PostgreSQL 备份。

## 3. API 契约

移除 `/api/v1/platform-types/{platform_type_id}/prompt`，新增：

```text
GET    /api/v1/platform-profiles/{platform_profile_id}/prompt
PUT    /api/v1/platform-profiles/{platform_profile_id}/prompt
DELETE /api/v1/platform-profiles/{platform_profile_id}/prompt
```

`PlatformPrompt` 响应使用 `platform_profile_id`。`PlatformProfile` 响应增加或调整：

```yaml
active_version: PlatformProfileVersion | null
prompt_configured: boolean
```

不新增 Prompt 列表接口。Prompt 页面复用平台列表展示平台、类型和配置状态，管理员打开某行时才请求该平台 Prompt。

`AIChannel` 列表响应增加只读摘要：

```yaml
enabled_models:
  - display_name: 内容生成模型
    model_id: provider-model-id
```

只返回 `is_enabled=true` 的模型，不返回模型参数、测试详情或渠道凭据。后端用关系预加载或一次批量查询组装摘要，避免查询 N+1。

## 4. 平台可用性

服务端以一个权威条件判断工程师可用平台：

```text
存在 ACTIVE PlatformProfileVersion && 存在当前 PlatformPrompt
```

- 平台管理列表始终返回平台，即使 `active_version=null`。
- 工程师创建内容任务仍提交 `platform_profile_version_id`；服务端从该版本确认具体平台、版本状态和当前 Prompt。
- 非 `ACTIVE` 版本沿用状态错误；Prompt 缺失返回稳定错误码 `PLATFORM_PROMPT_MISSING`。
- 平台投影不因缺少有效规则而失败，也不自动把其他版本当作有效版本；后续删除服务可直接复用该状态。
- 前端选项可过滤不可用平台或显示不可用原因，但不能成为唯一校验层。

## 5. 生成作业锁定

内容任务继续保存 `platform_profile_version_id`，不保存 Prompt 正文。创建每个生成作业时：

1. 从任务锁定的规则版本解析具体平台。
2. 读取该平台当前 Prompt；缺失则拒绝创建作业。
3. 生成最终 system message 和 user message。
4. 在 `input_snapshot` 写入具体平台 ID、名称、slug、规则版本 ID/版本号和最终消息。

新快照必须包含 `platform_profile`。读取 Schema 允许旧快照缺少该字段，仅用于读取既有不可变历史，不允许新写入省略。Prompt 正文通过最终 `system_message` 冻结，不增加重复快照列。

## 6. 前端结构

配置中心使用以下并列路由：

```text
/configuration/platform-types  平台类型
/configuration/platforms       平台管理
/configuration/prompts         Prompt 管理
```

- `PlatformTypesPage` 删除 Prompt 请求和编辑区。
- `PlatformsPage` 支持 `active_version=null`，显示“无有效规则”和 Prompt 配置状态。
- 新 `PlatformPromptsPage` 使用表格或列表展示平台及类型，编辑框为普通 Markdown TextArea，支持全选、复制、粘贴、覆盖保存和删除。
- `routeLoaders.ts` 继续是动态 import 的唯一所有者，导航预取复用相同 loader。

渠道卡片保持现有点击进入详情和 action 区。主体按身份、API 地址、紧凑指标、已启用模型四段展示；模型标签完整换行，不做截断或展开状态。只增加当前设计所需样式，不引入新组件库或 Token 体系。

## 7. 安全与并发

- Prompt 增删改和平台配置只允许管理员，沿用 CSRF 和审计。
- Prompt 覆盖继续使用 revision 乐观锁，删除时锁定目标记录。
- 审计记录对象、动作和 revision，不记录完整 Prompt 正文。
- AI Key 和敏感 Header 不进入模型摘要或页面日志。

## 8. 验证

- 迁移测试覆盖一对多复制、孤立 Prompt 丢弃、约束和迁移后 ORM。
- 后端测试覆盖平台列表空有效规则、任务创建边界、按平台 Prompt 生成、作业快照不漂移和模型摘要查询次数。
- 前端测试覆盖三路由、Prompt CRUD、不可用状态、渠道全部模型和空状态。
- E2E 覆盖管理员配置平台/Prompt、工程师创建任务、删除 Prompt 后拒绝新作业、恢复配置后重新生成。
