# 实施：Frontend V2 Content Editor

## 顺序

1. 实施并验收 `frontend-v2-content-editor-core`。
2. Core 合并回 `main` 后，再实施 `frontend-v2-content-ai-production`。
3. 两个子任务完成后运行父任务集成自审和可选 full-suite。

## 父任务集成门禁

```bash
make verify
npm --prefix frontend-v2 run build-storybook
make test-deploy-scripts
```

上述为父任务集成阶段门禁，不要求每个子任务重复运行全部检查。提交、归档、合并和删除临时分支均在执行前按 `AGENTS.md` 单独取得 Git 确认；不自动 push。

## 集成验收结果

- `make verify`：合同检查、V1/V2 generated types、lint、mypy/typecheck、backend unit `175 passed`、V1 unit `203 passed` 和视觉合同 `24 passed` 均通过；V2 unit 为 `207 passed / 1 failed`。唯一失败是既有 `app-shell.test.tsx` 未为 Product Detail loader 提供 API 响应，相关测试和 Product Detail route 均不在 Content Editor 变更中，按失败归因规则不纳入本父任务修复范围。
- `npm --prefix frontend-v2 run build-storybook`：通过；Editor route 进入构建产物，仅有既有 chunk-size warning。
- `make test-deploy-scripts`：通过；Nginx 安全头、外置主题脚本、DOM sink 与 full/fast 部署模式自检通过。
- Core 与 AI Production 已分别以实现提交 `844e015`、`3eccb04` 交付，并以 `faa847d`、`90ce34e` 独立归档；上述提交均为当前 `main` 的祖先。
- OpenAPI、FastAPI runtime、V1/V2 generated types、backend projection、V2 API/page、typed fixture、Human/AI real-stack 与数据库、架构、Frontend V2 合同/迁移/测试/ADR 文档一致。
- backend integration、V2 component/fixture、AI real-stack 与 V1 unit 直接覆盖 current pointer、不可变边界、revision conflict、action token、exact snapshot retry 和 V1 兼容。
- 最终范围审计未发现 Content Review、Publication、History 页面或通用 workflow/editor framework；这些概念只出现在范围边界、权威文档或动作过滤测试中。

## 未解决问题

- 根 `make verify` 仍受既有 Product AppShell 测试 fixture 缺口影响而返回非零；该问题早于 Content Editor，且已有独立交付记录，不修改本父任务产品代码或测试。按变更归因规则，Content Editor 验收满足归档条件。
- 后续业务任务按权威迁移顺序为 `frontend-v2-content-review`，本父任务不创建或启动该任务。
