# PartSignal Frontend

React 单页应用按业务 feature 组织，服务端状态由 TanStack Query 管理，表单和临时编辑状态保留在页面内。Markdown 是内容的唯一编辑源，预览经过 DOMPurify 清理。

## 开发命令

```bash
npm install
npm run api:generate
npm run api:check
npm run dev
npm run lint
npm test
npm run typecheck
npm run build
npm run perf:production
```

`npm run api:generate` 从 `../contracts/openapi.yaml` 生成 `src/shared/api/schema.d.ts`，`npm run api:check` 验证生成产物未漂移。业务代码不得手写重复 DTO，也不得直接修改生成文件。

开发服务器将 `/api` 代理到 `http://localhost:8000`。如前后端不在同一来源，可通过 `VITE_API_BASE_URL` 指定 API 来源；浏览器会携带 HttpOnly 会话 Cookie，写请求由统一客户端附加 CSRF Header。

测试中的 HTTP 替身只模拟冻结契约的响应和错误，不实现业务状态机。权限、状态转换、自审禁止和内容可发布性始终以服务端响应为准。

## 界面与无障碍验收

界面采用 macOS 一体式工作区双主题：中性画布、系统蓝操作色、接近不透明的业务表面，以及用于侧栏、工具栏、移动抽屉、弹窗、下拉层和悬浮操作条的有限磨砂玻璃。Card、Table、Form、Markdown、审核区和配置区不使用逐块模糊，浏览器不支持 `backdrop-filter` 时回退为高不透明表面和可见边框。

总览页是有限的管理层例外：以浅色氛围画布、紧凑指标卡、横向状态摘要和左主右辅工作区贴近管理驾驶舱布局；顶部只展示人工观测、文章结果、已推荐文章和文章推荐率四个真实 GEO 结果，审核、发布和 GEO 问题计数集中在运营状态与待办区域，快捷入口只指向现有工作流路由。页面继续使用现有玻璃 Token 与统一降级规则，不展示契约未提供的趋势、人员、动态或待办明细。

浅色、深色和跟随系统三种模式由 `src/app/ThemeProvider.tsx` 统一管理，用户选择保存在 `partsignal.theme-mode`，首屏脚本只在 React 挂载前镜像浅/深画布色以避免明显闪烁。正文使用系统字体栈，不下载 Web Font；型号、哈希、版本和数据使用等宽字体。

`src/app/theme.ts` 是颜色的唯一来源：Ant Design Token 负责组件内部状态，项目 CSS 自定义变量负责布局、Markdown、Diff、状态标签和数据可视化。`npm run lint` 会同时执行主题颜色守卫，业务 TSX/CSS 不得重新硬编码主题颜色。页面动效限定在 150–220ms，并在 `prefers-reduced-motion` 下关闭。

集合工作区使用紧凑页头与 `.collection-panel` 承载主要数据集；Card 继续负责标题、操作、提示、加载、错误和空态，Table 的宽列只在 `.table-region` 内横向滚动。列宽按内容角色分配：状态、版本、数字和操作等有明确上限的字段使用紧凑宽度，每张表至少保留一个名称或长文本弹性列吸收剩余空间；只有最小可用宽度超过容器时才启用横向滚动，关键宽表的操作列固定在右侧。AI 渠道集合默认隐藏请求超时和请求 Header、保留 API Key，并提供页面内“列设置”；详情仍使用稳定路由，不在集合页维护第二份选中状态。

高密度集合每行只保留一个详情、维护、审核或编辑主入口；删除、停用、重置等低频操作进入带中文业务标识的“更多操作”菜单，并继续经过原权限判断和确认流程。长集合表头使用 Ant Table sticky 与 72px 顶栏偏移，行内链接、按钮和菜单保持独立 Tab 顺序，`focus-within` 只提供扫读反馈。

集合视图以 URL 作为可恢复状态源：产品使用 `q/page`，内容任务和 GEO 观测使用 `page`，人工发布使用 `tab` 与三个列表各自的页码，用户管理使用 `inactive/page`。查询参数采用严格正整数和已知 Tab 校验；无效值以 replace 回到默认值，Table、Tabs 和 Switch 不保留第二份已提交状态。

长详情页按业务顺序保留在同一文档流中，并复用 `.form-section-nav` 与 `.workspace-section` 提供键盘可用的章节锚点。内容审核工作区在 375 和 768px 为单列、1024px 为双主列加全宽决策区、1440px 为 `5:4:3` 三栏；审核操作只出现在同一个粘性工具条中，条件导航链接必须与对应区块使用相同渲染条件。

章节导航通过 `IntersectionObserver` 设置 `aria-current="location"`。产品事实表单额外显示含修改/错误的章节、动态对象序号、首错摘要，以及未修改、未保存、保存中、已保存和失败状态；保存仍为显式提交，继续携带服务端修订号，不提供自动保存或离开拦截。

复合详情按查询所有权展示错误：身份查询失败保留页面标题和返回入口，次级查询只在所属 Card 或 Tab 内显示 loading、错误和重试。长期保存、删除、启停和显式状态操作使用 ThemeProvider 已提供的 Ant Design message 给出短成功反馈，不建立事件总线或第二套通知组件。

审计日志属于系统管理一级管理员入口 `/audit`，不属于配置中心；页面和服务端接口继续执行管理员权限校验。

人工验收覆盖登录页、工作台和高密度配置页的浅/深主题，并在 375、768、1024、1440px 视口检查移动抽屉、侧栏、表格横向滚动、长表单和悬浮操作条。还需检查键盘顺序、可见焦点、错误重试、加载与空状态、`prefers-reduced-motion`、禁用模糊后的可读性，以及浏览器缩放至 `200%` 后不丢失操作能力。

## 生产性能验收

`npm run perf:production` 会先执行生产构建，再用 Chromium 在 `100ms` 延迟、`1.6Mbps` 下行和 `1440×1000` 视口中分别测量禁用空闲预取的原始冷路由、启用生产预取的首次路由和热路由。每组默认使用五个全新 BrowserContext，并输出目标代码块、Mock API 与 Long Task 数据；开发服务器耗时不作为生产结论。
