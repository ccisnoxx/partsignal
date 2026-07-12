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
npm run test:visual
```

`npm run api:generate` 从 `../contracts/openapi.yaml` 生成 `src/shared/api/schema.d.ts`，`npm run api:check` 验证生成产物未漂移。业务代码不得手写重复 DTO，也不得直接修改生成文件。

开发服务器将 `/api` 代理到 `http://localhost:8000`。如前后端不在同一来源，可通过 `VITE_API_BASE_URL` 指定 API 来源；浏览器会携带 HttpOnly 会话 Cookie，写请求由统一客户端附加 CSRF Header。

测试中的 HTTP 替身只模拟冻结契约的响应和错误，不实现业务状态机。权限、状态转换、自审禁止和内容可发布性始终以服务端响应为准。

## 视觉与无障碍验收

界面以 Data-Dense Dashboard 与 Swiss Grid 为基础，统一使用工程纸张、深绿控制台和橙色信号色。正文采用 Noto Sans SC，型号、哈希、版本和数据使用等宽字体；Design Token 和 Ant Design 主题集中定义在 `src/app/theme.ts`，共享页面头、指标卡和表格容器位于 `src/shared/components/`。

`npm run test:visual` 使用冻结的 OpenAPI 响应替身，检查工作台、产品事实、内容任务、内容审核、人工发布和 GEO 观测的 `375`、`768`、`1024`、`1440px` 截图，并在桌面尺寸运行 axe 严重和关键规则。视觉基线位于 `tests/e2e/visual-regression.spec.ts-snapshots/`；只有在确认设计变更符合预期后，才使用以下命令更新：

```bash
npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots
```

人工验收还需覆盖键盘顺序、可见焦点、表格横向滚动、错误重试、加载与空状态，以及浏览器缩放至 `200%` 后不丢失操作能力。
