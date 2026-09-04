# 实施计划

## 1. 启动前确认

- 核对主工作区仍在 `main`，记录并保护已有 dirty baseline。
- 完整读取本任务 `prd.md`、`design.md`、`implement.md`、上下文清单及相关后端规范。
- 完整读取五个允许修改文件中与 handler、应用注册、AI Model HTTP 路径和 runtime metadata 相关的最小权威单元。

## 2. 最小实现

1. 在 `backend/app/errors.py` 删除全局 `IntegrityError` handler 及无用导入。
2. 在 `backend/app/main.py` 删除 handler 导入、SQLAlchemy 异常导入和注册。
3. 在 `backend/tests/unit/test_runtime_response_metadata.py` 增加 handler 缺席与既有 handler 保留的窄断言；不增加 500 response metadata。
4. 在 `backend/tests/integration/test_ai_channel_management.py` 增加真实 PostgreSQL duplicate AI Model HTTP sentinel，覆盖 status、泄漏、审计、计数、revision、rollback/独立查询。
5. 更新 `.trellis/spec/backend/error-handling.md`，只记录本任务落地的 unknown boundary 规则。

## 3. 必需验证

先运行最窄静态/单元检查：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_runtime_response_metadata.py \
  backend/tests/unit/test_contract.py
```

运行真实 PostgreSQL sentinel 与既有 mapper/revision 回归：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_ai_channel_management.py -k 'unknown_integrity or duplicate_model'

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_platform_types.py -k 'duplicate or revision'
```

运行受影响文件的 lint/typecheck（使用项目现有命令或等价窄命令），随后执行本任务一次正式合同完成门：

```bash
make contract-check
```

`make contract-check` 只在 targeted checks 通过后的候选版本运行一次；失败后按项目完成门规则停止并报告，不在同一回合擅自重跑。

## 4. 可选验证

- 若 targeted integration 暴露共享应用边界影响，再运行完整 `test_ai_channel_management.py` 与 `test_platform_types.py`。
- 不默认运行全仓 integration/frontend/E2E；本任务不改变其合同或实现。

## 5. 独立检查与停止条件

- 实现完成后由独立 `trellis-check` 子代理检查严格文件边界、默认 500 未被合同化、真实 PostgreSQL 证据、失败副作用与回归覆盖。
- 一个 review gate 最多两次 `repair -> targeted re-check`；独立 review 只做一次 full review 和至多一次 affected-path targeted re-review。
- 若发现必须修改 service、router metadata、OpenAPI、generated/frontend、schema/migration 或新增公共 code，立即停止并报告 scope change，不在 T1 扩围。
- 不执行 Git add/commit/push。完成验证后先向用户提交 commit 计划，获得单独确认后才能提交。

## 6. 收尾检查

- 检查实际 diff，确认产品/测试/spec 修改只落在五个允许文件；Trellis 子任务工件属于授权的任务管理变更。
- 报告行为变化、实际运行的验证、跳过项和剩余风险。
- Python 触达范围执行中文文档文本检查，新增/修改的注释、docstring、日志和开发者可见文本遵守项目语言规则。

