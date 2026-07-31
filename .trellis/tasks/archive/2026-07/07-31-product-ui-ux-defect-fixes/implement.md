# 产品验收缺陷修复：执行计划

## 1. 实施顺序

- [x] 复现并记录三浏览器 print media 的布局尺寸链。
- [x] 证明零宽来自重渲染后的失效 DOM 节点，并在媒体切换后重新读取当前节点。
- [x] 运行打印定向 E2E；真实打印视图检查由最终定向用例完成。
- [x] 从 200% zoom trace 核对产品列 `td`、父容器和省略元素几何关系。
- [x] 修正产品列可收缩约束，不改其他表格业务列。
- [x] 运行真实 zoom 与桌面/移动表格几何用例。
- [x] 给列表和详情取消任务表单增加可见次按钮。
- [x] 增加次按钮不发请求、关闭后焦点恢复和主按钮提交的组件测试。
- [x] 修正 `_create_job` 的原始生成 Prompt 断言分支，并复用现有 E2E 验证自然化 Prompt 缺失的 409。
- [x] 运行相关 Vitest、E2E、lint、typecheck 和 frontend build。

## 2. 必需验证

```bash
npm --prefix frontend run test -- \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/app/AppLayout.test.tsx

npm --prefix frontend run e2e -- \
  tests/e2e/compatibility.spec.ts \
  tests/e2e/cross-page-visual-convergence.spec.ts

npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest -q tests/integration/test_generation_reliability.py
```

Playwright 定向运行必须包含 Chromium、Firefox、WebKit 的打印项目及 Chromium 真实 zoom，不得只运行默认浏览器的普通缩放。

## 3. 最终集成验证

验收门禁恢复任务完成后运行：

```bash
make e2e
```

若失败，先归因是否属于本任务四个问题；不得顺手修复无关失败。

## 4. 重点文件

- `frontend/src/styles/workspace.css`
- `frontend/src/features/content-tasks/ContentTasksPage.tsx`
- `frontend/src/features/content-tasks/ContentTasksPage.test.tsx`
- `frontend/tests/e2e/compatibility.spec.ts`
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
- `backend/app/services/content_production.py`
- `backend/tests/integration/test_generation_reliability.py`
- `frontend/tests/e2e/mvp-flow.spec.ts`

## 5. 退出门禁

- [x] 只修已确认的 `PS-QA-001` 至 `PS-QA-004`。
- [x] 没有新增依赖、表格框架、兼容分支或浏览器特判。
- [x] 没有 API、数据库、权限或状态机合同变化。
- [x] 检查 diff，确认没有用更宽的容器或删除断言掩盖问题。
- [x] `git diff --check` 通过。
- [x] 展示验证结果和提交计划，用户确认后再提交；不自动推送。
