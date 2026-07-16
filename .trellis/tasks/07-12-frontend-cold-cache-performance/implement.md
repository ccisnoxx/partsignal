# 实施计划

## 0. 工作区与基线

- [x] 保存开始时 branch、git status、diff stat 和受影响文件清单。
- [x] 运行生产 build，记录 dist、字体、主入口 raw/gzip 数据。
- [x] 使用固定 100ms/1.6Mbps 条件记录五次冷/热路由、资源、API 和 Long Task。

## 1. P0

- [x] 添加可重复 production performance 脚本和 package 命令。
- [x] 移除完整 Noto Web Font，统一系统字体栈。
- [x] 配置 frontend、production、staging Nginx 的 gzip 与缓存头。
- [x] 运行 typecheck、相关单测、build、Nginx 容器响应头检查并记录结果。

## 2. P1

- [x] 提取唯一 route loader，接入 hover/focus/idle 与弱网 gating。
- [x] 将 Suspense 下移到 Outlet 内容区并增加稳定骨架。
- [x] 定义查询时效和共享 queryOptions，只预取高概率数据。
- [x] 运行路由预取、Suspense、查询相关单测和 production performance 快速复测。

## 3. P2

- [x] 对长 Markdown 输入和实际最大表格数据执行生产 Long Task/交互测量。
- [x] 仅在阈值触发时实施局部 useDeferredValue/useMemo、Worker、虚拟化或 startTransition。
- [x] 记录 AuthProvider 串行关系，不修改认证契约。

## 4. 最终验证

- [x] `npm run lint`。
- [x] `npm run typecheck`。
- [x] `npm test` 及新增相关单测。
- [x] `npm run build` 和 bundle/font 预算检查。
- [x] 核心 Playwright 和主题功能检查，不依赖截图式视觉基线。
- [x] frontend Nginx `nginx -t/-T`、gzip 与缓存响应头验证。
- [x] production/staging 模板语法与策略检查，不部署。
- [x] 相同条件最终五次性能复测并输出前后对比。
- [x] 最终 diff 审计：用户改动、缓存语义、隐藏 fallback、行为变化、安全回归及未恢复截图式视觉基线。

## 验证门槛

- 任一阶段若需要 OpenAPI、认证契约或后端聚合接口，暂停该结构项并继续其他不依赖工作。
- 截图式视觉基线已移除，不得将快照图片、截图断言或生成 CI 重新加入验收链路。
- 任一性能指标未达预算时保留分项证据，不用更长动画、静默旧数据或永久缓存绕过。
