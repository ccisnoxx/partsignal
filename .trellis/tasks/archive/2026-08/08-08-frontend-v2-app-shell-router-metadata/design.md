# 技术设计

## 设计原则

- Router 是 URL 与当前匹配链的唯一权威；导航和面包屑从 route match metadata 派生。
- TanStack Query 管理真实认证会话；不引入全局状态库。
- App Shell 只组合已有 tokens、primitives 与 Router Outlet，不承载业务数据或页面逻辑。
- 权限 UI 只做可见性与清晰反馈，服务端继续执行最终授权。

## 路由与 metadata

在 TanStack Router 的 `StaticDataRouteOption` 上扩展：

```ts
type NavId = "workbench" | "products" | "users"

interface StaticDataRouteOption {
  navId?: NavId
  breadcrumb?: string
}
```

最小路由树：

```text
__root
└── _app                 App Shell + Outlet
    ├── /                工作台
    ├── /products        产品父级 Outlet，navId=products
    │   ├── /            产品列表
    │   └── /$productId  产品详情
    └── _admin           真实管理员边界
        └── /system/users
```

- 激活导航：从当前 match 链叶子向根扫描，取第一个显式 `navId`。子路由可覆盖；未声明时自然继承祖先。
- 面包屑：按根到叶顺序收集显式静态 `breadcrumb`；非末项可链接其 matched pathname，末项使用 `aria-current="page"`。
- 本任务不解决动态产品名称；详情面包屑使用静态“产品详情”。
- 导航 registry 只包含已实现入口，并引用与 route metadata 相同的 `NavId` 类型。不得根据 `pathname.startsWith` 推断激活态。

## URL search

`/products` 使用路由级 Zod schema，仅声明：

- `q`：trim 后的可选字符串，最大 200 字符。
- `page`：正整数；缺失或无效时归一为 `1`。

不创建通用 schema 工厂、不启用全局 strict search、不声明未来筛选字段。

## 真实认证边界

`AuthProvider` 使用一个 TanStack Query 会话查询：

1. `GET /api/v1/auth/me`；204 表示匿名，200 使用生成的 `User` 类型。
2. 已登录时读取 `GET /api/v1/auth/csrf`，用于真实退出。
3. `POST /api/v1/auth/logout` 发送 `X-CSRF-Token`；成功后清除客户端查询状态。

认证加载和错误均显式呈现。管理员可见性仅依据 OpenAPI 已定义的 `account_type === "ADMIN"`。匿名或非管理员访问 `/system/users` 时保持 URL，渲染可聚焦 403；不伪造 capability，不实现登录页、全局登录拦截或账户安全表单。

## App Shell

- 375 / 768：顶部栏显示移动导航触发器，导航使用现有 `Sheet`。
- 1024 / 1440：显示固定 208px Sidebar，隐藏移动触发器。
- Top Shell 高 64px；主内容 padding 分别为 12 / 16 / 20px，内容最大宽度 1520px。
- Account Menu 使用现有 `DropdownMenu`，只显示真实用户名/显示名与退出动作。
- 页面主体由 `_app` route 的 `<Outlet />` 渲染；产品父路由只提供嵌套 `<Outlet />`，不把 Shell 复制到页面。
- pathname 改变时聚焦带 `tabIndex={-1}` 的 `<main>`；search-only 更新不触发该 effect。
- 提供 skip link、语义 `<nav>`/`<main>`、可见焦点与 `aria-current`。抽屉/菜单的 Escape、焦点约束和触发器焦点恢复复用 Base UI primitive 行为。

## 测试与 Storybook

- `navigation.test.ts`：metadata 继承、子级覆盖、breadcrumb 顺序。
- `auth-provider.test.tsx`：匿名会话、管理员会话、真实 CSRF 退出、错误显式化。
- `app-shell.test.tsx`：激活态、移动导航、账户菜单、键盘/焦点与匿名边界。
- `providers.test.tsx`：Providers、Router context、最小路由与 search validation 的真实组合。
- `app-shell.stories.tsx`：桌面管理员、桌面匿名、移动管理员、认证加载、认证错误、403 内容边界；Storybook fixture 仅用于展示/测试，不进入运行时代码。

## 明确取舍

- 不增加导航配置层、权限策略接口、search schema 工厂或 layout 插件系统。
- 不为未来动态面包屑预留抽象；有真实 loader 数据后再设计。
- 不新增 Playwright Test 文件；本任务用临时 `playwright-cli` 做浏览器验证，稳定 E2E 基线留给 Phase 1.6。
- 预计无需修改 `global.css`；现有 tokens 和 Tailwind utilities 足以实现布局与焦点样式。
