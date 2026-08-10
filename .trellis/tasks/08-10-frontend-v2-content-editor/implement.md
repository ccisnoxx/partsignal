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
