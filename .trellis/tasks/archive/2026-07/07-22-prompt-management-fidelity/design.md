# 配置中心 Prompt 管理高保真复刻与功能闭环：技术设计

## 1. 最小可行设计

只改造现有 `/configuration/prompts`，继续由 PostgreSQL 当前 Prompt 行和不可变生成作业快照分别拥有“当前配置”和“历史解释”。页面复用现有平台集合、用户列表、生成选项、生成/自然化作业与内容版本端点；不新增预览服务、数据库表、队列、Provider 抽象、全局 Store 或编辑器依赖。

必需的公共契约变化只有两项：

1. `PlatformProfile` 增加可空 `prompt_updated_at`，由列表批量投影当前 `platform_prompts.updated_at`，满足平台列表真实更新时间展示。
2. 平台 Prompt DELETE 增加必填查询参数 `expected_revision`，服务端锁定当前行后校验再删除，补齐现有并发覆盖风险。

输出预览不是新 API：它创建现有 `GENERATE | HUMANIZE` 作业并读取成功后的不可变 `ContentVersion`。

## 2. 不变量与所有权

| 概念 | 唯一权威 | 设计约束 |
|---|---|---|
| 当前平台 Prompt | `platform_prompts.platform_profile_id` | 每个具体平台零或一行；管理员可创建、revision 更新、revision 删除 |
| 当前自然化 Prompt | `content_humanization_prompts.id=1` | 管理员首次创建或 revision 更新；不删除、不复制 |
| 固定系统/自然化契约 | `backend/app/services/generation.py` 常量 | 不暴露编辑入口；始终先于可编辑 Prompt |
| 平台规则 | 当前 ACTIVE `PlatformProfileVersion.rules` | Prompt 页面只读展示状态/输出长度并链接规则页 |
| 预览输入 | 已存在的 `ContentTask`、事实快照、源内容版本 | 不构造示例问题，不猜产品事实 |
| 预览执行 | `GenerationJob` | PostgreSQL 状态唯一；Redis 只传 Job UUID；失败不回退 |
| 预览结果 | 不可变 `ContentVersion` | 只读、安全渲染；仍是 DRAFT，不等于批准事实 |
| 历史解释 | `GenerationJob.input_snapshot` | Prompt 更新/删除不修改旧作业，重试复制旧快照 |

原始生成组合顺序保持 `FIXED_SYSTEM_CONTRACT → platform Prompt`，用户消息保持 `工程师 Prompt → 批准事实 → 任务要求`。自然化保持 `FIXED_SYSTEM_CONTRACT → HUMANIZATION_FIXED_CONTRACT → global Prompt`，用户消息只含冻结源文章、批准事实和任务要求。

## 3. 公共契约与后端设计

### 3.1 平台列表 Prompt 时间

`PlatformProfile.prompt_updated_at: datetime | null` 为必返可空字段：

- `null` 表示当前没有平台 Prompt；
- 非空值直接来自当前 `PlatformPrompt.updated_at`；
- 不复用平台自身 `updated_at`，不读取审计时间猜测；
- `platform_profiles_out()` 在现有批量投影中一次查询 `platform_profile_id, updated_at`，同时派生 `prompt_configured`，不产生 N+1。

`PlatformProfileDetail.prompt_updated_at` 继续保留，值与 `profile.prompt_updated_at` 相同；详情查询不再单独读取 Prompt 行，避免两个计算口径。

### 3.2 revision 删除

`DELETE /api/v1/platform-profiles/{platform_profile_id}/prompt?expected_revision=<int>`：

1. 路由仍要求 `AdminUser + CsrfProtected`，查询参数必须为非负整数。
2. 服务锁定 Prompt 行；不存在返回既有 404。
3. revision 不匹配返回 `409 REVISION_CONFLICT`，不删除、不审计成功。
4. 匹配后物理删除当前行并追加既有 `platform_prompt.deleted` 审计；审计详情记录被删除 revision，不记录正文。
5. 不提供兼容的无 revision 删除路径；前端生成类型和全部调用点同步更新。

数据库结构不变，无 Alembic 迁移。

### 3.3 保存输入边界

保留当前 Pydantic 字符串类型、`min_length=1`、service `strip()` 后非空校验和 JSON UTF-8 解析；部署已有 10 MiB 请求体上限。仓库没有批准的 Prompt 业务最大字符数，因此不添加猜测上限。若未来需要更小业务上限，应单独批准并同步 OpenAPI/服务/前端计数，而不是静默截断。

## 4. 前端结构

### 4.1 文件职责

- `PlatformPromptsPage.tsx`：页面查询参数、平台/自然化标签、Prompt 查询与 mutation、dirty 离开协调、平台列表和安全摘要组合。
- `PromptMarkdownEditor.tsx`（新增）：受控 Markdown textarea、行号滚动同步、字数/行数、保存状态、保存/删除按钮；不拥有服务端查询。
- `PromptOutputPreview.tsx`（新增）：真实任务/源版本/模型选择、作业创建与轮询、内容版本读取、安全 Markdown 和全屏展示。
- `global.css`：只新增 `prompt-management-*` 作用域样式并消费现有语义 Token。

不再保留新增/编辑 Prompt Modal；平台未配置时同一编辑区进入首次保存状态。安全说明保持在页面中，不抽取无复用价值的薄组件。

### 4.2 状态所有权

| 状态 | 所有者 |
|---|---|
| `tab`, `q`, `platform_type_id`, `page`, `page_size`, `platform_profile_id` | React Router 查询参数 |
| 平台、Prompt、用户、任务、版本、作业、内容版本 | TanStack Query |
| Markdown 草稿、服务端基线、dirty/save 状态 | `PlatformPromptsPage` 页面本地状态 |
| 预览任务、源版本、模型、当前预览 Job | `PromptOutputPreview` 本地状态 |
| 主题、身份、权限 | 现有 Provider |

不新增全局 Store。Tab 默认 `platform`，页码默认 1，页大小固定使用现有允许值 10；未知 Tab/非法正整数用 `replace` 规范化。搜索更新 URL，查询使用 deferred 值；筛选变化把页码重置为 1。

平台标签页首次有结果且 URL 无选择时，沿用现有工作台约定把首项写入 URL；URL 指向当前筛选结果外的平台时显示明确错误并保留用户筛选，不私自选择另一个平台。平台未配置 Prompt 仍可选。

全局自然化标签页没有平台所有权，平台列表隐藏，编辑区占据左/中两栏；保留右侧预览和安全说明。

### 4.3 Markdown 编辑与离开保护

- 服务端数据到达或 revision 变化时设置 `baseline` 和 `draft`；只有明确重新加载才覆盖本地草稿。
- dirty 使用 `draft !== baseline`；保存中、失败、冲突和已保存使用显式状态，不从按钮 loading 猜测。
- 行号由换行数派生，独立 gutter 与 textarea 同步 `scrollTop`；字数统计去除空白后的 Unicode code point，行数按换行计算。
- 平台预计输出长度读取当前 `active_version.rules.body_min/body_max`；无 ACTIVE 规则时显示“未配置有效规则”。自然化不虚构长度，显示“沿用源任务长度约束”。
- 平台/Tab 切换先打开确认；应用内路由链接由页面捕获后确认，浏览器刷新/关闭使用 beforeunload。取消保持草稿，确认会清除该身份的本地草稿后再执行导航，避免返回时复活已放弃内容。
- dirty 时禁止创建预览并提示先保存；既有预览仍标注为历史作业结果，不因当前草稿变化而改写。

## 5. 真实输出预览数据流

### 5.1 平台 Prompt

```text
当前 platform_profile_id
  → GET /content-tasks?platform_profile_id=...
  → 前端列出 OPEN + PUBLIC + 非空 user_prompt 的明显合格候选
  → GET /content-tasks/{task_id}/generation-options
  → 用户选择服务端返回的可用模型
  → POST /content-tasks/{task_id}/generation-jobs（新 Idempotency-Key）
  → GET /content-tasks/{task_id}/generation-jobs 每 2 秒轮询并按 job_id 定位至终态
  → SUCCEEDED 时 GET /content-versions/{content_version_id}
  → 安全只读展示真实 DRAFT
```

任务绑定平台、批准事实、全部 Evidence PUBLIC、任务状态、当前 Prompt、渠道/模型状态仍由创建作业服务最终校验。前端筛选只改善可用性，不构成安全边界。

### 5.2 全局自然化 Prompt

```text
GET /content-tasks
  → 选择 OPEN + PUBLIC 任务
  → GET /content-tasks/{task_id}/content-versions
  → 选择 source_type=AI 且 status=DRAFT|CHANGES_REQUESTED 的源版本
  → GET /content-tasks/{task_id}/generation-options
  → 选择服务端返回的可用模型
  → POST /content-versions/{source_id}/humanization-jobs（新 Idempotency-Key）
  → 轮询任务 Job 列表并按 job_id 定位 → 读取新 ContentVersion → 安全只读展示
```

同源已有活动作业、Prompt 未配置、源版本失效、分类或事实不合规等均使用现有明确错误；不自动选择另一源版本或模型。

预览不得请求 `GET /generation-jobs/{generation_job_id}`：该现有管理/追溯响应包含完整 `input_snapshot`，不符合预览“只返回状态与结果”的最小暴露边界。任务级 Job 列表只返回状态、脱敏错误摘要和 `content_version_id`，足以完成轮询。

### 5.3 展示与全屏

输出区展示真实 `ContentVersion.title`、`summary`、`body_markdown` 和 `tags`，并显示 Job 状态、创建时间及“AI 草稿”标识。原型 CloudFlow 的“示例问题/结论/详细回答/来源”只是布局证据，不进入产品文案；这是已批准的功能性差异。

Markdown 使用现有 `marked.parse` 后 `DOMPurify.sanitize`，链接保留浏览器安全属性。全屏使用 Ant Modal 复用同一 sanitized HTML，不维护第二份预览正文。

## 6. 视觉、响应式与可访问性

- 原始视口 1581×995；复用现有 178px 应用侧栏和约 58–64px 顶栏。
- 平台标签页主区按约 324 / 648 / 386px 三栏，间隙 10–12px；使用 `minmax()` 维持中栏优先，卡片半透明冷白、低对比边框和现有蓝紫主操作。
- 编辑器、平台列表、输出预览分别内部滚动；页面不产生横向滚动。工具栏和底部统计固定在各自面板边界。
- 1200px 以下改为纵向工作台；767px 以下沿用配置中心 58px 顶栏，平台列表、编辑器、预览/安全说明按顺序堆叠，危险操作仍有确认。
- 控件使用显式 label/aria-label，可见焦点沿用主题 focus ring；Tab、分页、Modal、Popconfirm 和 Select 继续使用 Ant Design 键盘语义。
- `prefers-reduced-motion` 沿用全局规则，不新增装饰动画。

## 7. 错误与恢复矩阵

| 条件 | 页面行为 |
|---|---|
| 平台/用户主查询失败 | 对应区域 `QueryFailure` + 重试，不伪造空数组 |
| Prompt 404 | 同一编辑区显示未配置和首次保存 |
| PUT 409 | 保留草稿，显示服务端已变化，提供“重新加载当前值” |
| DELETE 409 | 保留正文和选择，要求重新加载后再次确认 |
| 无合格任务/源版本/模型 | 预览区明确空态和真实配置/任务入口，不自动补值 |
| Job PENDING/RUNNING | 展示状态并轮询，不创建第二作业 |
| Job FAILED | 展示脱敏 `error_code/error_summary` 和重新显式生成入口，不自动重试 |
| Job SUCCEEDED 但内容读取失败 | 保留 Job 身份并允许重试读取，不能显示空成功 |
| 403/CSRF | 通用错误明确展示；前端隐藏不是权限控制 |

## 8. 兼容、发布与回滚

- API 变化是同仓前后端同步升级：`prompt_updated_at` 为新增必返可空字段；DELETE 的 `expected_revision` 是有意的破坏性收紧，所有仓内调用必须同批更新，不保留旧删除路径。
- 无数据库迁移和数据重写，既有 Prompt、Job、ContentVersion 与审计历史不变。
- 回滚前端可恢复旧页面；回滚后端/契约必须同时恢复旧前端删除调用。任何回滚都不删除已由预览创建的真实草稿，因为它们是合法历史作业。
- 实施时工作区已有大量用户改动，必须只在当前最新文件上增量修改，逐文件检查 diff，不覆盖平台管理、规则、AI 渠道或 GEO 任务成果。

## 9. 文档与测试边界

同步更新 `contracts/openapi.yaml`、生成类型、`contracts/database.md`、AI 配置/生成 spec 和两份系统方案文档中 Prompt 删除并发、列表投影及“预览即真实作业”的当前设计。测试覆盖契约、权限、CSRF、revision 删除、批量 Prompt 时间、dirty 状态、URL 恢复、安全渲染、两类预览成功/失败与 Browser fidelity；不为已由既有生成测试充分覆盖的底层模型客户端再建平行测试套件。
