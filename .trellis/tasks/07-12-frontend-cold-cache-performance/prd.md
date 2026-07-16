# 前端冷缓存性能优化

## 目标

在不改变业务契约、认证语义、主题能力和核心交互的前提下，降低 PartSignal 生产构建的初始字体传输和首次业务路由可见时间，并为静态资源建立正确的压缩与缓存策略。

## 需求

- 移除完整 Noto Sans SC Web Font，优先使用跨平台系统中文字体栈。
- 为 JS、CSS、JSON、SVG 启用 gzip；WOFF2 不重复压缩。
- 带内容哈希的 `/assets/` 使用一年 immutable 缓存，`index.html` 和 SPA fallback 使用 no-cache。
- 保留 React.lazy，并让页面加载与预取共用唯一动态 import 定义。
- 支持侧栏 hover、键盘 focus 和登录后空闲预取；弱网与 saveData 禁止无条件空闲预取。
- 将 Suspense 限定到 Outlet 内容区，保持侧栏、页头、主题和用户区稳定。
- 查询缓存按工作台、业务列表、详情、配置分级；预取与页面请求共用 queryOptions。
- 只在生产证据证明输入、Markdown 或表格渲染阻塞时实施渲染优化。
- 不修改 OpenAPI、认证契约或后端聚合接口；发现相关需要时记录为阻塞项。
- 完整保留开始前已有的未提交主题和测试改动；截图式视觉基线已由独立任务移除，不得恢复。

## 验收标准

- [ ] 初始字体传输不超过 500KB；系统字体方案目标接近 0。
- [ ] 主入口 gzip 后不超过 300KB。
- [ ] 100ms 延迟、1.6Mbps 下行条件下，五次全新上下文冷路由中位数不超过 800ms。
- [ ] 相同条件下热路由中位数不超过 200ms。
- [ ] 不出现超过 200ms 的非必要主线程长任务。
- [ ] gzip、Vary、immutable、no-cache 和 WOFF2 不压缩均经容器响应头验证。
- [ ] 浅色、深色、移动端、键盘导航、主题切换、核心业务和可访问性不退化。
- [ ] lint、typecheck、相关单测、生产 build、核心 Playwright、主题功能检查和 Nginx 配置验证通过。
- [ ] 最终 diff 未覆盖任何开始前已有用户改动，未包含 commit、push、部署或 PR。

## 已确认基线

- `frontend/dist` 为约 5.9MB，四个 Noto Sans SC 字重合计 4,636,276B。
- 主入口为 865,755B，gzip 后约 280.81KB。
- 三次冷路由中位数约 1,855ms，热路由中位数约 45ms。
- StatusTag 和 TableRegion 的首次资源等待分别约 1,118ms 和 1,397ms，Mock API 最大约 1.3ms。
- 基线未观察到 Long Task；拦截 WOFF2 的反事实冷路由约 843ms。
