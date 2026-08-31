# GEO 优化来源串行化实施计划

## 0. 开始门禁

- [x] 用户已审阅 `prd.md`、`design.md`、本文件并明确批准实施。
- [x] 批准后才运行：

  ```bash
  python3 .trellis/scripts/task.py start \
    .trellis/tasks/08-31-geo-optimization-source-serialization
  ```

- [x] 开始前重新执行 `trellis-start` 上下文检查，确认 primary working directory 仍为 `main`，识别并保持所有既有脏文件。
- [x] 确认 `v2-live-readonly-acceptance` 仍为 `in_progress`，父 Task 未归档；不修改或归档二者。
- [x] 完整读取本 Task 的 PRD、design、implement、research 与 `implement.jsonl` 指向的 specs。

## 1. 建立唯一目标资源锁 owner

目标文件：`backend/app/services/content_planning.py`，必要时仅对 `backend/app/services/platform_configuration.py` 的既有锁查询做新鲜度修正。

- [x] 从 `create_content_task` 提取窄的目标资源锁定/资格校验函数，顺序固定为 `PlatformProfile → Product → FactVersion`。
- [x] 锁查询使用锁后强制刷新语义，消除 identity map 旧对象风险。
- [x] 保留活动平台、活动产品、事实 APPROVED、正文非空和产品归属的现有错误码与校验。
- [x] 提取只负责构造并 flush ContentTask 的窄函数；不增加接口层、策略、callback、兼容参数或“already_locked”布尔旁路。
- [x] 普通 `create_content_task` 继续持有其 advisory lock、三字段 replay 和 commit 语义，只改为复用上述两个内部 owner。

退出判定：普通创建仍按同一锁序和现有成功/失败合同工作；目标锁与任务构造没有第二份实现。

## 2. 将 GEO 来源复算移入锁域

目标文件：`backend/app/services/geo_observation.py`。

- [x] 保留同 key advisory lock 和完整 source+target replay comparison 在最前。
- [x] replay miss 后先调用共享目标资源锁 owner，再构造 filters 并调用 `get_geo_insights`。
- [x] 删除复算后的非锁定 FactVersion `db.get`，使用共享 owner 的锁后校验结果；不添加 fallback。
- [x] 继续复用现有规则匹配、typed basis 和发布成果/冻结平台身份校验。
- [x] 使用共享任务构造 owner flush ContentTask，添加 `ContentTaskGeoSource`，最后一次 commit。
- [x] 确认任何抛错都发生在 commit 前，且没有新增 AuditLog 或其他 side effect。

退出判定：Product 锁在首次 GEO source 查询之前已持有，并持续到 task/source commit 或 rollback；正常 201 与 exact replay 行为不变。

## 3. 最小回归测试

### 3.1 单元测试

目标文件：`backend/tests/unit/test_geo_insights.py`。

- [x] 更新 fake Session/monkeypatch，使测试明确记录“shared target lock → `get_geo_insights` → task/source write”顺序。
- [x] 保留服务端复算并冻结 typed basis 的断言。
- [x] 保留 `GEO_INSIGHT_STALE` 无提交、same-key 全九字段 conflict 在复算前失败、exact replay 不复算的断言。
- [x] 不按私有 SQL 结构复制实现；只断言 owner 调用顺序和可观察结果。

### 3.2 PostgreSQL stale basis 并发测试

目标文件：`backend/tests/integration/test_geo_insights.py`。

- [x] 按 `design.md` 6.1 使用两个真实 Session、Event 和 `pg_blocking_pids` 控制观测更正事务与优化命令交错。
- [x] 更正事务在 Product 锁内写入能使异常消失的新链尾，优化命令必须在来源复算前等待。
- [x] 释放锁后断言 `GEO_INSIGHT_STALE`，命令 key 下 ContentTask/source 为 0，AuditLog 和其他命令业务行不变。
- [x] 测试必须在修复前稳定失败为“旧 basis 被创建”或等价错误结果，在修复后稳定通过；不得以 sleep、概率重试或提高隔离级别制造通过。

### 3.3 三类资源与原子回滚

- [x] 用真实 PostgreSQL 锁等待分别覆盖 PlatformProfile 停用、Product 停用、FactVersion 退役，证明等待方读取锁后提交状态并零副作用失败。
- [x] 保留现有 same-key 双线程唯一聚合测试。
- [x] 增加 source 写入失败的事务回滚断言，证明已 flush task 不会成为孤立行。
- [x] 共享普通创建边界的既有成功、同键和资格回归继续由 `backend/tests/integration/test_content_task_creation.py` 覆盖，无需修改该文件。

## 4. 合同、文档与 touched-scope 复核

- [x] 确认 `contracts/openapi.yaml`、`contracts/database.md`、frontend、generated client、models、alembic 和部署文件无 diff。
- [x] 对实质变更的 Python module/function、非显然锁责任和异常路径执行 touched-scope 中文文档检查；不为明显代码加机械注释。
- [x] 实现证据确认无需改 API 或数据库合同，未扩大范围。
- [x] 检查 diff 不包含跨 endpoint 幂等不对称、source DELETE 守卫、QueryTopic、repair task 或其他无关修复。

## 5. Required validation

以下命令在实施后全部必需，必须先跑直接覆盖改变行为的测试，再跑静态与合同检查：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_geo_insights.py

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_geo_insights.py \
  backend/tests/integration/test_content_task_creation.py

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/services/content_planning.py \
  backend/app/services/geo_observation.py \
  backend/app/services/platform_configuration.py \
  backend/tests/unit/test_geo_insights.py \
  backend/tests/integration/test_geo_insights.py \
  backend/tests/integration/test_content_task_creation.py

UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app

make contract-check

python3 .trellis/scripts/task.py validate \
  .trellis/tasks/08-31-geo-optimization-source-serialization

git diff --check
```

说明：PostgreSQL 并发用例是本 Task 的核心证明，不能用 SQLite、mock lock 或仅 unit test 替代。若 `platform_configuration.py` 或 `test_content_task_creation.py` 最终无 diff，ruff 的精确文件列表可删除未触及项，但不得跳过相关现有行为测试。
单元与集成目录各有一个 `test_geo_insights.py`，必须分两次调用 pytest，避免默认 import mode 的同名模块收集冲突。

## 6. Optional full-suite validation

以下为可选的仓库级置信度检查；仅在相关共享影响、发布准备或用户要求时执行，失败按归因规则处理，不自动扩展修复范围：

```bash
make lint
make typecheck
make test-unit
make test-integration
make build
```

`make verify` 还包含前端 E2E、部署脚本和完整构建，只作为发布候选门禁，不是本后端独立 Task 的默认 required validation。

## 7. 最终 diff 审计与交付

- [x] 复核不存在 Product-first 锁反序、重复校验、第二套锁协议、silent fallback、宽泛异常捕获、死代码或无关格式化。
- [x] 复核 replay miss、exact replay、conflict、stale、目标失效、source 写失败的事务和副作用边界。
- [x] 报告行为变化仅为并发线性化收紧；API、数据库、权限和正常成功行为保持不变。
- [x] 报告 required validation 的实际命令和结果；optional 未运行项说明原因和剩余风险。
- [x] 不自动提交、不推送。提交前单独给出 commit plan 并等待用户确认。

## 8. 完成判定

- [x] PRD AC1–AC10 全部有代码或测试证据。
- [x] 旧 basis 在决定性交错下不可落库，所有失败/冲突路径无 task/source/audit 副作用。
- [x] 一次 review 只需评估该锁域和来源一致性目标；所有排除项均无产品 diff。
- [x] 父 Task 和 `v2-live-readonly-acceptance` 状态保持不变。
