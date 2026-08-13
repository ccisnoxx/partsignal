# Frontend V2 GEO real-stack 验证记录

日期：2026-08-13（Asia/Shanghai）

## 最终结论

Required gate 已通过。Flow A、Flow B 均在同一隔离真实栈完成，V2 real-stack 为
`12 passed (54.2s)`，指定 V1 Trusted Types 为 `7 passed (11.0s)`，命令退出码为 0。
运行中暴露的 GEO List `page_size=20` query parsing 缺口已按用户批准在 router owner 最小修复，
实际 HTTP 回归测试已由修复前 422 转为修复后 200。

## Static 与 backend targeted checks

以下检查均通过：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py::test_geo_observation_list_accepts_page_size_from_query_string -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_contract.py -q
backend/.venv/bin/ruff check backend/app/routers/observation.py backend/tests/unit/test_contract.py
backend/.venv/bin/mypy backend/app
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
sh -n deploy/scripts/e2e-local.sh
git diff --check
```

- 新增回归在生产修复前实际返回 422，加入 `BeforeValidator(int)` 后通过。
- `backend/tests/unit/test_contract.py` 全文件通过，共 39 条；该文件同时执行运行时 OpenAPI
  一致性检查，确认本次无需改动 OpenAPI。
- mypy 成功检查 77 个 source files。

## Required real-stack gate

最终命令：

```bash
DATABASE_URL='postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal' \
REDIS_URL='redis://127.0.0.1:56379/7' \
  deploy/scripts/e2e-local.sh tests/e2e/trusted-types.spec.ts
```

目标结果：

```text
✓ geo-real-stack.spec.ts › Flow A：新建 Observation 后追加 Correction，原记录保持不可变 (3.4s)
✓ geo-real-stack.spec.ts › Flow B：真实 Insights 复算异常并创建带不可变 GEO 来源的优化任务 (827ms)
12 passed (54.2s)
7 passed (11.0s)
```

Flow A 证明真实 New/Correction UI、两次三阶段 evidence 上传、root 与 tail direct evidence 分离、
祖先附件投影、`supersedes_id`、原记录不可变和 List tail-only。Flow B 证明真实
`CONTENT_DECLINE`、options 按需加载、单次幂等 optimization POST、response ID handoff 与 Content
Task Detail 不可变 GEO source。

## 失败归因与修复迭代

1. 第一次 V2 为 10 passed / 2 failed：测试定位器与真实 UI 文案不一致，只修测试定位器。
2. 第二次为 11 passed / 1 failed：Flow A 错把祖先累计 `attachment_file_ids` 当成节点 direct
   evidence；按 database contract 和 integration 证据修正断言。
3. 第三次为 11 passed / 1 failed：真实请求
   `GET /api/v1/geo-observations/list-items?page_size=20` 返回 422。OpenAPI 声明 integer enum，
   router 的 `Literal[10, 20, 50]` 未解析 HTTP 字符串；按审批补最小 parsing 修复和回归测试。
4. 第四次为 11 passed / 1 failed：后端已返回 200，List UI 权威展示 Query Topic canonical
   question，测试仍查找 root search query；只修正 locator。
5. 第五次在上述针对性变化后通过；没有弱化业务断言、增加 mock、sleep 或固定成功路径。

## Cleanup 与事后检查

```text
E2E_CLEANUP database=partsignal_e2e_20260813_20676 status=deleted
E2E_CLEANUP storage=/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T//partsignal-e2e-storage.aI3v8u status=deleted
```

- Source PostgreSQL 查询结果为空，不存在 `partsignal_e2e_%` 数据库。
- storage 路径已不存在。
- 5173、4173、4174、8000、9001、19009 均无 listener。
- Redis DB 7 只有本次 Celery 的 `_kombu.binding.celery`，且没有其他 DB 7 client；精确删除该键后
  key set 为空。未使用 `FLUSHDB`，未终止未知进程。

## 验证范围判断

未运行 optional fixture suite、backend GEO integration 集合或完整 `make verify`：本次真实栈已经直接
覆盖新增 E2E 与 query parsing 边界，backend contract 文件、ruff、mypy、frontend lint/typecheck 和
脚本语法均通过；OpenAPI、service、database、generated types 与 frontend production code 未改动。
