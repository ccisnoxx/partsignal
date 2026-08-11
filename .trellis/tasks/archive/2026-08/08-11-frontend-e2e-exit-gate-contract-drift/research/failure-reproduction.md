# 三个 E2E exit gate 失败复现与合同核验

## 1. 基线与隔离

- 时间：2026-08-11（Asia/Shanghai）。
- `git fetch origin main` 后：`main` commit `33e21233b29dbc5264d5a357ed93f09b51e62e27`，`origin/main...main = 0/83`，本地不落后远端。
- 前置 Task 提交核验：`git merge-base --is-ancestor 33e2123 main` 成功；`git show 33e2123` 同时包含前置 Task 产物和 `backend/tests/integration/test_content_task_detail.py` 修复。
- 创建本 Task 前工作树干净；复现时 tracked code 仍为同一干净 commit，唯一未跟踪内容是新建的本 Task 规划目录，不参与应用构建或测试。
- PostgreSQL：Docker `partsignal-dev-postgres-1`，`127.0.0.1:55432`，healthy。
- Redis：Docker `partsignal-dev-redis-1`，`127.0.0.1:56379/15`，healthy。
- 只显式导出 `DATABASE_URL`、`REDIS_URL`；未使用 `set -a`，未连接服务器 PostgreSQL。

## 2. 精确复现命令

```bash
export DATABASE_URL='postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal'
export REDIS_URL='redis://127.0.0.1:56379/15'
deploy/scripts/e2e-local.sh \
  tests/e2e/ai-channel-management.spec.ts:130 \
  tests/e2e/cross-page-visual-convergence.spec.ts:604 \
  tests/e2e/mvp-flow.spec.ts:284 \
  --project=e2e
```

编排先创建 `partsignal_e2e_20260811_3912`，迁移到 `0042_content_version_detail`，构建 V1/V2、seed 并启动 API、临时对象存储、fake AI、Celery 与两套前端。

固定 V2 real-stack 前置结果：

```text
7 passed (41.4s)
```

V1 精确选择结果：

```text
3 failed
1 passed (19.9s)
```

额外的 `1 passed` 是 Playwright `setup` 项；三个目标业务用例全部按预期失败。

## 3. 失败 1：过期永久审计事件

```text
frontend/tests/e2e/ai-channel-management.spec.ts:130
管理员通过三栏页面完成渠道、凭据、Header、模型、测试与删除闭环

Locator: getByText('ai_model.tested', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found
实际失败断言：ai-channel-management.spec.ts:356
```

根因与合同：

- `backend/alembic/versions/0037_simplify_deletion_lifecycle.py:14-34` 的迁移白名单含 `ai_model.enabled`，不含 `ai_model.tested`。
- `backend/app/audit_types.py:33-54` 的运行时白名单保持同一判断。
- `backend/app/services/ai_configuration.py:885-923` 的 `test_ai_model` 真实回写测试状态但不调用 `append_audit`。
- 同文件 `945-977` 的 `set_model_enabled` 写入 `ai_model.enabled`，并在 `facts.channel_id` 保存脱敏渠道关联。
- E2E 在失败断言前已经真实调用“启用模型”，所以 `ai_model.enabled` 是该流程真实产生、仍永久保留且能被渠道日志查询投影的模型事件。
- `.trellis/spec/backend/ai-configuration-guidelines.md:30-31` 与 `test_ai_model` docstring 仍错误声称测试/发现写审计，需要同步文字合同；不能恢复 `ai_model.tested`。

## 4. 失败 2：TableRegion 清单名称漂移

```text
frontend/tests/e2e/cross-page-visual-convergence.spec.ts:604
全站 25 张业务表的源码清单与桌面、移动页面边界保持一致

Error: AI 作业列表 未命中登记的源码标记
Expected substring: label="AI 作业列表"
实际失败断言：cross-page-visual-convergence.spec.ts:609
```

根因与合同：

- inventory 第 18 行的 `label`、`marker`、`regionLabel` 仍使用旧名“AI 作业列表”。
- `frontend/src/features/content-tasks/ContentTasksPage.tsx:1026-1047` 的卡片、loading/error 和 `TableRegion` 已一致使用“AI 生成记录”；稳定可访问名称是 `label="AI 生成记录列表"`。
- 失败发生在源码 marker 预检，尚未进入桌面/移动浏览器边界扫描。只改 inventory 三个登记字段即可恢复真实边界验证；production 页面不改。

## 5. 失败 3：产品 DELETE 缺少必填 revision

```text
frontend/tests/e2e/mvp-flow.spec.ts:284
批准事实到人工发布、GEO 观测及删除与归档生命周期保持完整追溯

Expected: 404
Received: 422
实际请求：DELETE /api/v1/products/<nonexistent UUID>
实际失败断言：mvp-flow.spec.ts:301
```

根因与合同：

- `contracts/openapi.yaml:362-368` 规定 `deleteProduct` 的 `expected_revision` query 为必填整数，最小值 `0`。
- 管理员不存在资源请求缺少 query，因此在资源查询前按合同返回 `422`；测试没有构造出它想验证的 `404 NOT_FOUND` 场景。
- 同文件工程师权限用例 `mvp-flow.spec.ts:136-145` 的产品 DELETE 也缺少 query。即使当前依赖顺序仍返回 `403`，该请求不是合同有效输入，不能稳定证明权限边界。
- 两处都使用 `?expected_revision=0`；不存在 UUID 不会命中真实 revision，管理员可验证 404，工程师可验证 403。

## 6. 清理证据

脚本退出输出：

```text
E2E_CLEANUP database=partsignal_e2e_20260811_3912 status=deleted
E2E_CLEANUP storage=.../partsignal-e2e-storage.nZ7lDw status=deleted
```

随后查询：

```sql
SELECT datname FROM pg_database
WHERE datname LIKE 'partsignal_e2e_%'
ORDER BY datname;
```

结果为空，未残留临时 E2E 数据库。
