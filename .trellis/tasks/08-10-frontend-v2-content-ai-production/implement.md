# 实施：Frontend V2 Content AI Production

## 实施顺序

1. [x] 从干净 `main` 创建 `codex/frontend-v2-content-ai-production`，启动现有 Trellis task；重新审计 Core、OpenAPI、backend、fixture、组件测试和 real-stack。
2. [x] 修复 GenerationJob 最新失败作业的读取投影与 retry command 最终守卫，添加最小 backend 回归测试。
3. [x] 在现有 `content.api.ts` 增加 generation options、job summaries/detail 和 create/retry/humanization typed query/mutation。
4. [x] 新增局部 `content-ai-production` 组件，实现明确 Prompt/model 确认、稳定幂等键、活动态轮询、terminal refetch、progress/success/failure、按需 snapshot、exact retry 和 humanization。
5. [x] 在 Core Editor 页面接入 AI surface；不修改人工编辑 payload、AI DRAFT 不可变规则或 route loader。
6. [x] 扩展 typed fixture、组件测试和 `content-editor.spec.ts`，直接断言 header、payload、按需请求、轮询停止和服务端 pointer。
7. [x] 新增独立 `content-ai-real-stack.spec.ts`，复用 `deploy/scripts/e2e-local.sh` 覆盖成功生成、humanization、timeout failure、exact retry 和源版本不变。
8. [x] 更新 `docs/frontend-v2/05`、`07`、`08`、`09`，保持合同、实现、测试与迁移状态一致。
9. [x] 执行 required validation、`trellis-check`、完整 diff 自审；修复仅限本任务引入的问题。
10. [x] 展示 commit plan 并等待用户确认；不 push。

## Required validation

```sh
make contract-check

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend \
  pytest backend/tests/unit/test_generation.py

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm --build \
  backend-test pytest tests/integration/test_generation_reliability.py

npm --prefix frontend-v2 run test -- \
  src/domains/content/content-ai-production.test.tsx \
  src/domains/content/content-editor-page.test.tsx \
  src/domains/content/content-editor.model.test.ts

npm --prefix frontend-v2 run e2e -- tests/e2e/content-editor.spec.ts

make lint
make typecheck
npm --prefix frontend-v2 run build

sh -n deploy/scripts/e2e-local.sh
deploy/scripts/e2e-local.sh
```

`deploy/scripts/e2e-local.sh` 中新增的 V2 AI real-stack 必须成功。后续既有 V1 suite 若失败，按变更归因规则单独报告，不扩大本任务修复范围。

## Optional validation

```sh
make verify
npm --prefix frontend-v2 run build-storybook
```

仅在 shared contract、全局视觉 pattern 或 release readiness 需要额外证据时执行 optional validation。

## 回滚点

- Backend 守卫可独立回滚，不改变 schema 或历史数据。
- Frontend AI surface 只由 Editor 页面局部接入；回滚时不影响 Core 人工编辑闭环。
- Real-stack 仅增加独立 spec 和既有脚本中的执行项，不新增长期进程或环境变量协议。

本任务不创建第二个 Trellis task，也不修改 Core 的人工编辑合同。
