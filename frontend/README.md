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

浅色、深色和跟随系统三种模式由 `src/app/ThemeProvider.tsx` 统一管理，用户选择保存在 `partsignal.theme-mode`，首屏脚本只在 React 挂载前镜像浅/深画布色以避免明显闪烁。正文使用系统字体栈，不下载 Web Font；型号、哈希、版本和数据使用等宽字体。

`src/app/theme.ts` 是颜色的唯一来源：Ant Design Token 负责组件内部状态，项目 CSS 自定义变量负责布局、Markdown、Diff、状态标签和数据可视化。`npm run lint` 会同时执行主题颜色守卫，业务 TSX/CSS 不得重新硬编码主题颜色。页面动效限定在 150–220ms，并在 `prefers-reduced-motion` 下关闭。

人工验收覆盖登录页、工作台和高密度配置页的浅/深主题，并在 375、768、1024、1440px 视口检查移动抽屉、侧栏、表格横向滚动、长表单和悬浮操作条。还需检查键盘顺序、可见焦点、错误重试、加载与空状态、`prefers-reduced-motion`、禁用模糊后的可读性，以及浏览器缩放至 `200%` 后不丢失操作能力。

## 生产性能验收

`npm run perf:production` 会先执行生产构建，再用 Chromium 在 `100ms` 延迟、`1.6Mbps` 下行和 `1440×1000` 视口中分别测量禁用空闲预取的原始冷路由、启用生产预取的首次路由和热路由。每组默认使用五个全新 BrowserContext，并输出目标代码块、Mock API 与 Long Task 数据；开发服务器耗时不作为生产结论。
