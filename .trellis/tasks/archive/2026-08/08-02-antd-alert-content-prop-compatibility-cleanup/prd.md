# Ant Design Alert 属性兼容清理

## 目标

清理前端剩余的 Ant Design `Alert.message` 弃用属性，使受影响页面继续显示完全相同的提示内容，同时消除 `[antd: Alert] message is deprecated` 运行时警告，并避免未来升级移除旧属性时出现兼容风险。

## 已确认事实

- `frontend/package.json` 声明 `antd: ^6.2.0`，当前 `package-lock.json` 和本地安装版本均为 `6.5.0`。
- 本地权威类型 `frontend/node_modules/antd/es/alert/Alert.d.ts` 将 `message?: React.ReactNode` 标记为 deprecated，并明确要求使用 `title`。
- Ant Design 当前实现以 `const mergedTitle = title ?? message` 渲染标题，同时对传入 `message` 的组件输出弃用警告；因此在没有同时传入 `title` 的现有调用点上，把属性名原位改为 `title` 可保持内容和视觉语义不变。
- TypeScript AST 只读扫描确认当前有 11 个 `<Alert message=...>`，分布在 8 个文件：
  - `features/auth/ChangePasswordPage.tsx`：1；
  - `features/configuration/ModelDiscoveryModal.tsx`：2；
  - `features/configuration/PlatformTypesPage.tsx`：1；
  - `features/geo-observations/GeoTopicsPage.tsx`：1；
  - `features/product-facts/ProductFactsPage.tsx`：1；
  - `features/publications/PublicationAttentionPage.tsx`：1；
  - `features/publications/PublicationRepairPage.tsx`：3；
  - `shared/components/DirectUpload.tsx`：1。
- 项目现有大量 `Alert title=...` 用法可作为当前 Ant Design 6 实现模式；无需新增包装组件、辅助函数或第二套提示 API。
- 集中回归已把该问题登记为独立非阻断维护债务；第二轮七组修复闭环结论不依赖本任务，但本任务应关闭该已知 console 污染和升级风险。

## 范围内

1. 仅将上述 11 个 Ant Design `<Alert>` 的 `message` 属性原位改为 `title`。
2. 保持每个 Alert 的表达式、文字、`role`、`type`、`showIcon`、`description`、条件渲染和周边业务流程不变。
3. 使用 TypeScript AST 重新扫描，要求 `frontend/src/**/*.tsx` 中 Ant Design `<Alert message=...>` 数量为 0。
4. 运行受影响页面的现有定向组件测试、前端 typecheck 和 lint。
5. 使用项目 `playwright-cli` 在真实开发环境触发一个错误 Alert，确认提示可见且 console 不再出现 `[antd: Alert] message is deprecated`。
6. 保留并排除 `.playwright-cli/`、`frontend/.playwright-cli/` 等诊断产物，不自动推送。

## 范围外

- 不改 Alert 文案、视觉层级、布局、颜色、图标、可访问名称或错误处理逻辑。
- 不修改 Ant Design 版本、`package.json`、lockfile、依赖、主题、CSS 或构建配置。
- 不修改 API、生成类型、后端、合同、数据库、权限、业务状态或查询逻辑。
- 不新增 Alert 包装组件、静态检查脚本、兼容 fallback、测试框架或抽象。
- 不顺手处理其他 Ant Design deprecated 属性；发现后只记录并另行分流。
- 不创建新的业务数据来配合 smoke，不执行成功改密或其他持久化产品写入。
- 不删除、移动或提交 Playwright 诊断产物，不推送远端。

## 验收标准

- [x] AC1：8 个权威文件中的 11 个 `<Alert message=...>` 均原位改为 `title`，TypeScript AST 全源码扫描结果为 0 个遗留。
- [x] AC2：工作差异只改变 JSX 属性名；Alert 的表达式、文字、角色、类型、图标、描述、条件和周边业务逻辑保持不变。
- [x] AC3：`frontend/package.json`、`package-lock.json`、依赖、主题、CSS、API/生成类型和产品合同均无差异。
- [x] AC4：受影响页面的定向 Vitest、`npm --prefix frontend run typecheck`、`npm --prefix frontend run lint` 和 `git diff --check` 通过。
- [x] AC5：真实浏览器中错误 Alert 可见，console 中目标 `[antd: Alert] message is deprecated` 警告为 0；smoke 不改变密码或其他业务状态。
- [x] AC6：没有新增包装、helper、fallback、测试脚本、依赖或无关重构；没有为了消除警告过滤 console 输出。
- [x] AC7：提交范围仅包含当前 Trellis 任务目录和 8 个前端源码文件；Playwright 诊断产物保持未跟踪且不进入提交。
- [x] AC8：任务通过 `trellis-check` 和 `trellis-update-spec` 判断，提交前展示精确范围并等待用户确认，不自动推送。

## 关键决策

- 采用 11 次机械属性改名，不新增公共封装；现有 Ant Design 合同和项目模式已经提供唯一答案。
- 不新增永久测试：该变更没有新分支或业务行为，AST 零遗留检查、现有页面测试、静态门禁和真实 console smoke 已直接覆盖风险。
- 浏览器 smoke 使用错误旧密码触发改密页错误 Alert；失败请求不会修改密码，避免依赖特定发布异常数据或制造业务记录。
