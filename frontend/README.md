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
npm run test:visual
```

`npm run api:generate` 从 `../contracts/openapi.yaml` 生成 `src/shared/api/schema.d.ts`，`npm run api:check` 验证生成产物未漂移。业务代码不得手写重复 DTO，也不得直接修改生成文件。

开发服务器将 `/api` 代理到 `http://localhost:8000`。如前后端不在同一来源，可通过 `VITE_API_BASE_URL` 指定 API 来源；浏览器会携带 HttpOnly 会话 Cookie，写请求由统一客户端附加 CSRF Header。

测试中的 HTTP 替身只模拟冻结契约的响应和错误，不实现业务状态机。权限、状态转换、自审禁止和内容可发布性始终以服务端响应为准。

## 视觉与无障碍验收

界面采用 Midnight Signal：Data-Dense Dashboard、现代冷色表面和克制的蓝/Cyan Aurora。浅色、深色和跟随系统三种模式由 `src/app/ThemeProvider.tsx` 统一管理，用户选择保存在 `partsignal.theme-mode`，首屏脚本会在 React 挂载前解析主题，避免明显闪烁。正文优先使用平台系统中文字体，避免冷缓存下载完整 CJK Web Font；型号、哈希、版本和数据使用等宽字体。

`src/app/theme.ts` 是颜色的唯一来源：Ant Design Token 负责组件内部状态，项目 CSS 自定义变量负责布局、Markdown、Diff、状态标签和数据可视化。`npm run lint` 会同时执行主题颜色守卫，业务 TSX/CSS 不得重新硬编码主题颜色。页面动效限定在 150–280ms，并在 `prefers-reduced-motion` 下关闭。

`npm run test:visual` 使用冻结的 OpenAPI 响应替身，检查登录、工作台、产品事实、内容任务、内容审核、人工发布和 GEO 观测的浅色与深色 `375`、`768`、`1024`、`1440px` 截图，并覆盖登录错误、移动 Drawer、GEO Modal、上传和表单错误。每种主题在桌面尺寸运行 axe 严重和关键规则；`tests/e2e/theme.spec.ts` 另行验证持久化、跟随系统、防闪烁和减少动态效果。视觉基线位于 `tests/e2e/visual-regression.spec.ts-snapshots/`；只有在确认设计变更符合预期后，才使用以下命令更新：

```bash
npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots
```

人工验收还需覆盖键盘顺序、可见焦点、表格横向滚动、错误重试、加载与空状态，以及浏览器缩放至 `200%` 后不丢失操作能力。

## 生产性能验收

`npm run perf:production` 会先执行生产构建，再用 Chromium 在 `100ms` 延迟、`1.6Mbps` 下行和 `1440×1000` 视口中分别测量禁用空闲预取的原始冷路由、启用生产预取的首次路由和热路由。每组默认使用五个全新 BrowserContext，并输出目标代码块、Mock API 与 Long Task 数据；开发服务器耗时不作为生产结论。
