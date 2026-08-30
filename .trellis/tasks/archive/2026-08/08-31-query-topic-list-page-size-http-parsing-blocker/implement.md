# Query Topic page_size HTTP 解析实施计划

## 1. 启动前门禁

- [ ] 用户已 review 并明确批准本 Task 最新 `prd.md`、`design.md` 与 `implement.md`。
- [ ] 批准后才运行 `python3 ./.trellis/scripts/task.py start 08-31-query-topic-list-page-size-http-parsing-blocker`；本轮规划不得运行。
- [ ] 启动实施前重新确认主工作区在 `main`，记录完整 dirty snapshot，并把基线规划、线上只读验收、既有归档研究和验收 artifacts 继续视为其他任务修改。
- [ ] Phase 2 使用 `trellis-implement` 子代理时，dispatch prompt 以 `Active task: .trellis/tasks/08-31-query-topic-list-page-size-http-parsing-blocker` 开头，并加载本 Task 的 JSONL、PRD、设计和实施计划。

## 2. 实施步骤

1. 完整复读本 Task 三份规划文档、上下文清单、相关 backend spec、`backend/app/routers/planning.py` 与 `backend/tests/unit/test_contract.py` 的相邻 HTTP parser 测试。
2. 只修改 `list_query_topic_items.page_size` 的 `Annotated` 元数据，复用 `BeforeValidator(int)`；不改变 schema、service、默认值、枚举或 endpoint shape。
3. 在 `backend/tests/unit/test_contract.py` 增加真实 `TestClient` 回归：
   - 参数化验证显式 10、20、50；
   - 单独验证省略参数默认 20；
   - 单独验证非枚举 30 返回 `422 VALIDATION_ERROR` 且未调用 collaborator；
   - 每条成功路径都断言 collaborator 收到 Python `int` 和响应 `page_size`。
4. 先运行定向 HTTP 回归；若失败，只调查 router binding、测试 override 或可归因的 response-model 问题，不改静态合同或 service 规避。
5. 运行 Ruff、backend mypy 和 contract check，核对 OpenAPI/generated 无 Task diff。
6. 由 `trellis-check` 对完整 Task diff 执行 spec、验收、测试和范围复核；清除任何 symptom patch、重复类型、fallback 或无关修改。
7. 执行 `trellis-update-spec` 判断。本 Task 预计复用已存在模式而不产生新规范；若实施中发现新的稳定边界知识，再单独说明并在授权范围内更新相关 backend spec。
8. 本地验证完成后，先向用户提交 commit 计划与文件清单并等待确认。不自动 push、不部署。

## 3. Required Validation

以下检查均为本 Task 的必需门禁：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py::test_query_topic_list_accepts_page_size_from_query_string \
  backend/tests/unit/test_contract.py::test_query_topic_list_uses_integer_default_page_size \
  backend/tests/unit/test_contract.py::test_query_topic_list_rejects_non_enum_page_size \
  -q
```

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/routers/planning.py \
  backend/tests/unit/test_contract.py
```

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml \
  backend/app
```

```bash
make contract-check
```

```bash
git diff --check -- \
  backend/app/routers/planning.py \
  backend/tests/unit/test_contract.py \
  .trellis/tasks/08-31-query-topic-list-page-size-http-parsing-blocker

git diff --exit-code -- \
  contracts/openapi.yaml \
  frontend/src/shared/api/generated
```

最后人工检查 `git diff` 与 `git status --short`，确认 Task 修改面只包含允许的 router、HTTP 测试与本 Task 文档，其他 dirty 路径原样保留。

## 4. Optional Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit -q
```

本 Task 是单一 router binding 修复，完整 backend unit suite 不是默认必需门禁；只有定向证据指向共享行为、准备发布候选或用户另行要求时运行。真实 PostgreSQL Query Topic integration 也不作为该 HTTP 解析事实的替代证明。

## 5. 失败归因与回滚点

- 显式合法值仍为 422：检查 validator 元数据顺序和实际请求是否进入目标 router，不修改枚举或前端请求。
- 成功响应但 collaborator 收到非 `int`：视为未满足验收，不以响应序列化结果掩盖。
- 非枚举值进入 collaborator：视为边界放宽，停止并修正 router 类型链。
- contract check 出现参数或 schema 漂移：回滚 router 单行变更并调查，不修改冻结 OpenAPI 追随错误 runtime。
- Ruff/mypy/测试出现无关或既有失败：保留原始证据并报告，不扩大 Task 修复范围，不重复运行未发生代码或环境变化的失败检查。

## 6. 提交与部署门禁

- 本地完成后先给出建议 commit，例如 `fix(planning): parse query topic page size at HTTP boundary`，只列入本 Task 识别过的文件；未识别 dirty 文件明确排除。
- 得到用户一次性确认后才提交到当前 `main`；不 amend、不 push。
- 生产部署必须在提交后另行获得明确授权。获准后才按 `design.md` 的 canonical `/geo/topics` 首次加载与一次显式重试执行只读复验，并保存两次请求状态和 request ID。
