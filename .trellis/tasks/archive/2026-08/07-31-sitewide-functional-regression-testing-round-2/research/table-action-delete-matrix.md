# 第二轮 24 表、操作列与 13 DELETE 冻结矩阵

## 1. 清单来源

- 24 表：`frontend/tests/e2e/cross-page-visual-convergence.spec.ts` 的 `sitewideTableInventory`，当前仍为 24 项。
- 长文本：上一轮审计登记的 58 个可变长文本槽；本轮必须用当前真实浏览器重新验证，不继承旧结果。
- 操作：逐个读取当前表格列、`Dropdown`、`available_actions` 和详情入口。
- DELETE：`contracts/openapi.yaml` 当前恰好 13 个 `delete:`，位置为 206、352、427、677、794、881、961、1130、1197、1308、1634、1723、1908。

所有业务执行状态从 `NOT_RUN` 开始。

## 2. 24 张业务表与当前操作

| # | 表面 | 当前操作/入口 | 动作来源 | 状态 |
| ---: | --- | --- | --- | --- |
| 1 | 内容任务列表 | 查看详情；`CANCEL` 取消任务；`DELETE` 删除任务 | 服务端 `available_actions` | FAIL（`PS-QA-201` 共因） |
| 2 | AI 作业列表 | 打开源版本/结果；失败作业“重试原快照” | 状态 `FAILED` + 服务端重试校验 | FAIL（`PS-QA2-FUNC-001`） |
| 3 | 内容版本列表 | 打开版本；符合条件时自然化 | 前端资格投影 + 服务端最终校验 | PASS |
| 4 | 产品事实列表 | 打开产品；管理员删除 | 固定角色菜单 + 服务端最终校验 | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 5 | 事实版本列表 | 审核与历史；查看冻结正文；管理员删除 | 固定角色菜单 + review context | FAIL（`PS-QA-201` 共因、`PS-QA-202`） |
| 6 | 待发布候选 | 准备人工发布；取消待发布 | 候选账号匹配 + 任务 `available_actions` | FAIL（`PS-QA-201`） |
| 7 | 发布记录 | 查看；提交平台审核、登记已发布、验证、拒绝、移除、标记验证失败、删除未公开记录 | 服务端 `available_actions` | FAIL（`PS-QA-201` 共因、`PS-QA2-UI-002`） |
| 8 | 发布异常待办 | 处理异常/查看；详情内创建修复任务、显式解决 | 服务端 `available_actions` | FAIL（`PS-QA2-FUNC-002`） |
| 9 | GEO 观测记录 | 查看；更正；删除人工观测完整更正链 | 服务端 `available_actions` | FAIL（`PS-QA-201` 共因、`PS-QA-202`、`PS-QA2-FUNC-003`） |
| 10 | GEO 文章观测结果 | 更正表单内逐篇编辑；表内无独立行命令 | 外层观测更正合同 | PASS（专项门禁缺口见 `PS-QA2-TEST-001`） |
| 11 | GEO 问题库 | 页头新增；无行操作 | 当前 API 无删除/行编辑 | PASS |
| 12 | GEO 平台表现 | 无行操作 | 只读聚合 | PASS |
| 13 | GEO 内容排行 | 发布内容链接跳转详情 | 只读聚合 + 明确链接 | PASS |
| 14 | GEO 覆盖矩阵 | 无行操作 | 只读聚合 | PASS |
| 15 | AI 渠道列表 | 配置；测试连接；启用/停用；删除 | 固定管理员菜单 + 服务端校验 | FAIL（`PS-QA-201` 共因） |
| 16 | AI 请求 Header | 编辑；删除 | 固定管理员菜单 + 服务端校验 | FAIL（`PS-QA-201`、`PS-QA-203`） |
| 17 | AI 模型列表 | 测试；启用/停用；编辑；删除 | 固定管理员菜单 + 服务端校验 | FAIL（`PS-QA-201` 共因） |
| 18 | AI 渠道操作日志 | 无行操作 | 只读审计 | PASS |
| 19 | 全局审计日志 | 查看详情 | 固定只读入口 | FAIL（`PS-QA2-UI-002`） |
| 20 | 模型发现弹窗 | 添加；已配置项禁用 | 当前配置集合 | PASS（专项门禁缺口见 `PS-QA2-TEST-001`） |
| 21 | 平台列表 | 查看详情；编辑；启用/停用；删除；列表导出 | 固定管理员菜单 + 服务端校验 | FAIL（`PS-QA-201` 共因、`PS-QA-202`） |
| 22 | 平台类型列表 | 编辑；删除 | 固定管理员菜单 + 服务端校验 | FAIL（`PS-QA-201` 共因） |
| 23 | 发布账号列表 | 编辑；启用/停用；管理员删除 | 固定角色菜单 + 服务端校验 | FAIL（`PS-QA-201` 共因、`PS-QA-202`） |
| 24 | 用户列表 | 编辑；重置临时密码；启用/停用；删除；批量启停；导出 | 固定管理员菜单 + 服务端校验 | FAIL（`PS-QA-201` 共因） |

操作列统一口径为：显示/禁用、鼠标和键盘打开、确认、取消、加载、防重复、成功、结构化失败、query invalidation、刷新/重登和最终数据库状态。普通动作已由本节和 W0～W6 完成；13 个 DELETE 的破坏性成功、并发与数据库副作用保留到第 7 节。只读表明确验证无虚假操作，不为凑数新增动作。

### 2.1 本节执行结论

- 24 张表均在 `1440×1000` 与 `375×900` 真实浏览器中定位成功；页面级横向溢出为 0，宽表使用表内滚动，固定操作列背景稳定，可见省略文本均可键盘访问。
- 24 张表的几何与长文本表现通过；合并操作逻辑、删除文案和焦点后，表面结论为 8 `PASS`、16 `FAIL`、0 `BLOCKED`、0 `NOT_RUN`。
- 13 组可变操作菜单均以键盘打开并用 Escape 返回触发按钮；当菜单动作继续打开静态 `modal.confirm` 时，焦点恢复共因仍存在。候选、产品和 AI Header 已真实复现，其余同类调用点由源码调用链确认并合并到 `PS-QA-201`。
- 正向业务动作由同一冻结提交的 175 个前端单元测试、52 个 E2E 和 W0～W6 实测覆盖；共享环境只执行读取、打开、取消和焦点核验，未触发破坏性写入。13 个 DELETE 的逐接口成功、并发、审计和数据库副作用仍严格保留到第 7 节，不用本节结果代替。
- GEO 文章表按 `dialog .table-region[aria-label="产品文章观测结果"]` 精确验证；模型发现表仅为长文本几何使用会话内请求拦截，未点击“添加”，功能正向沿用同轮 E2E。两张弹窗表的现有通用自动化选择器可能命中背景表，登记 `PS-QA2-TEST-001`。

## 3. 58 个长文本槽分组

| 表组 | 槽位 |
| --- | --- |
| 内容生产 | 任务产品/平台、作业失败原因、内容标题、产品型号/品牌/类别、事实变更说明 |
| 发布 | 候选标题/平台/账号，记录标题/实际标题/平台/账号，异常标题/平台/账号 |
| GEO | 观测平台/问题/记录人、文章标题/平台、问题/变体、表现平台、排行内容/平台、矩阵动态表头 |
| AI/审计 | 渠道名称/描述/URL、Header 名称/值、模型显示名/ID、渠道日志动作/操作者/对象/请求 ID、全局审计同类字段、发现 model ID |
| 平台/用户 | 平台名称/类型/官网/域名/Prompt，平台类型名称/slug，账号平台/标签/标识，用户名/显示名 |

精确逐槽口径沿用归档的 `sitewide-display-audit.md`；本轮没有修改源码清单。

| 验证项 | 状态 | 本轮证据 |
| --- | --- | --- |
| 58 个已登记长文本槽 | PASS | 同轮 E2E 对可见省略单元格逐项施加超长文本压力；本节对 24 张表重新执行真实浏览器核验 |
| 桌面/窄屏边界 | PASS | 24/24 表在 1440 与 375 宽度内；`documentElement.scrollWidth === clientWidth` |
| 固定操作列 | PASS | 有操作列的宽表均保留右侧固定列，普通与 hover 状态无透明背景 |
| 表内横向滚动 | PASS | 窄屏宽表由 `.table-region` 内部滚动承载，不扩大文档宽度 |
| Tooltip/键盘可达 | PASS | 可见省略文本均位于链接、按钮或 `tabindex` 目标内；代表菜单 13/13 可用键盘开闭 |
| 真实 200% 缩放 | PASS | 同轮 `cross-page-visual-convergence.spec.ts` 的五类代表业务表通过，且本节期间提交和产品代码未变化 |

## 4. 13 个 DELETE 接口

接口专项把服务端语义与 UI/综合结论分开：API/数据库为 11 `PASS`、2 `FAIL`；Prompt 是唯一没有已知 UI 共因的入口，综合为 1 `PASS`、12 `FAIL`。UI 失败均复用已确认缺陷，不重复拆票。

| # | 路径 / operationId | 合法角色 | revision | 重点链路 | API/数据库 | UI/综合 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `/api/v1/users/{user_id}` / `deleteUser` | ADMIN | `NOT_APPLICABLE`：合同无 revision | 停用、最后管理员、业务引用、会话、审计 actor | PASS | FAIL（`PS-QA-201`） |
| 2 | `/api/v1/products/{product_id}` / `deleteProduct` | ADMIN | `NOT_APPLICABLE`：合同无 revision | 当前事实工作区、任一历史引用 | PASS | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 3 | `/api/v1/fact-versions/{fact_version_id}` / `deleteFactVersion` | ADMIN | `NOT_APPLICABLE`：合同无 revision | 审核记录、任务/内容引用、批准历史 | PASS | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 4 | `/api/v1/content-tasks/{content_task_id}` / `deleteContentTask` | ADMIN / ENGINEER | `NOT_APPLICABLE`：合同无 revision | CANCELLED、任务自有未批准历史、发布/修复来源 | PASS | FAIL（`PS-QA-201`） |
| 5 | `/api/v1/platform-accounts/{platform_account_id}` / `deletePlatformAccount` | ADMIN | `NOT_APPLICABLE`：合同无 revision | 启停、平台、发布记录引用 | PASS | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 6 | `/api/v1/publication-records/{publication_id}` / `deletePublicationRecord` | ADMIN / ENGINEER | `NOT_APPLICABLE`：合同无 revision | 公开事件、GEO/异常引用、附件与清理调度 | PASS | FAIL（`PS-QA-201`） |
| 7 | `/api/v1/geo-observations/{observation_id}` / `deleteGeoObservation` | ADMIN | `NOT_APPLICABLE`：合同无 revision | 人工完整更正链、逐篇关系、附件、模型观测禁止 | PASS | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 8 | `/api/v1/platform-types/{platform_type_id}` / `deletePlatformType` | ADMIN | `NOT_APPLICABLE`：合同无 revision | 平台引用 | PASS | FAIL（`PS-QA-201`） |
| 9 | `/api/v1/platform-prompts/{platform_prompt_id}` / `deletePlatformPrompt` | ADMIN | PASS：`expected_revision` 必需，旧值冲突 | 平台绑定、revision 冲突 | PASS | PASS |
| 10 | `/api/v1/platform-profiles/{platform_profile_id}` / `deletePlatformProfile` | ADMIN | `NOT_APPLICABLE`：合同无 revision | Prompt 不级联、任务/账号引用、历史保留 | PASS | FAIL（`PS-QA-201`、`PS-QA-202`） |
| 11 | `/api/v1/ai-channels/{channel_id}` / `deleteAIChannel` | ADMIN | `NOT_APPLICABLE`：合同无 revision | Header/模型、未执行作业、历史快照 | FAIL（`PS-QA2-DELETE-001`） | FAIL（`PS-QA2-DELETE-001`、`PS-QA-201`） |
| 12 | `/api/v1/ai-channel-headers/{header_id}` / `deleteAIChannelHeader` | ADMIN | `NOT_APPLICABLE`：合同无 revision | 敏感值、连接与模型测试状态重置、审计 | FAIL（`PS-QA2-DELETE-001`） | FAIL（`PS-QA2-DELETE-001`、`PS-QA-201`、`PS-QA-203`） |
| 13 | `/api/v1/ai-models/{model_id}` / `deleteAIModel` | ADMIN | `NOT_APPLICABLE`：合同无 revision | 启用状态、未执行作业、历史快照 | PASS | FAIL（`PS-QA-201`） |

## 5. 每个 DELETE 的统一执行列

| 维度 | 状态 | 本轮证据 |
| --- | --- | --- |
| 匿名 / 角色权限 | PASS（13/13） | 匿名均 401；工程师对允许路由进入对象级 404，其余均 403 |
| 缺失或错误 CSRF | PASS（13/13） | 缺失均 422，错误均 403 |
| 目标不存在 | PASS（13/13） | 管理员有效 CSRF 下均 404 |
| 状态/引用/历史阻断 | PASS（13/13） | 10 个定向 PostgreSQL 集成用例覆盖最后管理员、批准/公开历史、引用、平台绑定、未执行作业等边界 |
| 最小合法 204 | PASS（13/13） | 新隔离库重新运行成功探针，13 个首次删除均 204 |
| 直接重复 DELETE | PASS（13/13） | 同一会话立即重放均 404，目标行均不存在 |
| 同目标双请求 | FAIL（11/13） | 11 个为单一 204 + 单一 404；AI 渠道和 Header 均为两个 204，见 `PS-QA2-DELETE-001` |
| 数据库原子性与关联副作用 | PASS（13/13） | 最终目标行、受保护历史、级联/非级联关系、附件共享/独占清理和测试状态失效均按合同核对 |
| 审计数量、动作和脱敏 | FAIL（11/13） | 顺序删除 13/13 均为唯一成功审计且敏感值不外泄；两个 AI 并发入口各产生双份成功审计 |
| UI 文案、确认、取消、焦点、防重复 | FAIL（1/13 PASS） | Prompt 的 Popconfirm、revision、引用错误和缓存流程通过；其余入口受 `PS-QA-201`，部分另受 `PS-QA-202`/`203` 影响 |
| 页面缓存、总数、详情、刷新与重登 | PASS（13/13） | 定向 Vitest 8 文件 97/97；定向 E2E 5/5，覆盖身份删除、AI 管理与完整业务流 |

第一轮两个现有探针仅作为复用入口：

- `artifacts/full-project-acceptance/E2E-FULL-20260731-02/delete-boundary-probe.py`
- `artifacts/full-project-acceptance/E2E-FULL-20260731-02/delete-success-repeat-probe.py`

旧探针历史结果不计入本轮通过；本轮已在新的隔离数据库中重新运行，并补齐逐接口并发与 UI 证据。

### 5.1 本轮执行证据与清理

- 本轮重跑 `delete-boundary-probe.py`：13/13 组匿名、角色、CSRF 和不存在边界通过。
- 本轮重跑 `delete-success-repeat-probe.py`：13/13 首次 204、顺序重复 404、目标行不存在、唯一成功审计通过。
- 新增最小证据探针 `artifacts/full-project-acceptance/E2E-FULL-20260731-R2-01/delete-concurrency-probe.py`，只复用既有建图和精确清理逻辑；稳定发现 2 个并发偏差，不修改产品代码或现有测试。
- 定向 PostgreSQL 集成测试 10/10 通过；删除相关前端单测 8 文件、97/97 通过；`mvp-flow.spec.ts` 与 `ai-channel-management.spec.ts` 定向 E2E 5/5 通过（1.3 分钟）。
- 有效 E2E 数据库 `partsignal_e2e_20260801_48485` 与临时存储均精确删除，开发前端、Worker、Scheduler 恢复健康。本节结束查询发现 3 个零连接旧测试库；目录时间分别为 2026-07-28 11:45、2026-07-31 16:12、2026-07-31 23:15（北京时间），均早于本节执行，按“共享开发库不广泛清扫”约束未删除。
