# GEO-407 设计

geo_collection_admission是预算/限速唯一owner；geo_runs拥有Run生命周期，geo_dispatch恢复调用相同结算函数；数据库账本唯一run_id且与Run外发状态协同。
预留cost只来自collector.estimate无I/O，不把模型能力当报价。无预算允许未知；受限预算必须全范围已知且单一币种。批次预算沿冻结数额、首个明确估价币种；日预算单租户全局UTC日和配置币种。预留/已报告按全部attempt计算，未知发送阻断受限预算，失败未发送释放。
所有账本写入取得固定PG advisory xact锁先于Batch/Run；claim配置锁继续在前，无网络事务。Profile并发按RUNNING reservation，60秒发送额度包含未发送reservation；429冷却持久化且同attempt不重试。SENT再次核验日预算并切换UTC day，额度拒绝保持NOT_STARTED并成为明确失败，无新增状态边。
0053仅expand，已有API发送事实归集为SETTLED/UNKNOWN；新ledger支持受控RESERVED→SENT→SETTLED/UNKNOWN或未发送RELEASED→RESERVED。终止账本不可修改/删除，历史Run不改。后续人工成本纠正不在此任务。


独立复核后固定：API RUNNING/已发送缺账本在 Run 侧延迟约束失败；COLLECTED 的采集费用/元数据由 PG 冻结；budget_day 必须与 sent_at/reserved_at 的 UTC 日期相同。历史发送无精确时刻时只在新账本采用最晚可能上界，原历史 Run 不改。不同配置图的全局日预算竞争必须单独通过真实 PostgreSQL 反例验证，不能借共享配置锁的串行化冒充该覆盖。
