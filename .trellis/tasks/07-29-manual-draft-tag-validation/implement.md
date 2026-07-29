# 实施计划

## 实施步骤

1. 收紧并统一服务端标签类型：
   - 修改 `backend/app/schemas/content.py` 的共享标签类型和 `ContentRevisionCreate.tags`。
   - 修改 `backend/app/schemas/geo_files.py`，让 `GeneratedDraft.tags` 复用同一类型并移除重复标签空白判断。
2. 同步公共契约：
   - 修改 `contracts/openapi.yaml` 的 `ContentRevisionCreate.tags`。
   - 运行前端既有 API 生成命令更新 `frontend/src/shared/api/schema.d.ts`。
3. 增加共享前端规则：
   - 新增最小的 `frontend/src/shared/contentValidation.ts`。
   - 在 `ContentTasksPage.tsx` 与 `RevisionForm.tsx` 复用规则和精确字段错误映射。
4. 增加最小回归：
   - `ContentTasksPage.test.tsx` 覆盖必填/可访问语义、空数组、空白标签、有效 payload 和服务端字段错误。
   - `ContentEditorPage.test.tsx` 覆盖删除最后一个标签、恢复有效标签和原 payload。
   - `backend/tests/unit/test_contract.py` 通过真实 FastAPI 请求边界覆盖空数组和空白标签均返回结构化 422。
5. 更新 `.trellis/spec/backend/database-guidelines.md` 的“Markdown 产品事实与双首稿内容生产”契约，记录共享标签边界和必需回归。
6. 检查最终 diff，只保留 DEF-03 相关修改，并隔离工作区中既有未提交改动。

## 必需验证

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.tools.contract_check contracts/openapi.yaml
cd frontend && npm exec vitest -- run src/features/content-tasks/ContentTasksPage.test.tsx src/features/content-editor/ContentEditorPage.test.tsx
cd frontend && npm run typecheck
cd frontend && npm exec eslint -- src/shared/contentValidation.ts src/features/content-tasks/ContentTasksPage.tsx src/features/content-tasks/ContentTasksPage.test.tsx src/features/content-editor/RevisionForm.tsx src/features/content-editor/ContentEditorPage.test.tsx --max-warnings 0
```

## 可选验证

```bash
cd frontend && npm run api:check
```

完整后端集成套件、前端全量 Vitest、完整 build 和 E2E 不作为本缺陷的完成门禁：本次不改数据库、状态机或布局；针对性请求边界、两个表单组件、契约检查、typecheck 和 lint 能直接覆盖变更。若目标检查暴露与当前变更有关的共享回归，再扩大验证。

## 风险与检查点

- `contracts/openapi.yaml`、生成 schema 和相关 Trellis specs 已有用户未提交改动；只修改 DEF-03 对应片段，生成后核对无关 diff。
- Ant Select 的 tags 模式对纯空白交互可能自行忽略；共享 validator 仍必须用直接规则测试覆盖 `["   "]`，组件测试验证最终不发请求。
- 现有测试夹具可能包含历史 `ContentVersion.tags=[]`；输出读取仍允许，只有创建新 revision 时要求用户补充有效标签。
