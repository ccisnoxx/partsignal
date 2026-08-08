# Frontend V2 Tokens + Core Primitives 实施计划

## Ordered Steps

1. 确认任务为 `planning`，分支为 `codex/frontend-v2-tokens-core-primitives`，完整读取三份任务文档、Frontend V2 规则和 Design System 相关 spec。
2. 为现有 Vite/TypeScript 配置加入 `@/*` alias，使用当前 shadcn CLI 的 `npx shadcn@latest init --base base --preset nova --css-variables --no-pointer --no-rtl --no-monorepo --yes` 初始化 Base UI + Nova，随后把 `components.json` 的路径限定到 Design System 与 shared utils。CLI 4.16.2 已不接受旧的 `base-nova` preset 参数。
3. 用 `npx shadcn@latest docs` 核对 10 个 upstream primitives 的当前 Base UI 用法，再用 CLI dry-run/add 生成 Button、Input、Select、Badge、Tooltip、DropdownMenu、Dialog、Sheet、Tabs、Skeleton；逐个读取生成源码。
4. 将 `global.css` 收敛为 token 单一权威源：PartSignal 语义值、Tailwind/shadcn 引用映射和最小 base styles；删除 dark、chart、sidebar 等未批准 token。
5. 只做必要源码调整：Badge 增加 success/warning/info，Dialog/Sheet overlay 使用 scrim token，IconButton 组合复用 Button；不增加业务 variant 或 wrapper。
6. 接入应用 Tooltip provider；创建最小 Storybook 配置、scripts 和每个 primitive 的 review story，全部共享 `global.css`。
7. 增加 token contract 与 core primitive 组合测试；只在证实 jsdom 缺口时修改 `src/test/setup.ts`。
8. 执行 Required Validation；失败时先归因，只修复本任务引入的问题。
9. 启动 Storybook 并用独立 `playwright-cli` session `frontend-v2-tokens-core-primitives` 验证 keyboard/focus、Menu、Dialog、Sheet 与 narrow viewport；关闭并确认 session 不再运行。
10. 按 Trellis check 自审最终 diff、依赖消费、单一 token 权威、依赖方向和范围；报告后等待 commit plan 确认。

## Package Scripts

```json
{
  "storybook": "storybook dev -p 6006",
  "build-storybook": "storybook build --output-dir dist/storybook"
}
```

现有 `dev`、`build`、`lint`、`typecheck`、`test` 等 scripts 保持原义。

## Required Validation

按顺序运行：

```bash
npm --prefix frontend-v2 ci
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run build-storybook
git diff --check
git diff --exit-code main -- frontend backend contracts Makefile .github
```

Visual QA 也是本任务 Required Validation：启动本地 Storybook 后，使用命名 session `frontend-v2-tokens-core-primitives` 检查 keyboard/focus、DropdownMenu、Dialog、Sheet 和 375px narrow viewport，并在最终报告前关闭该 session。

## Optional Validation

- `npm --prefix frontend-v2 run api:check`：本任务不修改 OpenAPI 派生物，默认不要求；如最终 diff 涉及 generated API 路径则必须升级为 Required。
- V1、backend 和仓库级全套测试：目标目录均无修改，默认不运行；范围检查替代。若 diff 或失败证据指向这些区域，再单独评估。

## Review Gates

- `global.css` 是所有 token 值的唯一权威；没有 tokens JSON/TS、Storybook theme 副本或 feature/story 原始颜色。
- 每个直接依赖都能映射到当前源码、配置、story 或测试消费者；移除未消费项。
- Design System 不导入 domain、route、API 或业务状态。
- 搜索确认没有 Ant Design/V1 theme、原始状态色、`.dark`、通用 Form/DataTable/Action Registry、未来 wrapper/barrel/空目录。
- Base UI composition 使用 `render`；Select/Menu group、Dialog/Sheet title、Tooltip provider、IconButton accessible name 均符合契约。
- 检查 375/768/1024/1440 的适用 story、focus 可见性和 overlay 可操作性。
- 检查新增开发者文本；本任务不触及 Python 业务代码，不为生成源码补机械注释。
- 报告 Outcome、Changed Files、Architecture、Validation、Documentation、Residual Risks、Recommended Next Task、Branch/Commit/Merge，并等待 commit plan 确认。

## Rollback Point

任务提交是唯一回滚点。整体回退该提交即可移除 token、primitives、Storybook、测试和新增依赖；不涉及合同、数据库或部署迁移。提交前若需撤销，只能对本任务明确新增/修改文件做定向恢复，不使用 broad reset，不覆盖其他用户改动。
