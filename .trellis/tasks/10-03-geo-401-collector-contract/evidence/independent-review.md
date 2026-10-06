确认候选实现存在，且新增合同实际影响外部发送恢复及回答证据持久化边界，符合高风险独立审查角色。发现两项 P2 问题，建议在 GEO-401 合同接受前修正。

- **P2：来源元数据允许构造数据库无法接受的成功结果。**  
  位置：[contracts.py:223](/Users/sc/PycharmProjects/partsignal/backend/app/collectors/contracts.py:223)，涉及 `source_product`、`source_model`、`source_version`。三字段目前只有最大长度限制，`""`、`" "` 都能成功构造 `CollectedAnswer`。具体反例是供应商返回合法回答正文，但来源版本为空串；Collector 将其作为成功结果返回，而 `0050_geo_answer_evidence.py:49` 的 `ck_geo_answers_sources` 明确要求非空来源满足 `length(btrim(value)) > 0`，结果无法提交。发送已完成后才发生这种失败，会使有效正文和整组证据不能正常落库。  
  **阻断判断：阻断 GEO-401 合同接受。** 最小修正是在内部结果入口拒绝非空但空白的来源值，未知来源继续使用 `None`；保留长度限制，避免静默补值或猜测。补充直接构造成功结果的空串、纯空格负例即可保护这一合同。

- **P2：引用标题及来源文本允许 NUL，能够绕过结果校验并在数据库适配时失败。**  
  位置：[contracts.py:160](/Users/sc/PycharmProjects/partsignal/backend/app/collectors/contracts.py:160)，另涉及 `contracts.py:223–225`。`CollectedCitation(title="synthetic\x00title", …)` 和含 NUL 的三个来源字段均可成功构造。已安装 psycopg 的 `StrDumper.dump()` 对同类文本直接抛出 `DataError: PostgreSQL text fields cannot contain NUL (0x00) bytes`；本地只读探针已确认。具体反例是供应商 JSON 的标题包含 `\u0000`，解析为 Python 字符串后通过 Collector 值对象，最终导致整个证据事务失败。  
  **阻断判断：阻断 GEO-401 合同接受。** 最小修正是在这些原始文本字段进入内部结果时拒绝 NUL；标题仍应保留现有可空、可空串及长度合同，不应通过静默删除字符改变原始证据。增加标题和来源字段的 NUL 负例。

发送与恢复分类方面未确认可行动缺陷。实际穷举了 **360 个错误码 × 阶段 × 发送状态组合**：114 个被接受，只有 4 个组合返回 `SAFE_BEFORE_SEND`，全部是 `NOT_STARTED` 下的 CONNECT/SEND 暂态超时或不可用；`SENT`、`UNKNOWN`、`COMPLETED` 均不会返回该分类。`before_send` 为必填参数，协议明确由 Worker 原子持久化 SENT，并明确 Collector 的 NOT_STARTED 不能撤销数据库发送标记。该签名支持通过闭包携带 Worker 授权上下文，同时 Collector 无须接收 ORM Session 或提交事务。

输入转换复制冻结问题、配置和能力，不带主体分析字典、事实正文或凭据。摘要复用既有四字段闭合合同；错误摘要来自静态白名单。费用、usage、搜索和版本的未知值保留 `None`，引用原始 URL 与实际位置未被转换成分析事实。内部 Surface 名称比公开 Run 快照更严格，但当前 Surface 数据库守卫及冻结来源本身要求名称无首尾空白，未确认现有创建链路会因此受阻。

本次审查没有执行 pytest 或全量门禁。读取的原始日志分别显示基线 **132 passed**、新增及相邻定向 **197 passed**、Collector mypy **5 个文件通过**，以及全局 mypy **145 个文件通过**；上述两类文本反例不在现有新增测试覆盖内。真实 adapter、网络发送、凭据清理、截图裁剪、文件提交、lease 竞争和迟到结果裁决均未实现或未在本次审查中运行，因此本结论不构成真实发送隔离或任务验收证明。

实际读取范围如下，完整读取与相关段落读取区分列出：

- 完整候选：`backend/app/collectors/contracts.py`、`errors.py`、`base.py`；`backend/tests/unit/test_geo_collector_contract.py`。
- 完整相关源码：`backend/app/collectors/registry.py`、`__init__.py`；`backend/app/schemas/geo_runs.py`、`geo_answers.py`、`geo_surfaces.py`；`backend/app/geo_citation_urls.py`；`backend/pyproject.toml`。
- 权威合同及相关段落：`contracts/openapi.yaml` 的 Run 输入、错误、发送状态、结果元数据、Answer、Citation、摘要组件；`contracts/database.md` 的 Batch/Run、不可变与恢复、Answer/Citation、原子提交合同；`backend/alembic/versions/0048_geo_batches_runs.py`、`0050_geo_answer_evidence.py`、`0046_geo_surfaces_profiles.py`；`backend/app/services/geo_batch_snapshots.py`；`backend/app/schemas/geo_manual_collection.py`、`geo_monitoring_plans.py`、`geo_prompt_variants.py`；`backend/tests/unit/test_geo_run_contract.py` 的冻结输入 fixture。
- 规则和任务：根及 backend `AGENTS.md`；当前 task 的 `prd.md`、`task.json`、`check.jsonl`、`implement.jsonl`；backend spec 索引和相关错误、AI 边界、质量规范段落。
- 设计：完整 `ADR-005-staged-collector-rollout.md`、GEO-401 原始任务提示词；Worker/Collector 架构及安全合规文档的相关单元。
- 原始证据：当前 task 的 `baseline-unit.log`、`collector-unit.log`、`collector-typecheck-first.log`、`typecheck.log`、`initial-hashes.json`，以及保存的 Registry、Run/Answer schema、OpenAPI、database 基线副本。
- 本地依赖与审查准则：已安装 psycopg `types/string.py` 的文本适配单元；`trellis-check`、`structured-response` 及其代码审查参考、`clean-code-design` 的只读准则。

工具仅使用 `functions.exec → exec_command` 执行 `cat`、`nl`、`sed`、`rg`、`ls` 读取，以及 `backend/.venv/bin/python -B` 内存探针和字节/哈希比较。未创建、修改或删除文件，未执行 Git、迁移、网络请求或外部写入。字节比较确认 Registry、Run/Answer schema、OpenAPI 和 database 均与保存基线一致；审查时 `contracts.py` 的 SHA256 为 `24bf397218ad0e5edd6d477f2431363e66fd7351bbbdbe054cc1bff18d97ed3f`，以上发现对应该候选。
