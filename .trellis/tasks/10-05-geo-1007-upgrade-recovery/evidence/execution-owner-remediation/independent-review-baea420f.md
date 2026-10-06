# GEO-1007 新固定提交独立复审

审查者：fresh critical_reviewer（execution_owner_review），只读且未参与实现。
受审 commit：baea420fb8a479d66d578d3f4fd91d38086b8c29。
基线：137a9fc6b9a47ca980eb9265ac57be6b96a47b1f。
结论：**APPROVE**。没有确认新的可行动 finding；不构成全分支合并或生产批准。

## 上轮问题处置

| 问题 | 状态 | 源码依据 |
|---|---|---|
| 正确锁 FD 绕过 recover 监督 | RESOLVED | prepare-production-data.py:1605 无条件 supervisor；FD 只复用锁 |
| 公开 recorder 补造 RUNNING 失败 | RESOLVED | parser/dispatch移除recorder/begin/prepared marker；私有worker拥有attempt/stage，父waitpid观察退出后持久化 |
| 正确head但核心表缺失仍prepared | RESOLVED | production_deployment.py:114、prepare-production-data.py:1380 显式--require-schema；integrity.py:11缺表返回REQUIRED_TABLE_MISSING并退出1 |
| 迁移runtime闭包 | RESOLVED，约束保持 | 原migration image ID、全rootfs/配置指纹、迁移前proof、archive/checkout/Alembic/cache/env合同保留 |

监督关键实现：production_maintenance_execution.py:103。fork前安装SIGINT/TERM handler；worker独立session；私有进度pipe不交外部subprocess。中断先冻结本次子孙组，转发信号，10秒截止不因重复信号延长。worker退出后终止并确认子孙停止才返回/释放锁。zombie不可执行，EPERM继续查OS，未知持续持锁；recover checkpoint与原子替换保留旧或完整新状态。

失败事实关键实现：production_deployment.py:92，prepare-production-data.py:1151、1610。worker创建attempt后发布ID/stage；父级在子孙停止后核对当前attempt/candidate/原runtime proof，原子追加真实exit/signal/worker_exit_code/time/owner引用。缺attempt/stage或未完成写入不补造。重试使旧current failure无效；历史/receipt/replay保持。prepared后批准声明有独立kind和null exit/signal，失败prepared不能激活。两个执行模块纳入同一13项tracked allowlist。

审查读取固定diff、AGENTS、task/spec、实际源码和测试逻辑。审前/后HEAD干净，17个关键源码/测试内容与commit blob/摘要一致；主代理全tracked快照亦无变更。reviewer未运行写cache/容器的测试，未修改仓库或已有证据。

## 固定SHA验证

reviewer读取实际日志并核对记录的SHA256：fixed-sha-targeted exit0（51用例+7信号场景）、fixed-sha-compose exit0（真实PG16正确0066head缺published_articles拒绝prepared；还原后完整deploy→activate、runtime镜像负例、owned清理）、fixed-sha-production exit0（候选/编排/激活/本地Engine网络）、增量diff --check通过。预提交HEAD137a dirty=true不作为137a源码通过证据。主代理另实跑fixed-sha-backend，20通过；不归为reviewer执行。

## 覆盖限制

recover信号使用真实入口和阻塞fake Docker CLI；不证明Engine服务端操作因client中断撤销。嵌套场景实跑SIGTERM，FD场景双信号；SIGKILL/断电/全部OS状态未知交错未实跑。PG真实缺表只published_articles，另三表为函数/CLI单元覆盖。69表合成稀疏，未验证丰富Publishing/GEO不可变历史；API exit24是import故障，不等同完整uvicorn readiness演练。AI/OSS MET是fixture。真实服务器/公网maintenance/备份/registry/AI/OSS、远端CI、clean main/RC、全分支门禁与生产批准仍未验证。

以上缺口没有重新触发本次GEO-1007 remediation确认阻断，其他范围仍需独立验收和授权。
