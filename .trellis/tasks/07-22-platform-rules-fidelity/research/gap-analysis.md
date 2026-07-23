# 平台规则页调查与差异清单

## 1. 调查边界与证据

- 批准原型：`../artifacts/platform-rules-prototype-1581x995.png`，原始尺寸 1581×995，SHA-256 为 `76563a27507b169bbed2b2915842a4e076e017df03b33cdcc352e69b45c6c1bb`。
- Browser 当前基线：`../artifacts/current-platform-rules-1581x995.png`，在 2026-07-22 以 1581×995 视口读取真实 `/configuration/platform-rules`；页面已登录且返回真实数据，不是静态稿。
- 前端入口：`frontend/src/features/configuration/PlatformRulesPage.tsx`、`frontend/src/app/App.tsx`、`frontend/src/app/AppLayout.tsx`、`frontend/src/shared/api/queryOptions.ts`、`frontend/src/shared/api/queryKeys.ts`。
- 权威契约与模型：`contracts/openapi.yaml`、`contracts/database.md`、`backend/app/models/configuration.py`、`backend/app/schemas/configuration.py`。
- 状态命令：`backend/app/services/content_planning.py` 的 `create_platform_profile_version`、`update_platform_profile_version`、`activate_platform_profile_version`、`retire_platform_profile_version`。
- 删除与聚合：`backend/app/services/platform_configuration.py` 的 `delete_platform_profile_version` 及现有平台投影。
- 引用链：`ContentTask.platform_profile_version_id` 直接锁定规则版本；发布和 GEO 历史经 `ContentVersion → ContentTask` 间接引用，不另存第二个规则版本 ID。
- 审计：`AuditLog` 是追加式事实；通用 `/api/v1/audit-logs` 支持 `target_type`、`target_id` 分页过滤。
- 既有验证：`backend/tests/integration/test_publication_review_closure.py`、`backend/tests/integration/test_migrations.py`、`frontend/src/features/configuration/ConfigurationPages.test.tsx`、`frontend/tests/e2e/mvp-flow.spec.ts`。

工作区在调查开始前已有大量未提交改动，包含平台管理、GEO、AI 渠道和平台规则 URL 筛选。后续实施只能编辑本任务必要 hunk，不得清理、回退或整文件覆盖这些改动。

## 2. 当前真实能力

### 2.1 已存在且可直接复用

- 配置中心管理员路由、侧栏、顶栏、全局搜索、主题、用户菜单和页面权限守卫。
- 平台列表、具体平台 Logo/名称、平台规则版本全量或按平台读取。
- 规则字段：目标受众、标题最短/最长、正文最短/最长、语气、是否允许外链、是否允许表格、是否允许联系方式、禁用表达、栏目名称与 URL。
- DRAFT 创建、按 `expected_revision` 编辑、激活、直接退役和物理删除服务端命令；写操作沿用管理员权限、CSRF、行锁、修订冲突和审计。
- 每个平台数据库部分唯一索引 `uq_platform_profile_versions_one_active`，保证最多一个 ACTIVE 版本。
- 内容任务在创建时锁定当时 ACTIVE 规则版本；规则后续切换不改写任务、生成快照、内容版本、发布记录或 GEO 历史。
- `PageHeader`、`AsyncState`、`StatusTag`、`PlatformAvatar`、Ant Design Modal/Drawer/Dropdown/Form 和现有语义 Token。

### 2.2 当前状态机与删除矩阵

| 当前状态 | 编辑 | 激活 | 直接退役 | 物理删除 |
|---|---:|---:|---:|---:|
| DRAFT | 是，需 revision | 是，需 revision | 是，需 revision | 无内容任务引用时允许 |
| ACTIVE | 否，正文冻结 | 否 | 否；只能激活替代 DRAFT 时自动退役 | 无内容任务引用时允许，平台可进入无有效规则 |
| RETIRED | 否，正文冻结 | 否 | 否 | 无内容任务引用时允许 |

激活替代版本会先把原 ACTIVE 改成 RETIRED，再激活目标 DRAFT，且两步同事务。当前实现只给新版本追加 `platform_profile_version.activated` 审计，没有给被替换旧版本追加退役事件，因此旧版本自己的时间线看不到“被替换退役”。

### 2.3 当前规则页

- 页面只有标题、新增草稿按钮、一个平台下拉筛选和全宽表格。
- 表格只展示平台、版本、状态、目标受众、正文范围、创建时间和更多菜单。
- 新增/编辑使用 760px Modal；只有 DRAFT 显示编辑按钮；更多菜单只有物理删除。
- 激活仍在平台管理页执行；规则页没有激活、直接退役、差异查看、详情区、影响摘要、审计时间线或引用详情。
- 已有未提交改动把 `platform_profile_id` 写入 URL，并按平台调用既有版本接口；该能力必须保留并纳入新工作台状态模型。

## 3. 原型与现状差异

| 区域/能力 | 原型 | 当前实现 | 分类与结论 |
|---|---|---|---|
| 页面骨架 | 平台列表、版本列表、规则详情、右侧信息栏四列 | 单筛选 + 全宽表格 | 前端高保真重构 |
| 平台检索 | 名称搜索、状态筛选、版本数、选中态 | 单下拉选择 | 复用平台集合；搜索/平台启停状态由服务端现有查询负责 |
| 版本卡片 | 状态、创建人、时间、摘要、引用数 | 表格基础列 | 创建人/激活时间来自审计；引用数需服务端批量投影；不得编造摘要 |
| 规则正文 | 图标化键值行 | 仅在编辑 Modal 中可见 | 现有规则 JSON 可直接渲染只读详情 |
| 查看差异 | 明确按钮 | 无 | 前端对同一平台两个权威规则 JSON 做字段级比较，无需新增差异存储 |
| 版本元数据 | 当前状态、版本、创建人、创建/激活时间、描述、引用 | 只返回创建时间 | 新增只读详情投影；描述不具备来源，推荐显示自动差异摘要 |
| 影响摘要 | 绑定任务及未发布/审核中/已发布数量 | 无 | 必须服务端实时聚合；状态口径需评审确认 |
| 变更历史 | 创建、更新、激活时间线 | 通用审计 API 可查，但旧 ACTIVE 自动退役无事件 | 复用审计 API并补齐自动退役审计 |
| 退役 | 原型在 ACTIVE 详情显示“退役此版本” | 服务端禁止 ACTIVE 直接退役 | 原型与权威状态机冲突；本期已确认保持现有状态机 |
| 删除 | 原型活动版本删除按钮禁用 | 服务端允许删除无引用 ACTIVE | 前端必须服从服务端可用动作，不能照抄禁用状态 |
| 引用详情 | “查看引用详情” | 任务列表仅支持按平台筛选的在途改动 | 新增精确 `platform_profile_version_id` 服务端筛选和 URL 入口 |
| 移动端 | 原型无移动稿 | 当前表格横向滚动 | 采用平台→版本→详情分步布局，右侧信息用 Drawer，不做四列压缩 |

## 4. 原型字段与权威契约对照

| 原型语义 | 权威来源 | 结论 |
|---|---|---|
| 目标读者 | `target_audience` | 已支持 |
| 标题长度建议 | `title_min` / `title_max` | 已支持 |
| 正文最短和最长长度 | `body_min` / `body_max` | 已支持 |
| 支持的内容格式 | 无；`ContentTask.desired_format` 是任务级字段 | 不得误用任务字段，本期不扩展 |
| 是否允许外链 | `allow_external_links` | 已支持 |
| 是否允许表格 | `allow_tables` | 已支持 |
| 是否允许联系方式 | `allow_contact` | 已支持 |
| 品牌露出要求 | 无 | 本期不扩展 |
| 内容语气 | `tone` | 已支持 |
| 内容角度 | 无；`ContentTask.content_angle` 是任务级字段 | 不得误用任务字段，本期不扩展 |
| CTA 要求 | 无；`ContentTask.conversion_goal` 是任务级字段 | 不得误用任务字段，本期不扩展 |
| 禁用表达 | `prohibited_phrases` | 已支持 |
| 可用栏目与栏目地址 | `sections[]` | 已支持 |
| 运营注意事项 | 无 | 本期不扩展 |

用户已确认本任务按现有权威规则字段完成闭环，不增加五类缺少定义的字段。原因不是视觉取舍，而是这些字段缺少类型、必填性、默认值、验证规则、生成消费方和历史迁移语义；直接加入会把不确定性编码为业务契约。

## 5. 服务端必须拥有的新投影

- 版本列表项的 `reference_count`，必须批量按 `ContentTask.platform_profile_version_id` 聚合，禁止每张卡逐条查询或前端下载全部任务计数。
- 单版本详情的创建人、最后更新时间、激活时间、引用影响摘要和 `available_actions`；审计缺失或演员已删除时使用契约化 `null`，不得猜名称或时间。
- 影响摘要必须对每个引用任务只计一次，并把任务放入一个且仅一个展示桶；总数必须等于三个桶之和。
- 内容任务的 `platform_profile_version_id` 可选过滤；该参数与已有 `platform_profile_id` 同时出现时按 AND 处理，省略时保持现有全量语义。
- 激活替代版本时为旧版本追加明确的自动退役审计，记录替代版本稳定 ID；不得改写既有审计。

## 6. 前端可独立负责的派生

- 同一平台两个已加载规则 JSON 的字段级差异、差异项数量和原值/新值展示。规则结构由 OpenAPI 生成类型约束，不引入通用 JSON diff 库。
- 状态、动作、审计 action 的中文显示和图标；动作是否可见仍以服务端 `available_actions` 为准。
- URL 拥有平台、版本、搜索和筛选状态；React Query 拥有集合、详情、审计和引用服务端状态；表单/弹窗开关留在局部状态。
- 1581×995 高保真布局和移动端分步降级；不得把原型数字、姓名、时间或说明文字写入种子或组件常量。

## 7. 测试与文档缺口

- 缺少规则字段范围边界、空列表、版本多于一页、创建/更新/激活/退役/删除完整前端闭环测试。
- 缺少激活并发、自动退役审计、每个平台唯一 ACTIVE 和失败回滚的集中验证。
- 缺少列表引用批量聚合、影响分桶、任务精确过滤和 `available_actions` 测试。
- 缺少差异查看、URL 恢复、关联入口、焦点归还、移动 Drawer 与视觉基线检查。
- `docs/GEO多平台内容运营系统方案设计.md` 仍有“平台类型固定五种”的旧描述，与当前动态平台类型契约冲突；本任务触及平台规则说明时应一并改写为当前事实。

## 8. 与并行任务的边界

- `07-13-configuration-center-navigation` 只负责独立路由和导航，不改变规则版本生命周期。
- `07-22-platform-management-fidelity` 负责平台管理页、平台启停、平台详情及跳转入口；本任务复用其平台集合契约，不重复实现平台管理查询、状态或详情。
- 本任务拥有平台规则工作台、规则版本详情/影响/引用投影、规则状态操作入口、规则差异和高保真验收；如实施时并行任务尚未完成，必须基于当前合并后的真实契约调整 hunk，不能创建兼容字段或第二套接口。
