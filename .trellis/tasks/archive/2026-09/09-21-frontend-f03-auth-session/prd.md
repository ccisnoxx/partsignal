# F03 登录、会话、改密与退出

## Goal

完成清单 F03：在本轮候选上验收 `/login` 与 `/account/security` 的登录、强制改密、保护路由和退出流程。

## Requirements

- 前置：F01、F02 本轮通过。来源：`11` F03、`02` 认证路由、`03` 登录/系统蓝图、`05` 认证与错误合同、`contracts/openapi.yaml` 对应 Auth 接口。
- 会话由服务端裁决，认证 Provider/Router 避免未完成探测的业务 loader；必须改密者不可进入业务页面，匿名者按安全 return-to 登录。
- 登录、改密、登出 mutation 使用 CSRF 及服务端权限；身份变化清理业务 Query 缓存。凭据不得进入 URL、缓存、日志或测试产物。
- 已有实现可复用，但须本轮 unit/component 与 production artifact 浏览器证据；发现真实缺口做最小修复。

## Acceptance Criteria

- [x] 登录、强制改密、受保护路由、退出及缓存/CSRF 边界符合服务端权威。
- [x] Auth 相关直接测试与 `auth-session.spec.ts` 的移动/桌面 production artifact 场景通过；若修改权限代码，独立只读复核。
- [x] 记录 diff、实际证据、真实栈未验证项和 F04 下一步。

## Scope

仅验收 F03 认证会话与页面；App Shell 导航、URL schema 和 404 归 F04，System 用户管理归 S01–S03。

## 本轮实际交付与证据

- 代码：认证生产代码与 Auth 测试均无需修改；`frontend/src/app/auth/auth-provider.tsx` 以服务端 `/auth/me` 与 `/auth/csrf` 建立会话，login 写入 canonical session、清理上一身份业务查询，改密后重新读取服务端会话，logout 带 CSRF 并清理业务缓存；`_app/route.tsx` 与 `_admin/route.tsx` 分别持有登录/强制改密与 ADMIN 边界。
- 直接测试：Auth Provider、AppProviders、Login、Account Security、return-to 共 5 个文件、35/35 通过。
- 浏览器：`npm run e2e -- tests/e2e/auth-session.spec.ts` 在 production build + preview 下移动/桌面 6/6 通过；覆盖匿名 CSP、320/375/768/1440 控件几何、登录→强制改密→自助改密→ENGINEER 403→退出，且 `trace: off` 与产物敏感字符串检查通过。该 fixture 不代表真实服务端权限 E2E。
- 本项未修改权限/认证代码，故无新增高风险候选 diff 需要独立复核；服务端实际会话撤销、Cookie 属性和权限拒绝仍待 S03 真实栈闭环。
- 下一项 F04：App Shell、导航、URL schema 与 404。F05 Table Kit 由独立代理按无重叠文件范围核对。
