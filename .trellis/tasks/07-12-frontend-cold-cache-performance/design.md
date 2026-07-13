# 技术设计

## 边界与不变量

- 只改变前端资源交付、路由加载边界和服务端状态缓存策略，不改变路由地址、API 字段、权限、认证或业务状态机。
- React.lazy、StrictMode、深色模式、现有动效和可访问性实现保持存在。
- 用户已修改的主题、布局、组件、E2E 和截图是当前实现的一部分，所有修改基于工作副本逐块合并。

## P0：网络交付

- 删除 Fontsource Noto Sans SC 依赖和字体 CSS，CSS 与 Ant Design Token 统一改用系统中文字体栈。
- 前端容器 Nginx 和生产静态 Nginx 都直接声明 gzip 与缓存策略；staging 边缘代理显式保证公开响应头，避免依赖宿主机默认配置。
- 添加生产性能脚本，固定 CDP 网络条件、Mock API、全新浏览器上下文和分项计时，避免把开发服务器或缓存命中当成结论。

## P1：路由和数据

- `routeLoaders.ts` 是所有动态 import 的唯一所有者，同时导出 lazy 页面组件与 loader。
- `routePrefetch.ts` 负责路由代码预取、连接条件判断和 idle 调度；用户 hover/focus 只预取单个目标，idle 仅覆盖工作台和产品列表。
- Suspense 从 Routes 外层移动到 AppLayout 的 Outlet，加载骨架仅占内容区域。
- 查询时效常量由 queryClient 导出；共享或被预取的 queryKey/queryFn 由单一 queryOptions 模块拥有。
- 数据 idle/意图预取只覆盖 dashboard summary、geo metrics 和默认产品列表。

## P2：证据门槛

- 使用生产 PerformanceObserver 和资源计时区分代码下载、API、渲染与 Long Task。
- Markdown 编辑输入 p95 未超过 50ms时不增加 useDeferredValue/useMemo；超过后只在预览计算处使用。
- 表格在实际 API 最大页数据下未产生超过 200ms 渲染任务时不引入虚拟化。
- 导航没有超过 200ms 的同步状态任务时不引入 startTransition。

## 回滚

- 未提交阶段只反向应用本任务新增的精确 hunks，不使用 reset、checkout 或 clean。
- 后续若获准形成独立提交，则按测量、P0、P1、P2 分组，以 git revert 回滚，不触碰用户原有改动。
- Nginx 配置上线前仅做本地/容器验证；本任务不执行部署或 reload。
