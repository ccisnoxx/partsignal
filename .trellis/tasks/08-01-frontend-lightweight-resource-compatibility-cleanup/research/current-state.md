# 前端轻量资源与 Timeline 兼容现状

## 权威缺陷

- `PS-QA2-UI-001`：新浏览器访问匿名登录入口时 `/favicon.ico` 返回 404。
- `PS-QA2-UI-003`：发布详情状态轨迹稳定输出 Ant Design `items.children` 弃用警告。
- 来源：第二轮全项目回归 `report.md` 与 `research/findings.md`。

## favicon 现状

- `frontend/index.html:1-20` 没有 `<link rel="icon">`。
- `frontend/public/` 当前只有 `llms.txt`、`robots.txt`、`theme-init.js`，没有图标。
- `frontend/src/app/AppLayout.tsx:159,174` 已有适合小尺寸的紧凑 PartSignal 双路径 SVG 标记；`LoginPage.tsx:81-90` 也有同品牌的大尺寸变体。
- 最小方案是复用紧凑标记创建 `public/favicon.svg` 并在 HTML 显式声明，不新增 `.ico`、manifest、依赖或运行时生成逻辑。
- `frontend/scripts/check-production-assets.mjs` 已负责构建产物中的公开资产、HTML 元信息与敏感信息门禁；favicon 应纳入该唯一门禁。
- `frontend/scripts/check-production-assets.test.mjs` 用临时 `dist` 夹具验证门禁，适合补正常和失败断言。

## Timeline 现状

- 当前 lockfile 安装 `antd@6.5.0`。
- `frontend/node_modules/antd/es/timeline/Timeline.d.ts:21-24` 将 `children` 标记为弃用并指向 `content`。
- `frontend/node_modules/antd/es/timeline/Timeline.js:110-115` 在开发环境对 `items.children` 调用弃用警告。
- `frontend/src/features/publications/PublicationDetailPage.tsx:61-72` 是唯一旧字段使用点。
- 已正确使用 `content` 的对照：
  - `frontend/src/features/publications/PublicationDrawer.tsx`
  - `frontend/src/features/content-editor/ContentEditorPage.tsx`
  - `frontend/src/features/configuration/AuditLogDetailPanel.tsx`
  - `frontend/src/features/product-facts/ProductFactsPage.tsx`
- `frontend/src/features/publications/PublicationsPage.test.tsx:686-699` 已覆盖旧发布详情只读渲染，可在同一用例增加状态轨迹和目标 console 警告断言。

## 结论

- 两项都是前端 P3 局部兼容问题，不涉及后端、合同、权限、状态或数据迁移。
- 无需共享 helper、Timeline 包装层、图标生成管线或新测试文件。
- 权威实现位置为入口 HTML/公开资产门禁，以及发布详情现有 Timeline 映射。
