# 完整 Response Contract 默认门禁激活实施计划

## Current State

用户已批准规划并授权实施，已运行：

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/09-03-complete-response-contract-gate-activation
```

实现、独立检查、只读 Review 与唯一一次正式 full-scope gate 均已通过。当前等待精确提交计划确认；尚未提交、归档或 push，`v2-live-readonly-acceptance` 指针保持不动。

## Change Boundary

最小行为差距：完整 response comparator 已零漂移，但默认 `check()` 仍绕过它。

权威 owner：

- `backend/app/tools/contract_check.py`：默认 gate、纯 comparator、CLI。
- `backend/tests/unit/test_contract_check.py`：纯 comparator mutation 与默认 gate/CLI 接线回归。

产品代码范围精确为以上两个文件。按 changed CLI signature 的 Trellis code-spec 要求，仅同步 `.trellis/spec/backend/error-handling.md`；其余合同、metadata、业务代码、集成入口和测试只读。

## Ordered Implementation

### 1. 激活唯一 response owner

- [x] 在 `check()` 中读取 static 文档并复制 runtime OpenAPI。
- [x] 删除旧 operation set 聚合诊断，改由完整 comparator 的 operation failures 统一拥有。
- [x] 保留 security scheme、operationId、parameter、security、requestBody 检查。
- [x] 删除 `successful_response()` 和 `check()` 中首个 2xx response block。
- [x] 调用一次 `compare_response_contracts()`，序列化结构化 failures，与既有 failures 合并并稳定排序。
- [x] 不增加 filter、allowlist、baseline、overlay 或 fallback；只按独立检查结果收紧共享输入结构验证并保留合法 `paths.x-*` 扩展。

### 2. 收敛 CLI

- [x] 删除 `--response-report` argparse 参数和 report-only 分支。
- [x] 默认 `main()` 捕获文件、编码、YAML 和顶层 comparator 解释错误，打印 `contract-check error` 并退出 2。
- [x] 漂移（含结构化 unsupported）输出 stderr 并退出 1，零差异输出更新后的中文成功文案并退出 0。
- [x] 更新 touched docstring/开发者可见文案，删除旧 Phase A 过渡描述。

### 3. 默认 gate mutation tests

- [x] 复用现有 document helper，增加临时合同 + monkeypatched runtime 的默认 `check()` helper；未复制 comparator 私有逻辑。
- [x] 参数化覆盖 missing non-2xx、extra status、第二/后续 2xx、error schema、media、`X-Request-ID`、`Content-Disposition`、unsupported links。
- [x] 每例断言 kind、direction 与 RFC 6901 pointer，不只断言 failure 数量或非空。
- [x] 把现有 report CLI 测试改为无 flag 默认 CLI：zero drift rc 0、drift/unsupported rc 1、I/O/YAML/顶层或 section 错误 rc 2。
- [x] 删除“默认 gate 不得调用 comparator”的反向断言，替换为 comparator 恰好调用一次和真实 response mutation 的黑盒失败证明。
- [x] 保留纯 comparator、FastAPI 422 与真实全量 zero-drift 测试边界。
- [x] 未修改 `test_runtime_response_metadata.py` 的 success-only GEO helper；它只测试 success schema identity，不是默认门禁 owner。

## Required Validation

开发中先运行最小 targeted probe；候选 diff 通过后，正式 full-scope gate 只运行一次：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract_check.py \
  backend/tests/unit/test_contract.py

make contract-check

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/tools/contract_check.py \
  backend/tests/unit/test_contract_check.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml \
  backend/app/tools/contract_check.py

npm --prefix frontend run api:check

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_request_context.py \
  backend/tests/unit/test_identity_response_headers.py \
  backend/tests/unit/test_runtime_response_metadata.py

python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/09-03-complete-response-contract-gate-activation

! rg -n -- '--response-report|successful_response' \
  backend/app/tools/contract_check.py \
  backend/tests/unit/test_contract_check.py
```

实际结果：121 个契约单元测试、352 个 request-context/runtime-metadata 相关测试全部通过；`make contract-check`、Ruff、mypy、frontend `api:check`、任务 JSONL 校验和旧符号静态扫描全部通过。该正式 full-scope gate 按计划只运行了一次。

`test_contract.py::test_runtime_openapi_matches_frozen_operations`、默认 `make contract-check` 和保留的纯 comparator tests 共同证明无 filter 的完整 response parity 仍为零；不重新增加 report-only 诊断实现。

## Optional Full-suite Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
npm --prefix frontend run test
make typecheck
```

不默认运行 PostgreSQL integration、完整 build、Playwright 或 `make verify`：本任务只改变本地 checker 门禁和 synthetic unit tests，不改变数据库、HTTP 行为、权限、状态转换、前端源码或部署。若实际 diff 越过该边界，停止并重新规划，不自动升级验证或扩大文件范围。

## Independent Review and Stop Conditions

候选实现的定向测试通过后：

1. 派发独立 `trellis-check`，按任务工件/spec 审查并最多执行一次明确、机械、范围内修复和一次 targeted re-check。
2. 因本任务激活 release gate，再进行一次只读独立 Review，重点检查：
   - `check()` 确实调用唯一完整 comparator；
   - 旧首个 2xx 与 report-only 路径完全删除；
   - 所有 response failure 类型进入默认门禁；
   - CLI 和 `make contract-check` 失败传播正确；
   - 无 hidden fallback、allowlist、filter、错误吞并或第二套 comparator；
   - OpenAPI/generated/runtime metadata/Makefile/CI 零修改；
   - 测试不是自证式实现复制；
   - 任务外 staged artifacts 和脏文件未进入 diff/index。
3. Review 只有一次完整审查和最多一次受影响路径复核。如果 targeted re-check 仍失败、同一根因复现或出现新的 MEDIUM 及以上问题类别，立即停止并报告，不继续修复循环。
4. 只有 targeted checks 和 Review 收敛后，才运行上述 final full-scope gate 一次。若正式 gate 失败，最多做一次有因果依据的范围内修复和一次 targeted re-check，不在同一轮重跑 full gate。

## Exact Commit Scope and Dirty-state Isolation

允许的工作提交范围：

- `backend/app/tools/contract_check.py`
- `backend/tests/unit/test_contract_check.py`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/tasks/09-03-complete-response-contract-gate-activation/**`
- `.trellis/tasks/08-31-non-2xx-contract-check/task.json` 中新增 child 的单行记录

明确排除：543 个已 staged artifact 删除、`.gitignore`、`backend/app/schemas/configuration.py` 及所有其他现有 dirty path。

隔离步骤：

- 实施前后分别保存 `git status --short`、目标文件 diff 和目标文件 index diff。
- 不运行 `git add -A`、`git add .`、reset、checkout 或 stash。
- 提交前由主会话列出精确 commit plan 并等待用户确认。
- 获得确认后只 `git add` 上述精确文件；由于 index 已有 543 个任务外 staged 删除，commit 必须使用 `git commit --only -- <精确文件列表>`，不得用普通无 pathspec commit。
- 提交后确认任务外 index 与规划基线保持，禁止 push。

建议单一 work commit：`backend: activate complete response contract gate`。实际提交仍需实施完成后单独确认。

## Rollback Boundary

- 提交前：仅对两个产品文件应用精确 inverse patch；保留规划/research 证据，不操作任务外 index。
- 提交后：如获授权，仅 `git revert` Phase F work commit；不执行 broad reset/checkouts。
- 任何零漂移失败都先报告具体 comparator failure 和权威 owner。不得以恢复 report-only 双路径、增加 filter/baseline/allowlist 或修改合同/metadata 作为本任务内回滚手段。

## Parent-task Final Integration Follow-up

Phase F 子任务验证、提交和归档后，返回父任务 `08-31-non-2xx-contract-check` 的独立收尾回合：

1. 确认父任务 child map 包含并完成 Phase A、B、composition、Wave 1/2/3、GEO、publication time、Phase X 与 Phase F。
2. 重新核对 code、`contracts/openapi.yaml`、generated client、runtime metadata、tests、Makefile/CI 和稳定 specs 一致。
3. 运行父任务 `implement.md` 的最终集成 validation；默认 `make contract-check` 必须已经覆盖完整 comparator，不能再使用已删除 flag。
4. 检查父任务实际 diff/历史提交和任务外 dirty/index 隔离，记录任何未运行的 optional suite 与残余风险。
5. 单独请求父任务收尾/归档授权；Phase F 子任务不得直接归档父任务或 `frontend-v2-functional-contract-conformance-baseline`。
