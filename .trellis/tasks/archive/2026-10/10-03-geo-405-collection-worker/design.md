# GEO-405 设计与责任边界

- `geo_dispatch`：commit 后首次投递、PENDING 节流补投递、expired保守终止；消息只有run UUID，持Batch→Run锁预留dispatch metadata并commit，再无锁发布；接收后丢确认可再次入队，由claim防第二次调用。
- `geo_collection_execution`：配置锁、当前资格与依赖版本、内存凭据和已实现adapter组装。复用唯一eligibility和现有加密/SSRF/TLS Collector，不构建插件框架。
- `geo_runs`：claim/token、发送回调、结果/失败短事务；网络在事务外。陈旧lease不可提交，终态不覆盖。
- `geo_run_lifecycle`：人工/自动执行共享数据库状态事实与完整Batch投影缓存；既有纯状态策略仍唯一拥有公式，消除每Run查询答案/后继的N+1。
- 过期NOT_STARTED也FAILED/WORKER_LOST，ADR-005允许保守部署；安全重入/迟到证据/新attempt留406。
- 预算限额不忽略，明确配置失败；预算/usage/cost/rate limit留407；COLLECTED不触发分析506。
- 无schema变化，无迁移；现有0052 head前滚验证，无生产数据迁移。开关/registry批准/INTERNAL分类均保持。

首次/补投递先在短事务预留 dispatch metadata 并 commit，再在事务外发布；预留回滚不发布。
Broker 已接收后丢确认可造成重复入队，但不会重复调用。首次发布遇首个 Broker 错误即停止，
其余预留 PENDING 后续按阈值扫描恢复，避免大矩阵在创建回执中逐项等待离线 Broker。
Profile 资格锁使用 FOR NO KEY UPDATE，继续排斥修改/删除而允许答案提交的 FK KEY SHARE；
同事务两次 Run UPDATE 会触发 FK 重验，FOR UPDATE 会与重复 claim 的 Profile→Batch 形成锁环。
扫描默认使用 PG clock_timestamp；显式 now 仅用于定向测试。Redis socket/connect timeout 为5秒。
