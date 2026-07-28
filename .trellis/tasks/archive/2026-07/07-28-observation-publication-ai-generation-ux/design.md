# 观测发布界面与可配置 AI 生成优化：技术设计

## 1. Design Summary

采用一个可复用的 `PlatformPrompt` 模板库，并在 `PlatformProfile` 上保存可空的当前 Prompt 外键。一个平台最多绑定一份 Prompt，多个平台可以引用同一份 Prompt；内容任务不保存 Prompt 选择，生成时从任务平台解析当前绑定并校验用户刚确认的 Prompt 身份与 revision。

其余四项界面问题保持局部修改：移除旧观测字段、恢复 Drawer 原生遮罩关闭、调整两张表的列宽与长文本呈现，不新增通用布局层或自定义点击外部监听。

本任务不拆分子任务。Prompt 迁移、OpenAPI、后端生成与两个管理界面必须作为一个原子契约落地；其余界面修正较小，拆分只会增加依赖和交付成本。

## 2. Core Invariants

- `PlatformPrompt` 是可复用 system Prompt 的唯一可编辑来源。
- `PlatformProfile.platform_prompt_id` 是平台当前 Prompt 绑定的唯一来源；可空，但不能同时绑定多份。
- 一个 Prompt 可以被多个平台引用；删除引用中的 Prompt 必须被应用服务和数据库外键共同拒绝。
- 平台缺少 Prompt 不阻止内容任务或人工首稿，只阻止新的系统 AI 生成。
- 内容生产人员只能确认任务平台当前 Prompt，不能改选 Prompt；模型仍按作业选择。
- 新作业必须使用用户看到的 Prompt ID 和 revision；配置变化后旧确认失败，不自动刷新后继续提交。
- 新作业的供应商消息仍严格只有两条：`system` 等于冻结 Prompt 正文，`user` 等于冻结事实 Markdown。
- 历史观测、生成、内容、发布和审核数据不可改写。

## 3. Data Model and Migration

### 3.1 Reusable Prompt

将 `platform_prompts` 改为模板库：

```text
id UUID PRIMARY KEY
name VARCHAR(300) NOT NULL UNIQUE
template_markdown TEXT NOT NULL
revision INTEGER NOT NULL
updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

`name` 和正文由服务端去除首尾空白后校验非空。revision 继续用于乐观锁；不增加状态、版本表、变量或软删除。

`platform_profiles` 增加：

```text
platform_prompt_id UUID NULL REFERENCES platform_prompts(id) ON DELETE RESTRICT
```

不使用多对多关联表：业务关系是“多个平台引用同一 Prompt”，一个可空外键已经完整表达约束。

### 3.2 Migration `0031`

迁移顺序：

1. 将旧 `platform_prompts` 重命名为临时表。
2. 创建新的模板库表并给 `platform_profiles` 增加可空外键列。
3. 每条旧 Prompt 生成一条新模板，沿用旧 `platform_profile_id` 作为模板 UUID，保留正文、revision、操作者和时间。
4. 模板名称确定性生成为“平台名称（slug）”，利用唯一 slug 避免冲突；不按正文自动去重。
5. 原平台回绑新模板，校验旧 Prompt 数量、已回绑数量和正文哈希一致后删除临时表。

迁移后平台删除不再级联 Prompt。无平台绑定的模板由管理员显式删除。

降级只在每份模板恰好绑定一个平台且不存在未绑定模板时允许，将模板重新复制为旧一对一结构；一旦产生共享绑定或未绑定模板，降级明确失败，避免静默丢失。部署前保留 PostgreSQL 备份。

## 4. API Contract

### 4.1 Prompt Library

移除旧的 `/platform-profiles/{platform_profile_id}/prompt` CRUD，不保留双写或兼容入口。新增：

- `GET /api/v1/platform-prompts`：返回模板摘要列表。
- `POST /api/v1/platform-prompts`：创建 `name + template_markdown`。
- `GET /api/v1/platform-prompts/{platform_prompt_id}`：返回正文、revision 和全部绑定平台摘要。
- `PUT /api/v1/platform-prompts/{platform_prompt_id}`：按 `expected_revision` 更新名称和正文。
- `DELETE /api/v1/platform-prompts/{platform_prompt_id}?expected_revision=`：仅删除未被平台绑定的模板。

列表摘要包含 `id/name/revision/updated_by/updated_at/bound_platform_count`；详情增加 `template_markdown/created_at/bound_platforms`。创建、更新和删除仅允许管理员，均记录审计。

### 4.2 Platform Binding

`PlatformProfileCreate` 和 `PlatformProfileUpdate` 显式接收可空 `platform_prompt_id`；服务端验证 Prompt 存在。平台更新继续使用平台自身 `expected_revision`，绑定变化与其他平台字段在同一事务提交。

`PlatformProfile` 投影用可空 `platform_prompt` 摘要替代 `prompt_configured` 和 `prompt_updated_at` 两个平行字段。配置完整性、筛选、统计和导出均从外键是否为空实时派生。

### 4.3 Generation Confirmation

`GenerationOptions` 返回：

```text
platform_profile_id
platform_profile_name
platform_prompt {
  id
  name
  revision
  template_markdown
}
models[]
humanization_prompt_configured
```

原始生成使用独立请求：

```text
OriginalGenerationJobCreate {
  ai_model_id
  platform_prompt_id
  platform_prompt_revision
}
```

自然化继续使用只含 `ai_model_id` 的 `HumanizationJobCreate`，避免用可空字段混合两种业务契约。

新作业先按幂等键检查已有记录。对于新键，服务端依次锁定任务、平台和 Prompt，验证平台绑定与请求 ID/revision 一致，再冻结输入；不一致返回 `409 PLATFORM_PROMPT_CHANGED`。同一幂等键重复请求必须同时匹配模型和 Prompt 身份，否则返回 `IDEMPOTENCY_CONFLICT`。

## 5. Generation Snapshot Compatibility

新增 `content-markdown-v3` 快照，在 v2 字段基础上增加：

```text
platform_prompt {
  id
  name
  revision
}
```

最终 `system_message` 仍完整冻结正文，Prompt 后续修改或换绑不改变历史解释。`content-markdown-v2` 作为有限历史类型继续读取、执行原快照重试和展示；新作业只创建 v3。快照解析按明确版本分支，不添加可空猜测字段或默认值。

重试始终复制原快照，不重新读取当前平台绑定。自然化快照契约不变。

## 6. Backend Behavior

- Prompt 创建、更新、删除归 `platform_configuration` 服务所有。
- 更新 Prompt 时读取当前绑定平台并写入审计事实；前端详情使用同一权威投影展示影响范围。
- 删除前应用服务返回 `409 PLATFORM_PROMPT_IN_USE`，数据库 `RESTRICT` 外键是最终保护。
- 平台换绑记录旧、新 Prompt ID；解绑允许为 `null`。
- Prompt 名称冲突返回明确 409，revision 冲突继续返回 `REVISION_CONFLICT`。
- 配置页和生成页都不根据平台类型、历史 Prompt 或其他平台推断默认值。

## 7. Frontend Design

### 7.1 Prompt and Platform Management

- `PlatformPromptsPage` 的平台列表改为 Prompt 模板列表，继续复用现有 Markdown 编辑器和未保存草稿保护。
- 新建模板复用现有编辑工作区，只包含名称和 Markdown；编辑区展示 revision、更新时间、更新人和绑定平台。
- 已绑定模板保存前使用确认框列出受影响平台；未绑定模板可直接保存。
- 删除按钮仅用于未绑定模板；若绑定状态在提交前变化，以服务端冲突为准。
- `PlatformsPage` 的新增、编辑表单增加可清空 Prompt Select，选项来自模板库；平台列表和详情展示当前 Prompt 名称或“未绑定”。
- 删除平台的提示移除“同时删除 Prompt”，因为模板已独立存在。

### 7.2 AI Generation Modal

- 内容任务页的 AI 卡片只保留说明和“生成 AI 草稿”入口。
- 点击后打开 Modal 并加载最新 `GenerationOptions`；展示平台、Prompt 名称/revision、只读 Markdown 和模型 Select。
- 提交携带选中的模型及弹窗中确认的 Prompt ID/revision。成功后关闭弹窗、清空模型并刷新作业；配置冲突时保留弹窗并提示重新加载。
- Prompt 缺失、无可用模型或事实不可出站时在弹窗内明确显示，手工录入入口不受影响。

### 7.3 Observation and Table Fixes

- `GeoObservationsPage` 删除推荐、引用列及对应 URL 参数/筛选控件；`GeoObservationDrawer` 的旧版详情不再渲染推荐和引用，但保留其他历史字段。
- `GeoObservationDrawer` 移除 `mask={false}`，使用 Ant Drawer 原生遮罩、`maskClosable`、Escape 和关闭按钮，不实现 document 级 click-away。
- 平台表现对比给平台列增加有界宽度、ellipsis 和 Tooltip，指标列保持紧凑，横向滚动只发生在 `TableRegion`。
- 发布记录的内容标题和实际标题统一使用单行 ellipsis + Tooltip；一个标题列承担主要弹性空间，另一个保持有界宽度，操作列继续固定在右侧。

## 8. Documentation and Stable Specs

同批更新：

- `contracts/openapi.yaml`
- `contracts/database.md`
- `.trellis/spec/backend/ai-configuration-guidelines.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- `docs/GEO多平台内容运营系统方案设计.md`
- `docs/GEO系统前后端技术与部署方案.md`

文档只描述新的模板库与平台绑定，不保留旧一对一端点作为当前设计；历史迁移决策留在旧 Trellis 任务和 migration 说明中。

## 9. Risks and Rollback

- **共享修改影响扩大**：Prompt 详情和保存确认显示绑定平台，revision 冲突阻止覆盖。
- **迁移错误绑定**：沿用旧平台 UUID 作为模板 UUID并逐项计数/哈希校验，不做文本去重。
- **确认与创建竞态**：创建作业锁行并校验 Prompt ID/revision，失败后要求重新加载。
- **历史快照漂移**：v2/v3 使用显式联合读取；重试复制原快照。
- **部署回滚**：启用共享或创建未绑定模板后不允许自动降级；使用数据库备份或前滚修复。
