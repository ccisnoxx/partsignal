# Frontend E2E exit gate 合同漂移

## Goal

对齐三个阻塞 Frontend V2 Phase 3 exit gate 的既有 V1 E2E 断言与当前权威数据库、OpenAPI 和生产 UI 合同，使完整 `make verify` 恢复通过；不得为了测试通过改变现有正确业务合同。

## Background and confirmed facts

- 规划前已执行 `git fetch origin main`；基线为干净 `main` commit `33e21233b29dbc5264d5a357ed93f09b51e62e27`，`origin/main...main = 0/83`，本地不落后远端。
- `33e2123` 是前置 Task `frontend-v2-content-task-detail-platform-fixture` 的交付提交，已位于当前 `main` 祖先链；不复用或修改该 Task 的历史结论。
- 使用 `127.0.0.1:55432` PostgreSQL、`127.0.0.1:56379/15` Redis 和 `deploy/scripts/e2e-local.sh` 的临时数据库生命周期精确选择三个用例：固定 V2 real-stack 前置套件 `7 passed`，目标套件 `1 passed / 3 failed`。
- `ai-channel-management.spec.ts:130` 在页面已真实完成模型测试、模型启用和渠道启用后，等待不存在的 `ai_model.tested` 超时。
- `cross-page-visual-convergence.spec.ts:604` 在进入浏览器步骤前即因清单 marker `label="AI 作业列表"` 与源码 `label="AI 生成记录列表"` 不一致失败。
- `mvp-flow.spec.ts:284` 的管理员不存在产品 DELETE 缺少必填 query，实际返回 `422`，未进入预期的 `404 NOT_FOUND` 业务语义。
- 复现结束确认临时数据库 `partsignal_e2e_20260811_3912` 和临时存储均删除，PostgreSQL 无 `partsignal_e2e_%` 残留。

## Authoritative contract decisions

1. `0037_simplify_deletion_lifecycle.py` 与运行时 `backend/app/audit_types.py` 的 `RETAINED_AUDIT_ACTIONS` 均包含 `ai_model.enabled`，均不包含 `ai_model.tested`。
2. `test_ai_model` 只在修订号复核后回写 `test_status`、`last_test_error_summary`、`last_tested_at`、`is_enabled=false` 和 revision；它不调用 `append_audit`，符合 0037 后永久审计只保留白名单成功事件的数据库合同。
3. 失败 E2E 的真实 UI 流程在连接测试后显式调用模型启用；`set_model_enabled` 写入带脱敏 `facts.channel_id` 的 `ai_model.enabled`，渠道审计查询会投影该事件。因此该流程应断言 `ai_model.enabled`，而不是恢复或伪造 `ai_model.tested`。
4. `.trellis/spec/backend/ai-configuration-guidelines.md` 仍声称连接测试/模型发现进入审计，`test_ai_model` docstring 仍声称回写事务追加脱敏审计；两者与数据库合同和实现矛盾，属于本 Task 的稳定规范漂移。
5. `ContentTasksPage.tsx` 的真实 `TableRegion` 已稳定为“AI 生成记录列表”；production 页面和 TableRegion 名称不改，源码清单应与其一致。
6. `contracts/openapi.yaml` 的 `deleteProduct` 要求 query 参数 `expected_revision`，类型为最小值 `0` 的必填整数。
7. 管理员不存在资源的 `404` 请求与工程师权限 `403` 请求都应先构造合同有效的产品 DELETE，即使用 `?expected_revision=0`；E2E 不依赖请求校验与权限依赖的内部执行顺序。

## In Scope

- `frontend/tests/e2e/ai-channel-management.spec.ts`：保留 `ai_channel.created`，把过期的 `ai_model.tested` 断言替换为该流程真实产生且永久保留的 `ai_model.enabled`。
- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`：仅把对应 inventory 项的 `label`、`marker`、`regionLabel` 对齐为“AI 生成记录列表”。
- `frontend/tests/e2e/mvp-flow.spec.ts`：管理员 404 和工程师 403 两处不存在产品 DELETE 都补充 `?expected_revision=0`。
- `.trellis/spec/backend/ai-configuration-guidelines.md`：纠正连接测试/模型发现写永久审计的错误陈述。
- `backend/app/services/ai_configuration.py`：仅纠正 `test_ai_model` docstring，不改变 production behavior。
- 本 Trellis Task 的规划、复现与后续执行记录。
- 用户后续授权处理第一次纠偏后同轮暴露的三个失败：
  - `ai-channel-management.spec.ts` 的 1440px 渠道宽表断言改为验证 `TableRegion` 内局部横向滚动和固定操作列边界，不再把 Ant 固定列覆盖未滚入视口的普通列误判为重叠；
  - `AuditLogPage.tsx` 的时间列为完整北京时间文本保留足够宽度；
  - `mvp-flow.spec.ts` 使用生产弹窗当前稳定按钮名“创建自然化生成记录”。
- 用户追加授权处理 MVP 最终清理阶段暴露的内容任务删除回归：保留数据库只允许受控断开 `source_job_id` 的窄窗口，修正 0042 `updated_at` ORM `onupdate` 对内部批量断链 UPDATE 的意外扩展，并补 PostgreSQL 集成回归。
- 只有完整 `make verify` 全绿后，才在 `docs/frontend-v2/07-migration-plan.md` 追加本 Task 证据并把当前 Phase 3 exit gate 判为 `MET`。

## Out of Scope

- 不重新加入 `ai_model.tested`，不修改 `RETAINED_AUDIT_ACTIONS`、审计 schema、migration 或数据库。
- 不修改 OpenAPI，不改变 DELETE API 的校验顺序、状态码、权限或删除资格；只恢复数据库合同已明确允许的任务聚合断链行为。
- 不修改 frontend production 页面、TableRegion 名称或 Content Task Detail fixture。
- 不新增依赖、通用 E2E helper/framework、兼容分支或第二套审计来源。
- 不改变 AI 三栏布局、审计时间格式、自然化 API 或自然化业务行为；不通过放宽全局视觉断言掩盖裁切。
- 不修改历史 migration、数据库触发器或不可变边界；不允许受控删除窗口修改 `updated_at` 及 `source_job_id` 以外字段。
- 不改写前置 Task、归档 Task 或更早 Phase 3 `NOT_MET` 历史结论。
- `make verify` 若出现新的范围外失败，只记录证据并停止，不扩大范围追修。

## Acceptance Criteria

- [x] `ai-channel-management.spec.ts:130` 继续证明渠道创建审计，并通过 `ai_model.enabled` 证明该真实模型流程的永久审计事件。
- [x] AI 配置稳定规范与 `test_ai_model` docstring 明确连接测试只回写测试状态、不写永久审计；production 实现无行为变化。
- [x] 全站 25 张业务表清单仍为 25 项，目标 inventory 的三项名称全部与 `ContentTasksPage` 的“AI 生成记录列表”一致，桌面/移动边界断言继续执行。
- [x] 管理员不存在产品 DELETE 以合同有效请求返回 `404 NOT_FOUND`，工程师同类请求以合同有效请求返回 `403`。
- [x] 三个精确 targeted E2E、frontend lint、frontend typecheck、backend Ruff、backend mypy、`make verify` 与 `git diff --check` 全部通过。
- [x] `make verify` 全绿前不修改迁移计划；全绿后追加本 Task 证据与当前 `MET`，同时保留前置 Task 当次 `make verify` 未全绿的 `NOT_MET` 记录和更早全部 `NOT_MET` 历史。
- [x] 最终 diff 只包含批准范围，临时 E2E 数据库与存储均已清理。
- [x] AI 渠道 1440px 验证符合宽表只能在 `TableRegion` 内滚动的视觉合同，固定操作列保持在局部视口内。
- [x] 审计日志 375px 横向表格中的完整北京时间不裁切、不换行。
- [x] MVP 自然化流程通过当前生产按钮“创建自然化生成记录”发起真实请求。
- [x] 带终态 AI 生成作业和 AI 内容版本的未发布任务可按现有 DELETE 合同返回 204；内部断链不触碰内容版本真实 `updated_at`，普通不可变内容 UPDATE 仍由数据库拒绝。
