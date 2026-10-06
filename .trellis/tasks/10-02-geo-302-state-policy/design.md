# GEO-302 设计

本任务实现纯策略，不创建 Batch/Run，不接线 HTTP/Worker。公共闭合投影先写 OpenAPI；基础 GEO-301 Out 保留。运行状态 token 不增加、不改语义；stage/primary task 是视图语义，动作通过资格与命令能力裁决。

## 权威与边界

- `geo_run_policy` 拥有合法边、四终态集合和 retry/cancel 资格。RunState 是调用服务从数据库/本次原子提交事实转换的冻结内部模型，不传播 ORM 或 API DTO。
- `geo_batch_policy` 拥有完整集合、每 cell 最新 attempt、状态优先级与 Batch workflow；不能接受分页或调用方指定缓存状态。历史链合法性仍由0048仲裁，策略校验初始 cell 完整性及重复编号。
- workflow Schema 只描述 wire 结果，无事务、凭据或 lease token。actor_type 显式校验，ADMIN/ENGINEER 都有业务执行权限；actor_active、逐 cell collection eligibility 和真实命令 availability 必须明确提供，没有默认成功能力。

## 状态与失败边界

全部9×9×3状态边表驱动；人工直接提交到 COLLECTED，自动先领取 RUNNING。成功进度要求答案/正确外发事实。PENDING→FAILED覆盖技术设计规定的claim前配置/资格失败；不伪装已发请求。RUNNING→PENDING只接受自动、NOT_STARTED、无答案、过期且token撤销证据；SENT/UNKNOWN走失败而非恢复。终态/同态/越阶段转换409 INVALID_STATE_TRANSITION。

采集retry是FAILED/BUDGET_BLOCKED且COLLECTION、无答案/无后继；旧状态冻结、后继追加由后续工厂负责。已有后继错误优先HAS_SUCCESSOR，其余NOT_RETRYABLE。cancel只PENDING/NOT_STARTED/无答案，不停止已发请求或污染结果。分析失败没有采集retry。

Batch：未提交准备态PLANNED；已提交完整初始matrix全pendingQUEUED；任意非终态RUNNING；全成功COMPLETED；成功与其他终态混合PARTIAL；无成功时预算优先，再失败，最后全取消。重试后新attempt可重投影缓存，原Run不可回退。选中的latest仍有后继时拒绝不完整输入，has_successor来自数据库存在性事实，不能在分页子集内推导。Batch取消只表达剩余PENDING停止资格；无批次重试。人工任务优先，其次处理合格重试，终态查看结果。

## 并发、授权与接线

策略无锁/事务/网络副作用、无revision写入/幂等存储；这些属于后续Application Service。读动作不是写授权，后续命令按既有资源→Plan→Batch→Run锁序重验实际状态/actor/资格/expected_revision，恢复撤销lease，旧token迟到结果拒绝。0048终态、revision、外发进度和唯一后继最终防线不变。没有数据库变化、Alembic revision或历史数据迁移。

## 验证与交付范围

用完整边表、729种三cell状态组合、恢复证据反例、retry/cancel、角色/资格/命令能力、最新attempt与缺失集合，以及Pydantic真实dump/OpenAPI正反例保护可观察合同。用户指定完整门禁和contract-check照常执行；独立只读复核聚焦终态、状态边、最新attempt、动作/守卫一致与公共Schema。HTTP旅程、工厂幂等、Worker竞态、答案/分析执行及页面验收留各自后续任务，不能把纯策略测试当接线证据。
