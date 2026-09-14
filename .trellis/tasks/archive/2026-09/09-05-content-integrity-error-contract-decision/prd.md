# Content/Generation IntegrityError 合同决策

## 1. 背景

父任务 `.trellis/tasks/09-04-integrity-error-domain-mapping` 正在 planning。T1 已移除未知 `IntegrityError -> REVISION_CONFLICT` 的全局误映射；Humanization 独立任务已由提交 `ded73ab5` 完成两项精确映射：

- `uq_generation_jobs_idempotency_key`：同 canonical identity replay，异 identity 为 `IDEMPOTENCY_CONFLICT`；
- `uq_generation_jobs_active_humanization_source`：`HUMANIZATION_ALREADY_ACTIVE`。

父计划 T4-C 尚需对 Content Task、Generation Job、Content Version 与 Fact Version 的九项唯一性 enforcement 冻结业务语义、HTTP/worker边界、原子性、同步面、测试和后续实施拆分。未经本决策批准，不能把约束失败猜成可恢复409，也不能恢复全局mapper。

## 2. 目标

形成一个可独立review、可直接指导后续implementation Task的合同决策包：

1. 逐项审计并冻结九条约束的真实表/字段/最终名称、owner、锁/预检/分配、顺序与race路径；
2. 对每项明确选择replay、既有领域错误、新领域错误、unknown或worker显式失败；
3. 对公共错误冻结准确status/code/message/details/request ID和前端恢复；
4. 冻结事务rollback后各业务对象、审核、审计与dispatch的原子性；
5. 明确OpenAPI、runtime metadata、generated client、Frontend V2、stable specs与required tests的同步责任；
6. 按稳定command owner拆分后续implementation Task及依赖顺序，并给出推荐首项和精确验收。

## 3. 范围

### 3.1 纳入

- 普通 Content Task `createContentTask` 的幂等唯一性；
- Generation Job 的GENERATE create/retry幂等race，并保持Humanization现有合同；
- generation worker的ContentVersion source identity；
- ContentVersion `(task_id, version)` identity与pending/approved review状态唯一性；
- FactVersion `(product_id, version)` identity与pending状态唯一性；
- 相关HTTP、worker、事务、前端恢复、合同同步和测试决策；
- 九条约束全部列入最终matrix，其中publication-owned row只冻结T4-C不实施边界。

### 3.2 排除

- 任何生产代码、OpenAPI、generated client、stable spec、测试、数据库schema或生产数据修改；
- `task.py start`、任务归档、提交、push；
- publication/GEO的production mapping，包括`uq_content_tasks_source_published_content_issue_id`的race mapper和GEO incoming command的共享key mapper；这些进入后续T5-C；
- CHECK、NOT NULL、不可变trigger、未列名FK与未知diagnostics的领域映射；
- 全局IntegrityError registry/handler、通用mapper framework、repository或第二套错误类型系统；
- publication/GEO其他约束与父任务T5-C/T6实现。

## 4. 必须冻结的约束

1. `uq_content_tasks_idempotency_key`
2. `uq_content_tasks_source_published_content_issue_id`
3. `uq_generation_jobs_idempotency_key`
4. `uq_content_versions_source_job_id`
5. `uq_content_versions_task_id`
6. `uq_content_versions_one_pending_per_task`
7. `uq_content_versions_one_approved_per_task`
8. `uq_fact_versions_product_id`
9. `uq_fact_versions_one_pending_per_product`

最终决策详见 `research/contract-decision-matrix.md`。其中推荐批准的分类为：

- replay/既有错误：Content Task idempotency、Generation Job idempotency；
- 新公共错误：Content pending -> `CONTENT_REVIEW_PENDING`；
- 既有公共错误：Fact pending -> `FACT_REVIEW_PENDING`；
- 顺序replay但真实constraint failure显式失败：worker `source_job_id`；
- unknown：Content version allocator、approved唯一性、Fact version allocator；
- T4-C deferred/unknown：published issue source race，交T5-C。

## 5. 硬性合同

- 所有后续mapper仅可匹配`sqlstate == "23505"`与精确`diag.constraint_name`；禁止解析message/`str(error)`。
- unknown必须重新抛出原始`IntegrityError`；HTTP保持默认500且不新增稳定500响应合同。
- `REVISION_CONFLICT`只用于真实expected revision stale，不接管九项constraint failure。
- 已知HTTP冲突必须由root transaction先rollback再回查winner或抛`AppError`；失败不得留下成功业务副作用。
- generation worker不返回HTTP 409/request ID；失败通过Job terminal state表达。
- AI输出只产生草稿；任何映射不得改变内容/事实版本不可变、task current pointer或审核历史规则。
- 新码只批准`CONTENT_REVIEW_PENDING`：409、message`该任务已有待审核内容版本`、details`{}`、当前request ID、显式reload且不自动replay。

## 6. Acceptance Criteria

- [x] 已完整审计用户指定的父任务资料、contracts、Frontend V2文档、stable specs、authoritative services/routers/tests、frontend content目录与generated schema。
- [x] 已建立九项完整decision matrix，包含数据名称、owner、协调机制、顺序/race、分类、公共合同、worker、原子性、同步面、tests、后续Task和依赖。
- [x] 已明确哪些项map、replay、unknown、worker FAILED或T5-C deferred，并保持Humanization现有合同。
- [x] 已冻结唯一新增公共code候选`CONTENT_REVIEW_PENDING`的准确合同与前端恢复。
- [x] 已按Content Task、Generation Job/worker source、Content Version identity、Content Version review state、Fact Version owner拆分后续implementation Tasks。
- [x] 已给出首个实施任务`generation-job-idempotency-integrity-mapping`及可执行验收标准。
- [x] 已创建`design.md`、`implement.md`、必要research、`implement.jsonl`与`check.jsonl`，无模板占位。
- [x] 独立review及一次针对性复审已确认不存在仍阻碍批准的范围越界、合同歧义、错误owner、原子性遗漏或不可执行测试要求。
- [x] 用户已于2026-09-06批准本合同决策；任务继续保持planning，不在本任务执行任何implementation。

## 7. 完成定义

本规划达到“可申请批准”时，应满足：planning文档与research一致、九项matrix无未决公共语义、后续Task单一review目标明确、required/optional validation分离、父任务仍为planning、工作区既有脏变更未被触碰，并完成一次独立只读review。即使获批，本任务本身也不进入生产代码实施；后续implementation需分别创建Trellis Task并取得相应批准。
