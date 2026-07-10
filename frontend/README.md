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
```

`npm run api:generate` 从 `../contracts/openapi.yaml` 生成 `src/shared/api/schema.d.ts`，`npm run api:check` 验证生成产物未漂移。业务代码不得手写重复 DTO，也不得直接修改生成文件。

开发服务器将 `/api` 代理到 `http://localhost:8000`。如前后端不在同一来源，可通过 `VITE_API_BASE_URL` 指定 API 来源；浏览器会携带 HttpOnly 会话 Cookie，写请求由统一客户端附加 CSRF Header。

测试中的 HTTP 替身只模拟冻结契约的响应和错误，不实现业务状态机。权限、状态转换、自审禁止和内容可发布性始终以服务端响应为准。
