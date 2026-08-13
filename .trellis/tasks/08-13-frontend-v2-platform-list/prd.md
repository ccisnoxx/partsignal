# Frontend V2 Phase 6.1 — Platform List

## 目标

实现 Frontend V2 的 `/settings/platforms`，让所有已认证用户通过服务端权威的分页列表查看、搜索和筛选平台；管理员再从服务端投影的 Primary、overflow、删除条件和 revision 执行平台管理动作。

本轮只完成审计和规划。计划批准后才创建 `codex/frontend-v2-platform-list`，且在业务实现、验证和提交确认前不提交、不合并、不 push。

## 已确认事实与 gap

- 当前 V2 没有 `/settings` route、平台列表 Domain、导航入口或相关测试；App Shell 已能通过 route metadata 同时驱动桌面/移动导航和 breadcrumb。
- 现有 `GET /api/v1/platform-profiles` 已支持服务端搜索、类型/启停/Prompt 完整度筛选、成对分页、filtered `total`、不受筛选影响的全局 `summary`、`lower(name), id` 稳定排序和固定次数批量投影；不需要新建 V2 endpoint。
- 现有 `PlatformConfigurationStatus = COMPLETE | INCOMPLETE` 与 `configuration_complete` 只表达是否绑定 Prompt，不能表达蓝图要求的“完整 / 缺 Prompt / 缺账号”。Prompt 缺失与零启用账号允许同时存在。
- 现有 `platform_account_count` 统计全部账号，不能标为“N 个可用”；系统内“可用账号”的既有权威口径是启用账号。
- 普通已认证用户可以读取平台列表，但 `/api/v1/platform-types` 仅管理员可读；当前列表响应没有稳定、完整且适合普通用户的平台类型 options。
- 管理员获得 `available_actions` 与 `deletion`；普通用户获得空动作和 `deletion=null`。当前 `primary_task` 尚未按 actor 投影，普通用户仍可能收到管理型 Primary。
- UPDATE、ENABLE、DISABLE 已使用平台 `revision`，DELETE 尚未接收 `expected_revision`；删除写命令会在锁内复核启停状态和实时 blocker。
- 旧 V1 平台页仍调用同一 DELETE。若将 `expected_revision` 收紧为必填，必须同步修改该调用点；这与本任务“旧 frontend 不修改”的字面排除项冲突，不能靠 optional revision 或第二套写 endpoint 规避。

## 权威业务口径

- 新增独立的服务端 readiness 投影，不改变既有 Prompt-only `configuration_complete` / `configuration_status` 语义，避免破坏 V1 和现有参考集合消费者。
- readiness 为互斥且穷尽的三态，优先级固定为：
  1. 未绑定 Prompt：`MISSING_PROMPT`；即使同时没有启用账号，也只投影为该状态。
  2. 已绑定 Prompt，但启用账号数为 0：`MISSING_ACCOUNT`。
  3. 已绑定 Prompt，且至少有 1 个启用账号：`COMPLETE`。
- “N 个可用”严格等于当前平台 `PlatformAccount.is_active = true` 的账号数；保留原 `platform_account_count` 作为全部账号数，不在客户端改写其语义。
- readiness、enabled account count、summary、类型 options、workflow/primary/actions/deletion/revision 均由服务端 read model 所有；前端只做穷尽展示和 URL/API 字段映射。
- 平台列表对所有已认证用户可见；管理 mutation 仍由管理员 endpoint 最终鉴权。普通用户收到 `primary_task=null`、`available_actions=[]`、`deletion=null`，操作列显示“无可用操作”，不通过前端角色推导动作。

## 需求

- 注册 `/settings/platforms`，并在 App Shell 增加“平台与账号”入口；不得挂入 `_admin`，不得隐藏普通已认证用户的读入口。
- 页面固定为七列：平台（Logo + Name）、类型、配置状态、发布账号、状态、更新时间、操作。
- 官网 URL、allowed domains、Prompt 详情、账号详情和导出不得进入列表。
- 平台名称与 `CONFIGURE_GENERATION` / `VIEW_PLATFORM_OPERATION` / `UPDATE` 的导航目标统一为 canonical `/settings/platforms/$platformId`。本任务不注册该 route、不创建占位或假成功页；只提供真实 canonical href。
- URL 只支持 `q`、`platformTypeId`、`status`、`configurationStatus`、`page`、`pageSize`；canonical 默认显式保留 `page=1&pageSize=20`，可选 pageSize 仅为 10/20/50。
- `configurationStatus` 使用 readiness 三态，并映射到新增的后端 query 字段；不改变旧 `configuration_status=COMPLETE|INCOMPLETE`。
- 搜索、筛选、分页和稳定排序由服务端完成；筛选、搜索或 pageSize 改变时 page 回到 1，refresh/Back/Forward 恢复状态，非法值与未知参数按既有 Router pattern replace 为 canonical URL。
- 列表响应同时提供全量稳定平台类型 options；不得从当前页反推、抓多页拼接或让普通用户调用管理员 endpoint。
- 页面摘要使用不受当前筛选影响的服务端 summary，展示平台总数、启用数、readiness 完整数，以及“缺 Prompt / 缺账号”的服务端分项；文案明确其为全部可读平台范围。
- 每行最多一个 Primary；overflow 只解析 `available_actions` 与 `deletion`。若 `ENABLE_PLATFORM` 已作为 Primary，则不重复展示语义相同的 `ENABLE`。
- ENABLE/DISABLE/DELETE 使用当前行 canonical revision、CSRF 和服务端最终复核；409 显示冲突并刷新 canonical 行，不自动重放 mutation，不自动覆盖用户确认上下文。
- loading、initial empty、filtered empty、initial error/retry、stale-data refresh error、越界页、Logo/type/time 缺失均有明确状态。
- 复用现有 TableShell、FilterBar、TablePagination、RowActions、Badge、Dialog、TableSkeleton、EmptyTable；不新增通用 Settings/Table/Form/Action 框架或依赖。
- 375/768/1024/1440 下不产生页面级横向溢出；375px 必须保留名称、配置状态、启停状态和可达动作，不能退化为不可用宽表。

## 验收标准

- [x] OpenAPI/后端返回权威 `readiness_status`、`enabled_platform_account_count`、readiness summary 和稳定 `platform_type_options`；旧 Prompt-only 字段与无分页参考集合模式保持不变。
- [x] readiness 三态、同时缺 Prompt/账号的优先级及 enabled account 口径有 backend/contract 测试，前端不重复推导。
- [x] ADMIN 与 ENGINEER 的 primary/actions/deletion 投影有对照测试；普通用户页面无管理动作，后端仍拒绝无权 mutation。
- [x] `/settings/platforms`、导航 metadata、breadcrumb、canonical URL、URL→API 映射、refresh/Back/Forward 与 page reset 均通过测试。
- [x] 固定七列、摘要、Logo/type/time 缺失、配置三态、启用账号数、loading/empty/error/retry、分页和 stale-data 行为有 component coverage。
- [x] Primary 与 overflow 对所有合同 token 穷尽映射，未知 token 明确失败；删除 blocker、焦点恢复、stale revision 单次请求有测试。
- [x] backend 搜索/筛选/成对分页/filtered count/unfiltered summary/稳定排序和固定查询次数有专项回归。
- [x] production-artifact fixture Playwright 覆盖列表、搜索、筛选、分页、URL history、名称 canonical handoff、Primary/overflow、375/768/1024/1440 和 runtime error audit。
- [x] contract/generated types、backend、V2、必要兼容调用、测试和直接相关文档一致，required validation 全部通过。

## 排除项

- `/settings/platforms/$platformId` Platform Workspace 与任何占位页。
- 平台新建/编辑表单、发布账号管理、Platform Type subsettings、Prompt Workspace、AI Channel 页面。
- Phase 6 全域 real-stack E2E、抽象回顾、Workbench、Cutover。
- 导出、批量操作、通用 Settings/Table/Form/Action 框架、新依赖。
- 旧 frontend 的视觉、架构或功能迁移；仅 DELETE revision 必填造成的单一兼容调用点/测试调整需要用户在批准本计划时明确豁免。
- 无关 backend/frontend 清理、无关文档改写、数据库 schema/migration。

## 已批准的兼容边界

用户已于 2026-08-13 批准：DELETE 增加必填 `expected_revision`，并同步让 V1 现有删除调用传入行 revision。该豁免仅覆盖直接调用点及其测试，不扩大为其他 V1 修改；服务端不增加 optional revision 兼容分支或第二套删除 endpoint。
