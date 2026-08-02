# Ant Design Alert 属性兼容清理设计

## 1. 根因

项目已安装 Ant Design `6.5.0`，`Alert.message` 仍被运行时兼容，但类型定义已经标记为 deprecated，组件会输出迁移警告。仓库中的多数 Alert 已使用 `title`，只有 8 个文件保留 11 个旧属性，形成同一组件内的新旧 API 混用。

## 2. 权威实现位置

| 责任 | 权威位置 | 本任务处理 |
| --- | --- | --- |
| 第三方属性合同 | `node_modules/antd/es/alert/Alert.d.ts` | 只读确认 `message` → `title` |
| 第三方运行时兼容 | `node_modules/antd/es/alert/Alert.js` | 只读确认 `title ?? message` 与弃用警告 |
| 项目当前模式 | 现有 `<Alert title=...>` 调用 | 直接复用，不新增封装 |
| 待清理调用点 | PRD 列出的 8 个源码文件 | 只改 11 个属性名 |
| 残余扫描 | TypeScript AST 只读命令 | 要求 `<Alert message>` 为 0 |

## 3. 变更映射

```tsx
// 变更前
<Alert role="alert" type="error" showIcon message={errorMessage(error)} />

// 变更后
<Alert role="alert" type="error" showIcon title={errorMessage(error)} />
```

表达式、字符串和所有其他属性保持字节级不动。单行组件不因本任务拆行或格式化整个文件，避免制造无关差异。

## 4. 测试与浏览器边界

- 定向 Vitest 复用现有 `ChangePasswordPage.test.tsx`、`ConfigurationPages.test.tsx`、`ProductFactsPage.test.tsx` 和 `PublicationsPage.test.tsx`，覆盖受影响页面的现有渲染/交互边界；不为了机械属性改名新增测试夹具。
- Typecheck 证明新属性符合当前锁定 Ant Design 类型；lint 保持源码与主题静态门禁。
- AST 扫描证明 11 个旧属性全部清零，比只检查一行正则或代表页面更完整。
- 真实浏览器使用命名内存会话登录后打开 `/change-password`，提交一个故意错误的旧密码和满足长度要求的新密码，等待错误 Alert 可见并检查 console；失败请求不得导致密码变化，也不保存认证状态。

## 5. 兼容、回滚与风险

- 当前 `Alert.js` 已用 `title ?? message` 合并内容，原位改名不改变当前 DOM 内容或视觉角色。
- 主要风险是漏改条件分支中的旧属性；以 AST 全源码计数为 0 防止遗漏。
- 次要风险是真实 smoke 误执行成功改密；必须使用明确错误旧密码，只验失败 Alert，不复用或输出真实密码。
- 回滚仅恢复 11 个属性名；无数据、依赖、合同或部署回滚。
