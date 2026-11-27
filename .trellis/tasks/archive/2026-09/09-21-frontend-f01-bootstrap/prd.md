# F01 应用启动、类型化 API 与状态 Provider

## Goal

完成清单 F01：确认本轮候选的应用启动、类型化 API 与状态 Provider 可运行；针对真实缺口做最小修复。

## Requirements

- 前置：R00 完成。来源：`11` F01、`01` 技术架构、`06` 代码架构、`08` Foundation 验收、`.trellis/spec/frontend/` 的相关规范。
- React 19、TypeScript、Vite、TanStack Router/Query Provider 和应用入口为唯一 canonical `frontend/` 实现；启动时会话状态与路由上下文正确衔接。
- API client 使用根 `contracts/openapi.yaml` 生成类型；构建时的 API base URL 与本地 proxy 有明确入口，生成类型可用 `api:check` 核对。
- 生产构建和针对 Provider 的直接测试在本轮候选上运行；失败须归因，已有合格实现可以保留且记录本轮证据。

## Acceptance Criteria

- [x] 应用入口、Provider、Router、Query 与 typed API client 的实现符合上述边界，缺口得到修复或明确说明。
- [x] `npm run api:check`、`npm run typecheck`、针对 Provider 的测试及 `npm run build` 通过；生产产物存在。
- [x] 检查实际 diff 与原工作树，记录本轮验证、未运行项和 F02 下一步。

## Scope

仅覆盖 F01 启动、类型化 API 与状态 Provider；视觉 Token、认证流程与导航分别由 F02–F04 验收。任何后续编号的历史实现都不因 F01 通过而自动通过。

## 本轮实际交付与证据

- 现有实现保留：`frontend/src/main.tsx` 为 Vite/React 入口；`src/app/providers.tsx` 组合 Query/Auth/Router；`src/app/router.ts` 使用生成路由树；`src/shared/api/client.ts` 以 generated `paths` 创建 `openapi-fetch` client，`VITE_API_BASE_URL` 与 `vite.config.ts` 的本地 proxy 为环境入口。`frontend/package.json` 采用所需主栈。
- 代码修复：`frontend/src/domains/publication/publication-work-page.test.tsx` 将条件失败注入放进既有 GET mock，避免保存泛型 `getMockImplementation()` 后调用时参数被推断为 `never`；测试原有的精确 query 失败场景保留。应用代码和合同未变。
- 首次 `npm run typecheck` 在上述测试第 351 行报 TS2345；修复后重跑通过。修复后该测试 8/8 通过，Provider/Auth 相关两文件 9/9 通过。
- 本轮执行：`npm run api:check` 通过（OpenAPI generated types 与根合同一致）；`npm run lint` 通过；`npm run typecheck` 通过；`npm run build` 通过且生成 `frontend/dist/index.html`。`git diff --check` 通过，受跟踪代码 diff 仅上述测试文件。
- 本项未执行生产预览浏览器 smoke 或真实服务端 E2E；这两类行为不由构建成功推断。Vite 报告 Markdown 编辑器 chunk 超过 500 kB 的警告，未有实际瓶颈测量，本项不作性能结论。
- 下一项 F02：核对 Token、核心 primitives、桌面与窄屏视觉及焦点语义；F03–F07 随其前置关系继续。
