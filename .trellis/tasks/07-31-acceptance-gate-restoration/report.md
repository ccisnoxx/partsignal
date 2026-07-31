# 验收门禁恢复实施报告

## 结论

测试夹具、现行合同、生产 CSP 壳层、视觉基线和 E2E 运行隔离已经恢复。最终批准的
五组 E2E 为 `19 passed / 3 failed`；三个失败均能稳定定位到产品实现，不再包含本任务
负责的假失败。项目验收仍阻断，产品修复任务为
`07-31-product-ui-ux-defect-fixes`。

## 已恢复门禁

- 后端生成可靠性夹具使用可复用 `platform_prompts` 和平台当前绑定。
- 迁移测试分别锁定目标迁移，fresh head 更新到 `0033_task_owned_history_delete`。
- 24 表特殊 Modal 使用明确关闭动作并等待隐藏；桌面 24 表流程不再被遮挡超时。
- Trusted Types 使用生产构建预览和权威 Nginx CSP，Chromium、Firefox、WebKit 均通过。
- Prompt DELETE、内容任务幂等键、`content-markdown-v3`、管理员 403 与当前合同一致。
- Prompt 三张视觉基线更新为当前批准的可复用模板页面，并完成人工核对。
- GEO 文档和 E2E 统一为发现率、提及率、准确率三项正式指标。
- 每次 E2E 使用独立 PostgreSQL 数据库和临时存储；成功或失败均精确清理本次资源。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `make test-integration` | `68 passed` |
| `make lint` | 通过 |
| `make typecheck` | 通过 |
| 五组定向 E2E | `19 passed / 3 failed` |
| Trusted Types 三浏览器 | 通过 |
| 前端生产构建 | 通过，由每次 E2E 启动脚本真实执行 |
| `sh -n deploy/scripts/e2e-local.sh` | 通过 |
| `python -m py_compile deploy/scripts/e2e-database.py` | 通过 |
| `git diff --check` | 通过 |
| E2E teardown | 数据库与临时存储均 `status=deleted` |

## 剩余产品阻断

1. `PS-QA-002`：内容任务表在 `/tasks @ 375px` 和真实 200% zoom 的
   `/tasks @ 720px` 中，省略文本越出所属单元格。
2. `PS-QA-004`：未配置全局自然化 Prompt 时，
   `POST /api/v1/content-versions/{id}/humanization-jobs` 因 `_create_job` 的错误断言
   返回 500，而合同要求 409 `HUMANIZATION_PROMPT_MISSING`。
3. 父任务已确认的 `PS-QA-001` GEO 打印宽度和 `PS-QA-003` 取消任务可见次操作，
   继续由同一产品修复任务处理。

## 边界说明

- 本任务没有修改生产业务代码、OpenAPI、数据库模型、权限或状态机。
- 24 表移动流程在 `/tasks @ 375px` 被真实产品缺陷阻断；桌面流程已覆盖全部登记表面，
  Modal 遮挡超时不再出现。
- 没有执行完整 `make e2e`；批准的定向组合已覆盖本任务变更，完整套件留待产品修复后
  作为最终验收。
