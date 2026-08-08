# Frontend V2 Workspace + Form + Editor Kit

## 目标与价值

建立只服务于后续 Product Facts vertical slice 的最小 Workspace、RHF/Zod Form 和 CodeMirror Markdown Editor Kit，使 Fact Workspace、Fact Review 与 Fact Version readonly Detail 能复用稳定的布局、表单、编辑、预览、并发冲突和未保存离开保护能力。

本 Task 只固化 Design System 与 Router 集成边界，不创建业务页面或业务合同。

## 已确认事实

- 当前 `frontend-v2` 已具备 React 19、TanStack Router、Zod、Base UI、Tabs、Sheet、Dialog、Button、Input、Select、Badge、Skeleton、Storybook 和 Vitest。
- 当前没有 React Hook Form、CodeMirror 或 Markdown renderer/sanitizer。
- TanStack Router 已提供 `useBlocker`、resolver 和 `beforeunload` 能力，项目尚未接入 dirty guard。
- `ProductFactsDraft` 的唯一正文为 `body_markdown`，保存使用 `expected_revision`；`FactVersion` 是不可变审核快照。
- `FactReviewContext` 当前只包含 `fact_version`、`available_actions` 和 `review_history`，没有比较源或 diff。
- Table Kit 已合并、归档并删除临时分支；定向基线测试 10/10 通过。

## 范围内需求

### Workspace

- 提供 `WorkspaceShell`、`WorkspacePane`、`WorkspaceTabs`、`StickyActionBar`、`DetailSection` 和 `Timeline`。
- 固定 Context/Main/Reference 三槽，不建立任意 region、breakpoint 或业务 variant 配置系统。
- 1440px 使用三栏，Main artifact 面积最大；375/768/1024 使用 Main-first tabs 降级。
- loading 只替换 Main artifact，不卸载 shell；明确呈现 empty reference、error/retry、readonly snapshot 和 revision conflict。
- Sticky Action Bar 只接收已解析的 UI actions，不识别业务 status、权限或 action token。
- Sticky Action Bar 不遮挡正文，兼容 safe area；danger action 必须确认，disabled action 必须有可解释原因。

### Form

- 使用 React Hook Form + Zod，提供 `FormField`、`FormSection`、`FormActions`、`ErrorSummary` 和 `DirtyGuard`。
- `FormField` 负责 label、description、field error 与控件的可访问性关联。
- Domain 可通过 RHF `setError(name, { type: "server", message })` 和 `setError("root.server", ...)` 接入服务端错误。
- Form Kit 不解析 OpenAPI `ErrorDetail.details`，不维护 domain schema 或 API DTO。
- DirtyGuard 覆盖 TanStack Router 离开与浏览器 reload/close；调用方在保存成功后通过 RHF `reset` 清除 dirty。

### Editor

- 提供 CodeMirror 6 最小 Markdown editor，以及可单独复用的安全 `MarkdownPreview`。
- Markdown 字符串是唯一可编辑正文；不维护独立 HTML、editor JSON 或第二份 source。
- 只实现 Edit/Preview，不实现 Split 或 Diff。
- 支持 keyboard、search、undo/redo、字符数、行数、dirty、readonly、revision 和 conflict 展示入口。
- readonly snapshot 必须有清晰只读语义且不能触发 change。
- revision conflict 必须显示明确文案与重新加载按钮，不退化为 generic toast。
- Preview 必须拒绝 raw HTML、图片、事件属性、脚本和危险 URL。

## 架构约束

- 依赖方向保持 `routes -> domains -> design-system/shared`。
- Design System 不 import Product、Fact、其他 domain、route 或 OpenAPI generated 类型。
- 不从 status、role 或 UI 状态推导 action eligibility；Server 是提交、权限、revision、状态转换和业务校验的最终权威。
- 不建立万能 Workspace 配置对象、万能 Form schema、editor plugin framework、autosave framework 或 workflow engine。
- 不复制 OpenAPI DTO 作为 Form schema，不创建兼容字段、默认值或第二类型系统。

## 验收标准

- [ ] `WorkspaceShell` 在 loading/error 状态下保持 shell、context 和 reference，不出现整页 spinner 替换。
- [ ] 1440px 显示 Context/Main/Reference 三栏且 Main 最大；1024px 无页面级横向溢出；375px side panes 可通过 tabs 访问。
- [ ] Sticky Action Bar 不遮挡正文并使用 safe-area padding；disabled reason 可读，danger action 确认前不执行。
- [ ] `FormField` 正确关联 label、description、field error、`aria-invalid` 和 `aria-describedby`。
- [ ] Zod 客户端错误、RHF field server error 与 root server error 均有明确显示和焦点入口。
- [ ] DirtyGuard 在 dirty 时阻止 Router 离开和浏览器卸载；取消保留页面、确认继续、reset 后不再拦截。
- [ ] Editor 支持受控输入、Edit/Preview、搜索、undo/redo、字符数/行数和 visible focus。
- [ ] Markdown preview 对 raw HTML、`<script>`、事件属性、`javascript:` 和图片没有可执行或可加载输出。
- [ ] readonly snapshot 明显标识且不可编辑；revision conflict 有明确 reload 入口。
- [ ] Storybook 覆盖批准的 14 类场景与 375/768/1024/1440 viewport。
- [ ] Component tests、lint、typecheck、完整 Vitest、build 和 Storybook build 通过。
- [ ] 最终 diff 不包含 Product Facts 页面、API、后端、contracts、旧 `frontend/`、CI 或部署改动。

## 明确非目标

- `/products`、Product Detail、Fact Workspace 或 Fact Review 真实业务接入。
- API query/mutation、domain form schema、domain action registry、server token mapping。
- autosave、协作编辑、文件/图片上传、WYSIWYG、富文本、Split、Diff、通用 workflow engine。
- 为 Content/GEO 预建变体或扩展点。
- 修改旧 `frontend/`、后端、OpenAPI、数据库、CI、部署或稳定 Playwright E2E 基线。
- commit、merge、push、archive 或开始 Phase 1.6。

## 延后事项

Fact Review 蓝图提到 Diff，但当前 `FactReviewContext` 没有比较源或 diff contract。Phase 1.5 不实现 diff engine、diff component、占位类型或插件接口；待 Fact Review Task 具备权威 contract 和即时消费者后再独立规划。
