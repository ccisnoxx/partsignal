# Auth Session UI 审计记录

## 结论

V2 Auth 的后端合同与跨路由 session owner 已存在；blocker 是产品层缺少登录、修改密码与 `_app` 共同认证边界。最小正确方案是扩展现有 `AuthProvider` 并增加两个顶层 Form route，不需要 backend、contract、新依赖或第二状态层。

## 权威证据

- `docs/frontend-v2/02-information-architecture-and-routing.md:51,104-105,144-160` 已定义 Account Menu“修改密码”、`/login` 与 `/account/security` 的顶层 route 结构。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:43-48` 把 `login → must change password → unauthorized admin route → logout` 列为 Auth E2E 核心流程。
- `contracts/openapi.yaml`：LoginRequest username min 1/password min 8；AuthSession 返回 User + csrf_token；ChangePasswordRequest old/new 均 min 8。
- `frontend-v2/src/app/auth/auth-provider.tsx`：现有 session Query 是 user + CSRF 的唯一 owner；logout 已清除非 Auth Query cache；尚无 signIn/changePassword。
- `frontend-v2/src/routes/_app/route.tsx`：当前无 anonymous/must-change boundary，直接渲染 App Shell。
- `frontend-v2/src/app/layout/app-shell.tsx`：Account Menu 当前只有退出。
- `frontend-v2/src/routes/` 与 generated route tree 当前没有 login/account security。
- `backend/app/deps.py`：must-change session 只允许 me/csrf/change-password/logout，其他受保护 API 由服务端返回 `PASSWORD_CHANGE_REQUIRED`。
- `backend/app/services/identity.py`：自助改密校验旧密码、清除 must-change、保留当前 session、撤销其他 session并写审计；成功结果必须由服务端刷新获得。
- `backend/tests/integration/test_identity_management.py::test_user_query_export_and_temporary_password_flow` 已验证 login、must-change allowlist、change-password 与密码切换的真实 PostgreSQL 行为。
- `deploy/scripts/e2e-local.sh` 已 seed `must_change_password=true` 的 ENGINEER，并拥有唯一 DB/process/storage/Redis/production preview lifecycle，可直接承载一个 Auth real-stack spec。

## 规划选择

- AuthProvider 增加 direct async 方法，而不是 Query mutation：避免 password variables 进入 mutation cache。
- 三处 route decision 只读 canonical AuthContext，不创建并行 boolean/store。
- login/change 成功固定进入 `/` 或 `/account/security`；不增加未定义的 redirect/search 参数与 open-redirect validation。
- 两个短 Form 页面保持独立内聚；不抽象 auth form framework。
- Foundation smoke 改为显式 active session，Auth 状态另由专用 strict spec 覆盖。
- 新增一个真实栈 Auth desktop 场景，复用唯一脚本 owner；System Admin E2E 仍保持独立 planning，后续只重新审计并消费已交付 UI。

## 历史会话检索

通过 `trellis mem` 搜索了 V2 login/account security/must-change 与 `PASSWORD_CHANGE_REQUIRED`；除当前 System Admin E2E 的 blocker 结论和此前 Users 合同外，没有发现额外已批准的 Auth UI 交互决策。OpenCode 历史 reader 不可用的提示不影响本地代码、合同与 task evidence。
