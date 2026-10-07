# GEO-405 独立只读复核

来源：`/root/geo405_concurrency_review` 的运行时完成记录；`critical_reviewer`；复核代理未运行测试、未修改源码。

最终候选未发现仍未解除的发布阻断代码问题。本轮确认的三个并发／故障问题已修复，并完成只读复核；最新新增测试及最终 `make` 门禁仍需主代理取得完成证据。

- **已解除 P1：失败提交触发中间 autoflush。** 原实现先修改外部发送状态，再查询 RunState，导致 revision 尚未递增的 UPDATE 被数据库拒绝。429、非法 JSON、断连等真实失败会滞留 RUNNING，最终误记为 WORKER_LOST。`backend/app/services/geo_run_lifecycle.py:109` 现以 `no_autoflush` 读取裁决事实，再统一装配状态、错误、lease 与 revision；定向测试已覆盖对应失败分类。当前不构成发布阻断。
- **已解除 P1：结果提交与重复 claim 形成隐式 FK 锁环。** 结果事务两次 UPDATE Run，第二次会因旧行 `xmin` 属于当前事务而重验 FK；Profile 的 KEY SHARE 与重复 claim 持有的 Profile FOR UPDATE、等待的 Batch 锁形成环。该机制已通过 [PostgreSQL 16 源码](https://github.com/postgres/postgres/blob/REL_16_STABLE/src/backend/utils/adt/ri_triggers.c) 核实。`backend/app/services/geo_collection_execution.py:56` 现使用 FOR NO KEY UPDATE，仍排斥配置修改、删除和其他同级锁，同时允许 FK KEY SHARE，符合 [PG 行锁矩阵](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS)。确定性测试记录了修复前失败、修复后通过，当前不构成发布阻断。
- **已解除 P1：Broker 阻塞传播至同批已发送结果。** 原补投递在持有 Batch→Run 锁时发布消息，Broker 挂起可阻塞其他 Run 的结果提交直至租约失效。`backend/app/services/geo_dispatch.py:163` 现先提交 metadata 预留，再在事务外发布；预留回滚不发布，Redis 已接收后丢确认允许重复入队，由 claim 保证 provider 至多一次。阻塞 sender 期间同批结果可提交的 PG 反例已通过。首次发布也在首个 Broker 错误后停止，避免大矩阵逐项等待离线 Broker。

其余已检查的关键不变量保持：claim 与发送前重新裁决资格；SENT 在首个请求字节前持久化；token、expiry、RUNNING/SENT 联合拒绝旧结果；答案与 COLLECTED 原子提交；过期 RUNNING 保守 FAILED/WORKER_LOST；MANUAL 不投递、不 claim。生产 registry `approved=false`、工厂 INTERNAL、Collector PUBLIC-only 均未放宽。非空引用和文件证据明确失败，GEO-406／407／506 未提前接线。

复核代理没有自行运行测试，只读核对了候选代码、任务基线副本、合同、PG 源码及原始验证日志。`worker-sixth.log` 确认真实 PG／Redis／Celery 定向 **18 项通过**。随后新增的首次 Broker 失败恢复测试使当前套件达到 19 项，其最终结果及最终 `make` 门禁在独立复核完成时尚未核实，不能沿用此前通过记录宣称最终门禁完成。

剩余覆盖缺口是实际 Redis 网络黑洞、进程强杀与完整重启恢复；现有证据使用真实 Redis/Celery 加受控阻塞、丢确认和过期反例。GEO-406 的安全重入、UNKNOWN 恢复、迟到证据及显式新 attempt 属于明确保留的后续范围。

## 主代理后续验证

独立复核完成后，主代理取得最终工具 exit0：lint、typecheck、backend2999/frontend1125单元、841集成（含全部19项GEO Worker测试）、最终diff检查均通过。原始日志与精确命令见 `../implement.md`。这是主代理验证证据，不冒充复核代理运行的测试。
