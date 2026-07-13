# 最终验收结果

## 生产构建与性能预算

固定条件为 Chromium、100ms 延迟、下行 200000 B/s（1.6Mbps）、1440x1000，每组五次独立上下文。`rawCold` 通过 `saveData/2g` 禁用空闲预取，用于观测无预取下限；`productionPrefetch` 保留真实生产空闲预取行为。

| 指标 | 修改前 | 修改后 | 预算 | 结论 |
| --- | ---: | ---: | ---: | --- |
| `dist` | 约 5992 KiB | 1460 KiB | - | 减少约 75.6% |
| 初始字体传输 | 3477148 B | 0 B | <= 500KB | 通过 |
| 主入口 JS gzip -9 | 278980 B | 279797 B | <= 300KB | 通过 |
| 冷路由可见中位数 | 1853.5ms | 64.8ms（生产预取） | <= 800ms | 通过 |
| 无预取冷路由诊断 | 1853.5ms | 815.2ms | <= 800ms | 超出 15.2ms，保留为诊断项 |
| 热路由可见中位数 | 39.6ms | 39.9ms | <= 200ms | 通过 |
| 路由测量 Long Task | 0ms | 0ms | <= 200ms | 通过 |

生产预取五次冷路由为 64.77、63.97、64.81、63.26、116.78ms；无预取五次为 816.23、815.25、811.59、807.73、815.17ms。最终模拟 API 最大 2.302ms，因此瓶颈仍是代码块网络等待，不是 API。

## 构建、测试与行为

- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 全部通过；Vitest 为 9 个文件、19 个测试。
- 生产构建上的 `mvp-flow.spec.ts` 为 2/2 通过；本地 API、存储和 AI 替身均由项目既有测试栈提供，没有访问生产服务。
- `theme.spec.ts` 为 3/3 通过。
- 仓库既有视觉基线因 Web Font 改为系统字体出现预期像素与文本度量差异：标准截图比较 1/12 通过、11/12 失败，差异约 2% 至 5%；没有更新或覆盖仓库截图。
- 使用 `/private/tmp` 独立快照目录完成浅色、深色、375/768/1024/1440 视口和 axe 检查，12/12 通过；抽查登录、工作台、产品事实和 GEO 弹窗未发现裁切、溢出或框架重排。
- 5KB Markdown 输入中位 8.3ms、p95 13.4ms；100KB 压测中位 46.9ms、p95 59.1ms，未出现超过 200ms 的任务。只对预览解析使用 `useDeferredValue` 和单个有证据的 `useMemo`，未引入 Worker。
- 100 条产品数据由现有分页每页渲染 20 条，首次访问 128.6ms 且无 Long Task，因此未引入虚拟化。

## Nginx

- frontend 容器配置成功启动，JS、JSON、SVG 在 `Accept-Encoding: gzip` 下返回 gzip；WOFF2 不返回 `Content-Encoding`。
- `/assets/` 返回 `public, max-age=31536000, immutable`；`index.html` 和 SPA fallback 返回 `no-cache`。
- production 与 staging 模板替换占位地址后，均通过 `nginx:1.27-alpine nginx -t`。
- 未执行生产或 staging 部署。

## 审计与阻塞项

- 未引入 Service Worker/PWA、未删除 StrictMode、未全局粗暴增加 `staleTime`、未批量添加 memo/callback，也未用动效或永久缓存掩盖等待。
- 路由加载与预取共用 `routeLoaders.ts`；查询预取与页面读取共用 `queryOptions.ts`，没有第二套 import、queryKey 或 queryFn。
- `AuthProvider` 仍保持 `/auth/me` 后请求 `/auth/csrf`。是否并行或合并需要认证公共契约确认，作为独立阻塞项保留，本次不修改。
- 字体变更需要在负责人明确接受系统字体后再更新视觉基线；当前用户已有主题、测试和截图改动保持原状。
