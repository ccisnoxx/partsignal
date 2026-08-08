# Frontend V2 App Shell + Router Metadata

## 目标

为 `frontend-v2/` 建立可响应式访问的 App Shell，并以 TanStack Router 的 route metadata 作为导航激活态与面包屑的唯一来源。该任务只建立验证 Shell、metadata、真实认证边界与 URL search 所需的最小路由集合，不实现业务页面。

## 范围

- Desktop Sidebar、Top Shell、Mobile Navigation、Account Menu 与 Breadcrumb。
- 路由 metadata：`navId` 与静态 `breadcrumb`。
- 子路由从最近显式声明 metadata 的祖先继承 `navId`；禁止使用 pathname 前缀匹配。
- 最小路由集合：工作台、产品列表、产品详情、系统用户。
- 产品列表接入最小 URL search validation：`q` 与 `page`。
- 使用真实 `/api/v1/auth/me`、`/api/v1/auth/csrf`、`/api/v1/auth/logout` 会话边界提供账户展示、退出与管理员导航可见性。
- `/system/users` 对非管理员保留原 URL 并显示 403；服务端仍是权限最终权威。
- 375 / 768 使用移动导航；1024 / 1440 使用固定桌面侧栏。
- 键盘导航、跳转到主内容、焦点恢复、可见焦点、语义标签与 `aria-current`。
- 必要组件测试、路由/搜索测试和 Storybook 场景。
- 使用独立命名 `playwright-cli` session 验证直接 URL、刷新、Back、Forward 与响应式行为。

## 约束

- 复用现有 Router、Providers、Design Tokens 和 Core Primitives。
- 旧 `frontend/` 仅用于核对导航、认证和布局行为，不复制其架构，也不修改或删除它。
- 不伪造当前用户、权限、capability 或后端响应；运行时认证失败必须显式呈现。
- 不增加状态管理库，不创建万能 route config、万能 search schema 或未来业务路由。
- 不实现业务页面、业务请求、Table Kit、Workspace、Form Kit 或 Editor Kit。
- 不修改根级 contract、部署配置或旧前端。
- 不 push；完成实现和验证后先给出 commit plan，等待确认。

## 验收标准

- [x] App Shell 在 375、768、1024、1440 宽度下符合文档定义的移动/桌面布局边界。
- [x] Desktop Sidebar、Mobile Navigation、Top Shell、Account Menu 和 Breadcrumb 可用且具备基础无障碍语义。
- [x] route metadata 是导航激活态与面包屑的唯一来源，`navId` 按最深显式匹配继承，不使用字符串路径前缀判断。
- [x] `/`、`/products`、`/products/$productId`、`/system/users` 足以验证 metadata、继承、面包屑和权限边界，且未预建额外业务路由。
- [x] `/products` 只校验 `q` 与 `page`；无效 `page` 归一为 `1`，不引入全局 search schema。
- [x] Account Menu 与管理员入口仅由真实会话数据驱动；匿名状态不显示账户或管理员入口。
- [x] 非管理员直接访问 `/system/users` 时 URL 不被改写，并获得可聚焦的 403 状态。
- [x] pathname 改变后焦点进入主内容；仅 search 改变不抢占焦点；抽屉和菜单支持 Escape、焦点约束与关闭后焦点返回。
- [x] 直接 URL、刷新、Back、Forward、移动导航和桌面导航通过浏览器验证。
- [x] 相关单元/组件测试、lint、typecheck、build、Storybook build 和范围审计通过。
- [x] diff 不包含 `frontend/`、`backend/`、`contracts/`、部署文件或其他无关修改。

## 阻塞规则

若 OpenAPI 与现有实现无法确认真实会话、CSRF、退出或管理员身份边界，则停止该部分实现并记录阻塞，不以假用户、假权限、固定成功响应或静默 fallback 代替。
