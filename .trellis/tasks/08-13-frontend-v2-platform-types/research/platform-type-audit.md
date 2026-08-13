# Platform Type 审计记录

## 1. Start Check

- 主工作目录：`/Users/sc/PycharmProjects/partsignal`
- 分支：`main`
- 审计开始时工作区：clean
- HEAD：`7079375e chore(trellis): close platform workspace parent task`
- `30ae3f67`、`e669a492` 均为 HEAD ancestor。
- Platform List、Workspace Core、Workspace Accounts、父 Workspace Task 均位于 `.trellis/tasks/archive/2026-08/`。
- 创建本 Task 前无 active Trellis Task。

## 2. Contract and Backend Findings

| Question | Evidence | Conclusion |
|---|---|---|
| platform count | `platform_types_out()` 已按 type IDs grouped count `PlatformProfile` | 查询权威且无 N+1，但 wire model 缺字段；直接暴露 `platform_count` |
| count scope | DELETE service 统计所有 `PlatformProfile.platform_type_id`；FK RESTRICT 不看 `is_active` | Enabled/Disabled 全部包含 |
| list order | router 当前 `order_by(created_at)`；`_platform_type_options()` 为 `lower(name),id` | Settings list 改为 `lower(name),id` |
| delete revision | PATCH 有 expected revision；DELETE 无 | required query；锁行后 revision 先于 blocker |
| name uniqueness | DB 只有 NOT NULL/VARCHAR(160) | name 不唯一，不增加约束 |
| slug uniqueness | 开发库 `pg_constraint` 实查 `uq_platform_types_slug|UNIQUE (slug)` | DB 是 owner；映射该 constraint 为稳定字段错误 |
| normalization | name 仅 service `.strip()`；slug regex lowercase/hyphen，无 trim/生成 | name trim 移到请求 schema；slug 不自动 normalize |
| slug update | `PlatformTypeUpdate` 继承 create | 保持可修改 |
| permissions | 四个 router operation 均注入 `AdminUser` | ADMIN-only，无普通只读模式 |
| actions | `EDIT_CATEGORY` + UPDATE + conditional DELETE/deletion | page overflow-only 消费；不把 primary 语义变成 primary button |

## 3. Frontend Consumers

- Platform List：`PlatformProfileList.platform_type_options` 用于筛选，row 显示 `platform_type.name`。
- Workspace Detail：`platform_type_options` 用于 Overview form，Header/Overview 显示 `profile.platform_type.name`。
- Accounts、Prompt、Content、Publication 不直接消费 Platform Type management list/name；无需失效。
- V1 唯一业务调用点为 `frontend/src/features/configuration/PlatformTypesPage.tsx`；DELETE 缺 revision，需最小兼容适配。

## 4. UI and Route Findings

- `/settings/platforms/types` 尚未注册；现有 `_app/_admin` 是 pathless AdminBoundary，可保持外部 URL 不变。
- Platform Type 已在 V2 IA/blueprint 中定义为 Settings Table、四列、无 Sidebar。
- Platform List/Workspace 都已有 route auth context，可只把 `auth.isAdmin` 作为 subsettings link UX prop。
- RowActions 支持 overflow-only、destructive confirmation 与 final focus；TableShell/EmptyTable/Dialog/Form primitives 可直接复用。
- Workspace Accounts 已有 desktop semantic table + 375px card-row 的局部响应式 pattern；无需改全局 Table Kit。
- 通用 frontend spec 中仍有 V1 Ant Design 描述；`frontend-v2/AGENTS.md` 与 V2 docs 更具体，实施以 shadcn/Base UI/Tailwind 为准，只继承不冲突的动作、焦点、a11y 和响应式约束。

## 5. Test Ownership

- Contract：`backend/tests/unit/test_contract.py`
- projection：`backend/tests/unit/test_workflow_projections.py`
- Platform List/Workspace PostgreSQL patterns：`backend/tests/integration/test_platform_profile_list.py`、`test_platform_workspace.py`
- 新 Type CRUD/permission/query count：独立 `backend/tests/integration/test_platform_types.py`
- V1 direct compatibility：`frontend/src/features/configuration/PlatformTypesPage.test.tsx`
- V2 model/page/navigation/cache：Configuration domain tests
- production artifact：新 strict Type fixture/spec，复用现有 auth/runtime-error audit 方式，不构建 Phase 6 real stack。

## 6. Gap Summary

当前合同部分满足：CRUD、ADMIN boundary、server-driven actions、revision read/update、deletion blocker 与 grouped count 已存在。实现所需最小结构性调整是给现有 read model 暴露 count、统一排序、收紧 DELETE revision 和修正字段/唯一错误边界；其余是单页 UI、两个已有页面入口与精确缓存失效。无新数据库表、字段、endpoint、依赖或通用抽象需求。
