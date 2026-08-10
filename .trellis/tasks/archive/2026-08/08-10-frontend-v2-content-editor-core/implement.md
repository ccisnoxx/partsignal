# 实施：Frontend V2 Content Editor Core

## 执行顺序

1. 更新 OpenAPI 的 Editor Context schema/operation，并补合同文档。
2. 实现 backend Editor Context projection、pointer/compare/diff/lineage 批量查询和集成测试。
3. 生成 V2 API types，扩展唯一 content query-key/API owner。
4. 实现纯 domain form mode、action/payload mapping 和 unit tests。
5. 实现 Workspace page、Split Markdown、dialogs、DirtyGuard、route 和 component tests。
6. 扩展 generated-type fixture 与 `content-editor.spec.ts`。
7. 增加独立 Human real-stack flow 并接入现有 `e2e-local.sh`。
8. 运行 `trellis-check`、最终 diff 自审、文档一致性审计。

## Required validation

```bash
make contract-check

uv run --project backend pytest \
  backend/tests/integration/test_content_editor_context.py \
  backend/tests/integration/test_content_draft_lifecycle.py \
  backend/tests/integration/test_content_task_detail.py

npm --prefix frontend-v2 run test -- \
  src/domains/content/content-editor.model.test.ts \
  src/domains/content/content-editor-page.test.tsx \
  src/design-system/editor/markdown-editor.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/content-editor.spec.ts

bash -n deploy/scripts/e2e-local.sh
deploy/scripts/e2e-local.sh
```

## Optional full-suite validation

```bash
make verify
npm --prefix frontend-v2 run build-storybook
make test-deploy-scripts
```

Optional 检查失败只有在证据表明由当前变更引起时才进入修复范围。

## 实施与验证结果

- Contract：`make contract-check` 通过；FastAPI runtime、OpenAPI 及 V1/V2 generated types 一致。
- Backend：新增 Editor Context PostgreSQL integration `3 passed`，既有 draft lifecycle `2 passed`；Ruff 与 Mypy 通过。既有 Task Detail 文件除一条旧用例外通过，该旧用例在 `main` 已尝试把受数据库触发器保护的平台外键原地置空，因此得到预期的 PostgreSQL 拒绝，不归因于本 Task。
- Frontend component：Editor model/page/MarkdownEditor 共 `17 passed`；V2 lint、typecheck、production build 通过。
- Fixture Playwright：`content-editor.spec.ts` 在 mobile/desktop 共 `22 passed`，并直接覆盖 browser Back/Forward、保存后解除 DirtyGuard、DELETE 与 ABANDON 的不同请求和 canonical 主线结果；未声明 API 继续失败。
- Real stack：隔离栈 V2 Flow A/B/C 共 `3 passed`；Flow C 使用独立 ContentTask 完成 manual → save → submit。脚本随后运行的可选 V1 全套为 `49 passed / 3 failed`，失败位于 AI 渠道审计等待、旧表格源码 marker 与不存在资源 DELETE 404/422 断言，均未触及本 Task 代码；数据库与临时存储均输出 `status=deleted`。
- V1 兼容：既有 `ContentEditorPage.test.tsx` 定向回归 `14 passed`；新增 endpoint 为 additive，旧 endpoint/response 未修改。
- 文档：已同步 OpenAPI、实现架构、Frontend V2 API/代码/迁移/测试/ADR 与 backend/frontend/infra Trellis 稳定规范；数据库结构未改变，`contracts/database.md` 已有主线与 HUMAN DRAFT 可变窗口权威约束，无需重复修改。

## Review gates 与回滚点

- OpenAPI/generated types 必须先通过 contract-check，再写 UI。
- Backend context 必须证明 pointer authority 和 fixed query count。
- Domain tests 必须冻结四类 payload 与 action matrix，再组合 Workspace。
- Fixture 必须让未声明 API 失败，并证明首屏只有 Editor Context。
- real-stack 必须使用独立 Human task，不复用 AI 或互斥状态数据。
- 发现需要 generation/retry/humanization 时停止并记录到后续子任务，不在本分支扩张。
