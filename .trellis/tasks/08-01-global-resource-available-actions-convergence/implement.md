# 全局资源动作投影收敛：实施计划

## 0. 开始门禁

- [x] 用户评审并批准 `prd.md`、`design.md`、`implement.md` 与 `research/action-inventory.md`。
- [x] 批准后运行 `python3 ./.trellis/scripts/task.py start 08-01-global-resource-available-actions-convergence`；批准前不改业务代码。
- [x] 运行 `trellis-before-dev`，重新读取任务资料、相关后端/前端规范、OpenAPI 和每个待修改文件的完整调用链。
- [x] 确认主工作区仍为 `main`；保留并排除既有 `.playwright-cli/` 和 `frontend/.playwright-cli/` 诊断产物。

## 1. 固化合同与覆盖清单

- [x] 逐项核对 `research/action-inventory.md` 的路由、服务命令、响应 Schema 和前端入口，确认没有把集合级创建、纯 UI 或文件传输动作带入范围。
- [x] 在 `contracts/openapi.yaml` 增加各资源 typed、required `available_actions`，保留现有 action token。
- [x] 运行合同生成更新 `frontend/src/shared/api/schema.d.ts`，先用类型错误暴露所有缺失响应构造点。

## 2. 收敛后端资格所有权

- [x] 按领域从现有命令守卫提取/复用最小 `can_*` 或 action projector；命令与响应投影调用同一事实，不复制条件。
- [x] 更新后端 Schema 和 presenter，使列表、详情、嵌套资源及非删除命令响应一致返回动作。
- [x] 为引用型资格使用批量查询或现有聚合结果，禁止 serializer/presenter 逐行查库。
- [x] 保持现有命令错误、事务、并发锁、状态机、角色和审计语义不变。

## 3. 迁移前端消费者

- [x] 用户、产品/事实、平台配置、AI 配置、平台账号页面的资源命令改为消费对应 `available_actions`，移除本地角色/状态/引用资格推断。
- [x] 内容任务、生成作业、内容版本、发布候选的新增动作投影接入现有按钮/表单；既有任务、审核、发布记录、关注事项投影保持语义。
- [x] 批量用户命令只在全部选择项都包含目标动作时启用。
- [x] mutation 成功后复用现有响应写入或 query invalidation，不手工推导下一组动作。

## 4. 关闭三个原缺陷

- [x] `PS-QA2-FUNC-001`：生成作业重试仅检查 `GenerationJobOut.available_actions`。
- [x] `PS-QA2-FUNC-002`：修复页只在 `CREATE_REPAIR_TASK` 存在时提供表单，否则只读。
- [x] `PS-QA2-FUNC-003`：GEO `canCorrect` 同时约束字段、附件上传/移除与提交。

## 5. 永久测试与稳定规范

- [x] 后端现有领域测试覆盖允许/禁止投影、命令守卫一致性和关键列表无 N+1。
- [x] 前端现有 feature 测试用服务端 action 驱动入口，并为三个缺陷增加定向回归。
- [x] 新增 `.trellis/spec/backend/available-actions-contract.md`，记录服务端最终权威、per-resource typed action、同一资格规则、列表批量投影和前端消费边界；不复制完整 token 清单。
- [x] 做 touched-scope 中文注释/文案检查；只为非显然合同增加说明。

## 6. 必需验证

先运行最小定向命令；实际测试文件名在实施清单核对后固定，不用新建测试框架：

```bash
# 合同与生成类型
make contract-check

# 后端单元与 PostgreSQL 集成
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit -q
make test-integration

# 前端受影响 feature
cd frontend && npm exec -- vitest run \
  src/features/configuration/AuditLogPage.test.tsx \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/content-editor/ContentEditorPage.test.tsx \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/dashboard/DashboardPage.test.tsx \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/product-facts/ProductFactsPage.test.tsx \
  src/features/product-facts/ProductsPage.test.tsx \
  src/features/publications/PublicationsPage.test.tsx \
  src/features/settings/SettingsPage.test.tsx \
  src/features/users/UserManagementPage.test.tsx

make lint
make typecheck
```

- [x] 合同生成无差异漂移，OpenAPI required 字段与生成类型一致。
- [x] 后端定向测试覆盖本任务全部资源类别及三个原缺陷的服务端投影。
- [x] 前端定向测试覆盖所有迁移页面类别及三个原缺陷，无状态/角色本地资格旁路。
- [x] Ruff/ESLint、mypy/TypeScript 通过。
- [x] `git diff --check` 通过，未改数据库、迁移、基础设施或其他回归任务。

## 7. 可选验证

- `make test-unit`：本任务跨多个共享 Schema 和页面，若运行时间可控，推荐在定向测试后执行；否则由定向测试 + lint/typecheck 替代并报告剩余风险。
- `make test-integration`：只在共享 presenter/服务变更影响多个既有集成边界，或定向结果表明覆盖不足时执行。
- `make e2e` / `make build`：集中回归阶段统一执行；本任务只对三个原缺陷做 Playwright 冒烟时可复用现有脚本，不生成新的常驻诊断目录。
- 查询性能抽样：仅对新增引用型投影的关键列表运行 SQL 计数/日志检查，不做全站性能测试。

## 8. `trellis-check` 与提交门禁

- [x] 运行 `trellis-check`，重点核对 action token、命令守卫复用、actor 上下文、列表 N+1、生成类型和所有消费者。
- [x] 运行 `trellis-update-spec` 判定；只维护本任务新增的跨层稳定规范，不复制 OpenAPI 事实。
- [x] 检查 diff 中不存在通用动作框架、猜测性 fallback、旧本地资格分支、无关重构或手改生成文件。
- [ ] 向用户列出精确提交范围、验证结果和可选检查；取得确认后提交，绝不自动推送。

## 9. 预计提交与收尾

- 工作提交预计为一个原子提交：`fix: 收敛资源可用动作投影`。
- 若实施差异证明无法在一个可审阅提交中保持合同与消费者同步，在提交范围确认门禁提出拆分方案，不自行拆分。
- 工作提交后按 `trellis-finish-work`：确认质量门禁、运行 `task.py complete`/`archive`、记录 journal；归档和 journal 可能产生独立 Trellis bookkeeping 提交，执行前向用户说明。
- 不创建分支、不推送、不纳入现有 Playwright 诊断产物。
