# Baseline Touch Set

## 创建前基线

- Branch：`main`
- HEAD：`1d937d5ba44ac06af7c68b57f76cc3388714ea90`
- `git status --porcelain=v1`：550 行
- 完整 porcelain SHA-256：`cd37e4877751f6cf3a73f5c963ec6ee50d8c9378af5447e928463fba03cebe66`
- staged 文件：543 个，全部位于 `artifacts/`

该 550 行状态整体是本独立 Task 的受保护范围外基线；它包括更早的 `.gitignore`、`configuration.py`、543 个 staged artifact deletions，以及正在实施但未提交的 Wave 3 候选。

## Wave 3 受保护候选

Wave 3 保持 `in_progress`，本 Task 不修改或提交：

- `backend/app/routers/publication.py`
- `backend/app/routers/observation.py`
- `backend/app/routers/workbench.py`
- `backend/tests/unit/test_runtime_response_metadata.py`
- `.trellis/tasks/09-02-runtime-response-metadata-wave-3/`

创建本 Task 后记录的四个代码/测试文件 binary diff SHA-256：

`0f3b6a7f7aa4d5e850731afb0dd9d28b91ab9f2b25cd4c0f6c2707185c940ddc`

Wave 3 Task 目录逐文件 hash 汇总 SHA-256：

`310e52b166eaec360414922e5729ed154369adcb09d7704726c25ae56cc01bb3`

## 本 Task 允许 touch set

产品、测试与稳定规范精确为：

- `backend/app/services/publication.py`
- `backend/tests/integration/test_publication_workflow.py`
- `.trellis/spec/backend/publication-workbench-guidelines.md`

以及本 Task 目录：

- `.trellis/tasks/09-02-publication-event-time-order-authority-repair/`

## 禁止 touch / commit

- `.gitignore`
- `artifacts/`
- `backend/app/schemas/configuration.py`
- Wave 3 全部候选与 Task artifacts
- `.trellis/tasks/08-30-v2-live-readonly-acceptance/`
- contracts、generated client、models、migration、routers、其他 service/test/spec

## Scope Gate

规划完成时，过滤本 Task 新目录后，porcelain 必须仍精确等于创建前 550 行基线与其 SHA-256。实施期间只允许额外出现上述三个目标文件。提交必须使用 `git commit --only -- <精确路径>`，不能让 index 中的 543 个 artifact deletions 随提交进入历史。
