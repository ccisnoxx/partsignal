# 技术设计

## 1. 最小可行设计

本任务不建设新的配置框架或国际化系统，只调整现有模块的权威关系：

```text
PlatformType 1 ── N PlatformProfile 1 ── 0..1 PlatformPrompt
                                  └── N PlatformProfileVersion
```

- `PlatformType` 只负责分类。
- `PlatformProfile` 是具体平台及当前 Prompt 的唯一所有者。
- `PlatformProfileVersion` 继续保存不可变平台规则。
- `GenerationJob.input_snapshot` 是某次生成实际使用的平台、Prompt、模型和输入的历史权威。
- PostgreSQL 外键和服务层预检共同约束物理删除；前端只呈现结果，不复制权限或引用判断。

本轮继续使用当前“选择具体平台后单次生成完整内容”的流程，不实现方案文档中尚未落地的固定五类、`TYPE_BASE` 或二次平台适配。

## 2. 任务边界与顺序

1. `07-16-configuration-hierarchy-cards` 先改变 Prompt 所有权和跨层契约，并完成配置页面、生成读取和渠道卡片。
2. `07-16-controlled-physical-deletion` 基于新关系补齐受约束删除，不反向修改 Prompt 所有权。
3. `07-16-frontend-chinese-localization` 最后扫描最终页面，避免在旧页面上重复修改。
4. 父任务更新两份 GEO 方案文档和相关 Trellis 规范，执行完整集成验收。

现有 `07-13-configuration-center-navigation` 的已提交二级路由、独立渠道详情页和获取模型弹窗作为基线复用；不恢复旧 Tabs 或渠道详情 Modal，也不修改该任务资料。

## 3. 数据库设计

### 3.1 Prompt 所有权迁移

新增 Alembic revision `0014`，直接替换 `platform_prompts` 的所有权：

```text
旧：platform_prompts.platform_type_id  PK/FK -> platform_types.id
新：platform_prompts.platform_profile_id PK/FK -> platform_profiles.id ON DELETE CASCADE
```

迁移使用新表复制，避免在无主键窗口内原地改列：

1. 创建临时新表，字段为 `platform_profile_id`、Markdown、revision、维护人和时间。
2. 通过 `platform_profiles.platform_type_id = 旧 platform_prompts.platform_type_id` 把旧 Prompt 复制给该类型下的每个平台。
3. 没有具体平台的旧 Prompt 不产生新行，按已确认的开发阶段策略删除。
4. 删除旧表并把新表改为正式表名。
5. 不保留旧列、旧表、双写或兼容读取。

新结构允许同类型的不同平台随后独立覆盖 Prompt。迁移不可无损降级，因为多个平台 Prompt 可能已经分化；回滚依赖迁移前 PostgreSQL 备份，不实现猜测式合并。

### 3.2 平台无有效规则

数据库本身不要求每个平台永久存在 `ACTIVE PlatformProfileVersion`。删除未引用的 `ACTIVE` 版本后：

- `PlatformProfile` 保留。
- API 的 `active_version` 返回 `null`。
- 管理员仍可创建并激活新规则版本。
- 工程师创建内容任务时被服务端拒绝，直到同时存在 `ACTIVE` 规则和当前 Prompt。

### 3.3 历史快照兼容

旧 `GenerationJob.input_snapshot` 不可修改。新作业在既有 `platform_type` 外增加具体平台身份：

```json
{
  "platform_profile": {
    "id": "...",
    "name": "知乎",
    "slug": "zhihu",
    "platform_profile_version_id": "...",
    "platform_profile_version": 3
  }
}
```

读取 Schema 允许旧快照缺少 `platform_profile`，这是对已存在不可变历史的明确多版本兼容；新建作业服务必须始终写入该字段。Prompt 正文继续通过最终 `system_message` 冻结，不新增 Prompt 版本表或独立 Prompt 快照列。

## 4. API 契约

### 4.1 平台与 Prompt

保留平台类型 CRUD，移除平台类型下的 Prompt 路径，新增：

```text
GET    /api/v1/platform-profiles/{platform_profile_id}/prompt
PUT    /api/v1/platform-profiles/{platform_profile_id}/prompt
DELETE /api/v1/platform-profiles/{platform_profile_id}/prompt
```

`PlatformPrompt` 用 `platform_profile_id` 替代 `platform_type_id`。`PlatformProfile` 调整为：

- `active_version: PlatformProfileVersion | null`
- `prompt_configured: boolean`

不新增 Prompt 列表接口。`Prompt 管理` 页面复用一次平台列表请求展示所有平台及配置状态，只在管理员打开某一行编辑时读取该平台 Prompt。

### 4.2 内容任务与生成

- 创建内容任务仍提交 `platform_profile_version_id`。
- 服务端从规则版本解析具体平台，并要求该平台同时存在当前 Prompt；缺失时返回 `PLATFORM_PROMPT_MISSING`。
- 平台没有 `ACTIVE` 规则时返回 `INVALID_STATE_TRANSITION`，不得由前端选择其他版本兜底。
- `GenerationOptions` 和 `build_generation_input()` 都按具体平台读取 Prompt。
- 每次创建作业时写入具体平台身份、平台规则、最终 system/user message 和 Prompt 内容结果；后续配置变化不改写作业。
- Prompt 删除后，已有作业仍可读取；尚未创建作业的任务再次生成会明确失败，直到管理员重新配置 Prompt。

### 4.3 AI 渠道摘要

`AIChannel` 响应增加只读 `enabled_models`：

```yaml
enabled_models:
  - display_name: 内容生成模型
    model_id: provider-model-id
```

它只包含当前 `is_enabled=true` 的模型，不包含参数、凭据或测试错误。后端通过 ORM `selectin` 或一次批量查询加载模型，前端只发送一次 `/ai-channels` 请求，禁止逐渠道请求模型列表。

### 4.4 物理删除

新增或完善管理员接口：

```text
DELETE /api/v1/products/{product_id}
DELETE /api/v1/platform-profile-versions/{platform_profile_version_id}
DELETE /api/v1/platform-profiles/{platform_profile_id}
DELETE /api/v1/platform-accounts/{platform_account_id}
DELETE /api/v1/platform-types/{platform_type_id}       # 既有接口，统一冲突详情
DELETE /api/v1/platform-profiles/{platform_profile_id}/prompt
```

删除服务先锁定目标行，再在同一事务中统计直接阻断引用。冲突统一返回 `409` 和稳定结构：

```json
{
  "error": {
    "code": "PRODUCT_IN_USE",
    "message": "产品仍被以下历史对象引用：事实版本（2）、内容任务（1）",
    "details": {
      "references": [
        {"type": "FACT_VERSION", "count": 2},
        {"type": "CONTENT_TASK", "count": 1}
      ]
    }
  }
}
```

只报告真实直接引用，不递归猜测整条业务链。引用类型和数量为空时才执行删除并追加审计：

- 产品：检查 `FactVersion`、`ContentTask`、`GeoObservation`；当前事实工作区子表由既有 `ON DELETE CASCADE` 清理。
- 平台规则版本：检查 `ContentTask`；包括未引用的 `ACTIVE` 版本在内均可删除。
- 具体平台：检查规则版本和平台账号；当前 Prompt 是平台拥有的可变配置，随平台删除。
- 平台账号：检查 `PublicationRecord`。
- 平台类型：检查具体平台；历史任务的类型外键沿用既有 `SET NULL` 和快照。
- Prompt：直接删除当前配置；历史作业只读快照不受影响。

所有接口使用 `AdminUser`，工程师直接请求返回权限错误。数据库 `RESTRICT` 仍是最终防线，但不能用首个 `IntegrityError` 替代完整引用诊断。

## 5. 前端信息架构

配置中心并列路由：

```text
/configuration/ai              AI 配置
/configuration/platform-types  平台类型
/configuration/platforms       平台管理
/configuration/prompts         Prompt 管理
/configuration/audit           审计日志
```

- `PlatformTypesPage` 只管理类型，不再读取或编辑 Prompt。
- `PlatformsPage` 管理平台身份、所属类型、允许域名和不可变规则版本；`active_version=null` 显示“无有效规则”。
- 新 `PlatformPromptsPage` 按平台列出类型、Prompt 配置状态和维护操作；编辑框仍是普通 Markdown TextArea。
- 内容任务平台选项保留不可用平台的中文原因，或只展示可用平台；服务端仍执行最终校验。
- 路由动态 import 继续只由 `routeLoaders.ts` 所有，预取和导航同步增加 Prompt 页面。

## 6. AI 渠道卡片视觉

复用现有 Ant Design、CSS 变量和浅/深色主题，不引入新组件库、字体或第二套 Token。卡片采用清晰的四段结构：

1. 名称、图标和启停状态。
2. API 根地址。
3. 超时、API Key、Header 数量等紧凑指标。
4. “已启用模型”区域，完整展示显示名和 `model_id` 的可换行标签；空状态显示“暂无启用模型”。

卡片本身继续链接详情页，启停和删除留在 Card actions。样式采用稳定边框、清晰分区和轻量 hover，不使用装饰性渐变、夸张阴影或模型展开状态。375/768/1024/1440 宽度和浅/深色都必须无页面级横向滚动。

## 7. 全站中文化

项目只面向中文运营后台，不引入 i18n 依赖或语言切换框架。处理原则：

- 页眉 eyebrow、状态、业务枚举、表单标签、提示、校验和空状态使用中文。
- 后端枚举值、API 字段和值保持不变，Select 使用 `{value, label}` 映射。
- `model_id`、API Key、URL、Markdown、JSON、Header、Prompt 等技术术语保留；`slug` 等不直观字段显示为“唯一标识（slug）”。
- 复用并补全现有 `StatusTag`；只在确有多个消费者时提取共享枚举标签，页面专属枚举留在对应 feature，避免建立无边界翻译字典。
- `PARTSIGNAL`、产品型号、品牌、渠道名和供应商返回值属于标识或业务数据，不翻译。

## 8. 安全、并发与审计

- 删除、Prompt 覆盖和平台状态变化全部使用服务端管理员鉴权和 CSRF。
- 可变平台类型、平台和 Prompt 保持 revision 乐观锁；删除目标先锁行，避免检查后被并发引用。
- Prompt 正文不写审计 details；审计只记录对象、动作和 revision。
- AI 凭据、敏感 Header 和既有网络边界不变。
- 不新增静默默认 Prompt、自动选择平台/模型或兼容旧 Prompt API。

## 9. 发布与回滚

- 迁移 `0014` 与读取新 Prompt 所有权的应用必须同一发布窗口部署。
- 迁移前必须备份 PostgreSQL；旧应用不能在新表结构上继续写 Prompt。
- 应用回滚需要同时恢复迁移前数据库备份，不执行有损 downgrade。
- 工作区存在大量与本任务无关的视觉基线改动；实现和提交必须按精确路径隔离，不覆盖、暂存或提交这些文件。

## 10. 验证策略

- 契约：OpenAPI 校验、FastAPI 语义比对、前端生成类型无漂移。
- 迁移：旧类型 Prompt 向同类型多个平台复制、孤立 Prompt 删除、迁移后约束与不可降级行为。
- 后端：管理员/工程师权限、全部删除引用矩阵、平台可用性、按平台读取 Prompt、作业快照不漂移、渠道模型摘要。
- 前端：三个并列配置入口、无规则/无 Prompt 状态、Prompt 编辑、受约束删除提示、渠道卡片全部模型、中文枚举。
- E2E：管理员配置平台与 Prompt、工程师选择可用平台生成；管理员删除未引用对象及引用冲突；普通工程师无删除入口。
- 回归：AI 安全、严格生成解析、发布历史、主题、响应式、路由预取和现有配置中心流程。
