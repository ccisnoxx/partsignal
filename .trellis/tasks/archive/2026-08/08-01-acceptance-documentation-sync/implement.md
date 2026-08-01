# 实施计划：验收文档同步

## 1. 执行顺序

- [x] 1. 用户批准本版最新规划后运行 `task.py start`；加载 `trellis-before-dev`，完整重读 `prd.md`、`design.md`、`implement.md` 和目标文档待修改段落。
- [x] 2. 以 `contracts/database.md:277-285,338` 为主，交叉核对 `contracts/openapi.yaml:1308-1317`、`backend/app/services/publication.py` 的删除守卫、迁移 `0033_task_owned_history_delete.py` 和两个定向集成测试；不改这些权威实现。
- [x] 3. 更新 `docs/deployed-full-functional-acceptance-plan.md` 的 `INV-11`、6.4 状态表和 10.2 测试对象/准备说明。
- [x] 4. 更新 `docs/GEO多平台内容运营系统方案设计.md` 中已定位的五处旧规则，使业务规则、边界表、功能说明和测试要求一致。
- [x] 5. 更新 `docs/GEO系统前后端技术与部署方案.md` 的删除概述和验收清单。
- [x] 6. 搜索三个活动文档中的旧条件，逐项核对允许清理与受保护历史，确认没有新建第二套删除规则。
- [x] 7. 运行必需验证；使用 `trellis-check` 复核范围、合同一致性和文档漂移。
- [x] 8. 检查最终 diff，明确文档是否更新、可选验证是否跳过及原因；向用户提交精确的提交范围计划并等待确认。
- [x] 9. 用户确认后仅提交批准范围，不包含 `.playwright-cli/` 诊断产物，不推送。
- [ ] 10. 提交完成后按用户指示运行 `task.py archive` 和会话日志收尾；随后建议创建独立集中回归任务。

## 2. 预计修改文件与提交边界

范围内：

- `.trellis/tasks/08-01-acceptance-documentation-sync/task.json`
- `.trellis/tasks/08-01-acceptance-documentation-sync/prd.md`
- `.trellis/tasks/08-01-acceptance-documentation-sync/design.md`
- `.trellis/tasks/08-01-acceptance-documentation-sync/implement.md`
- `docs/deployed-full-functional-acceptance-plan.md`
- `docs/GEO多平台内容运营系统方案设计.md`
- `docs/GEO系统前后端技术与部署方案.md`

范围外：合同、迁移、后端、前端、测试、生成文件、归档任务、回归报告、环境配置、`.playwright-cli/` 和 `frontend/.playwright-cli/`。

预计工作提交只包含上述任务元数据/规划文件和三份活动文档。Trellis 归档与会话日志若产生 bookkeeping 提交，按项目流程在工作提交之后单独处理。

## 3. 必需验证

### 3.1 旧口径清零

```bash
if rg -n '仅无生成作业且无内容版本时允许|只有在没有生成作业和内容版本时|已取消且无生成作业或内容版本|已有生产历史的取消任务继续保留|仅清理从未开始生产的取消任务|含作业或内容版本的取消任务不可删除' \
  docs/deployed-full-functional-acceptance-plan.md \
  docs/GEO多平台内容运营系统方案设计.md \
  docs/GEO系统前后端技术与部署方案.md; then
  exit 1
fi
```

### 3.2 当前边界存在且可人工核对

```bash
rg -n '0033|CANCELLED|APPROVED|SUPERSEDED|发布记录|修复来源|未批准|审核记录' \
  docs/deployed-full-functional-acceptance-plan.md \
  docs/GEO多平台内容运营系统方案设计.md \
  docs/GEO系统前后端技术与部署方案.md \
  contracts/database.md
```

人工逐项对照 `contracts/database.md:277-285,338`，确认三个目标文档同时覆盖状态前提、可清理历史、受保护历史和删除结果。

### 3.3 范围与格式

```bash
git diff --check
git status --short
git diff -- .trellis/tasks/08-01-acceptance-documentation-sync docs/deployed-full-functional-acceptance-plan.md docs/GEO多平台内容运营系统方案设计.md docs/GEO系统前后端技术与部署方案.md
python3 .trellis/scripts/task.py validate 08-01-acceptance-documentation-sync
```

## 4. 可选验证

运行时行为和合同不变，因此后端/前端全套、构建、E2E 和浏览器检查不作为本任务完成条件。若需要额外证明文档所述的现有删除边界，可运行：

```bash
cd backend && uv run pytest \
  tests/integration/test_publication_review_closure.py::test_cancelled_content_task_deletion_cleans_owned_history_and_protects_downstream \
  tests/integration/test_migrations.py::test_content_task_owned_history_delete_migration_is_reversible
```

七组修复的完整运行时验证留给本任务归档后的独立集中回归任务。

## 5. 完成前审查

- [x] 文档没有把 `0033` 误写成对所有生产历史的无条件级联删除。
- [x] 服务端最终权威、结构化冲突和受保护历史边界均保留。
- [x] 没有修改当前正确的合同、实现或测试，也没有改写历史归档证据。
- [x] `PS-QA2-DEC-002` 没有被重新打开或扩展。
- [x] 提交范围不含现有 Playwright CLI 诊断产物或其他未识别文件。
