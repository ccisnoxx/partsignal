# 前端轻量资源与兼容清理设计

## 1. 设计目标

用现有入口、资产门禁和组件测试完成两个局部兼容修复，不增加运行时抽象、依赖或第二套资产管理机制。

## 2. favicon 设计

### 2.1 权威位置与加载链

```text
frontend/index.html
  -> <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  -> frontend/public/favicon.svg
  -> Vite 原样复制到 frontend/dist/favicon.svg
  -> check-production-assets.mjs 验证声明和产物
```

- `frontend/public/favicon.svg` 复用 `AppLayout.tsx` 已存在的紧凑 PartSignal 双路径标记；只把现有矢量形状落为浏览器可加载的静态资产。
- 选择 SVG 是因为现有标记本身是矢量，文本文件可审查且 Vite 原生支持；本缺陷不要求旧浏览器 `.ico` 兼容矩阵。
- 不从 React、CSS 或运行时主题动态生成 favicon。浏览器标签图标属于启动前静态资源，必须在 HTML 解析时可用。

### 2.2 门禁

在现有 `check-production-assets.mjs` 中增加两个同源检查：

1. `index.html` 恰有一个 `rel="icon"`，类型为 `image/svg+xml` 且路径为 `/favicon.svg`；
2. `favicon.svg` 存在并具有 SVG 根元素。

`check-production-assets.test.mjs` 的正常夹具补齐图标和声明，并增加缺失/错误声明的失败断言。继续复用 `readRequired`、`report` 和统一退出码，不创建 favicon 专用脚本。

## 3. Timeline 兼容迁移

`PublicationDetailPage.tsx` 只把 item 字段名从 `children` 改为 `content`：

```tsx
items={record.status_events.map((event) => ({
  content: (...原 JSX...),
}))}
```

- `record.status_events`、映射顺序、`StatusTag`、说明和时间格式均不改变。
- 不抽取 Timeline item 工厂；同项目其他使用点已经正确采用 `content`，一个字段替换即可收敛。
- 不修改 Ant Design 版本或增加兼容分支。当前锁定类型和运行时都明确以 `content` 为新合同。

## 4. 测试设计

- 公开资产脚本测试：正确 favicon 通过；声明或资产无效时返回非零并报告明确规则。
- 发布详情组件测试：复用现有只读详情用例，断言状态说明仍可见，并监听但不屏蔽 `console.error`，确认没有 `items.children` 弃用消息。
- 生产构建：证明 Vite 复制 favicon，且构建末尾的公开资产检查实际通过。
- 可选真实浏览器 smoke：用项目 `playwright-cli` 在新会话打开 `/login` 核对图标请求和 console，再打开一条发布详情核对 Timeline console；不保存或提交诊断产物。

## 5. 兼容性、文档与回滚

- 无 API、数据库、状态、权限、路由、CSS、依赖或部署配置变化。
- favicon 使用当前浏览器原生 SVG 支持；不为未列入项目兼容范围的旧浏览器增加 `.ico` 分支。
- 当前规范已要求复用现有视觉和组件边界；若实施未发现新通用规则，不更新 `.trellis/spec/`。
- 回滚只需整体撤销 favicon 文件/声明/门禁断言和 Timeline 字段/测试，不涉及持久状态。
