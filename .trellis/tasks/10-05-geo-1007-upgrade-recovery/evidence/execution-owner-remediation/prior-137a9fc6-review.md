**复审结论：CHANGES_REQUESTED。** 受审版本为 `137a9fc6b9a47ca980eb9265ac57be6b96a47b1f`。确认两项原 finding 仍部分未解决，并发现一项恢复后数据库证明的漏检。三项均阻断 GEO-1007 接受；在修复或移除这些路径前，不应合并包含该增量的分支，也不应据此批准生产恢复。本轮只审 GEO-1007 最终增量及其必要调用边界，不构成整个 `geo/GEO-906` 分支的审查背书。

开始和结束检查均确认 HEAD 为指定 SHA、工作树干净。审查包含 `8162f580..137a9fc6` 的 remediation、此前 GEO-1007 初始增量和最终治理收尾；最后一个提交相对父提交只有任务与会话记录变化。下面行号均来自固定版本的实际源码。

**P1：有效锁 FD 仍可跳过正式恢复入口的进程监督。**

位置：[deploy/scripts/prepare-production-data.py:1615](/Users/sc/PycharmProjects/partsignal/deploy/scripts/prepare-production-data.py:1615)，关联同文件 `390–412`。

`recover-upgrade` 仅在 `PARTSIGNAL_MAINTENANCE_LOCK_FD` 为空时调用 `run_locked`。调用者自行打开正确维护锁文件，再提供其 FD，即可进入继承分支。该分支确实验证普通文件、device/inode，并实际执行排他 `flock`；但这只能证明文件身份与当前排他锁占用。对于原本未加锁的正确 FD，`flock` 会成功取得锁，并不能证明存在负责信号转发和子孙等待的 supervisor。

可达反例是在 shell 打开维护锁 FD，导出该变量，再用 `exec python3 … recover-upgrade …` 替换 shell。恢复阻塞在 Docker 探针时，仅向 Python 父 PID 发 SIGTERM：此入口没有 `run_locked` 的进程组信号转发、10 秒终止和等待逻辑。Python 默认退出后，其锁 FD 关闭；普通 `subprocess.run` 创建的 Docker 子进程没有继承该锁 FD，仍可能运行，另一维护操作即可取得锁。这违反“所有子孙结束前持续持锁”的合同。

本轮无持久写入的探针使用真实 `fstat` 和 `fcntl.flock`，确认自行打开、尚未持锁的匹配 FD 被接受，且恢复被派发、`run_locked` 未调用。探针替换了锁路径及恢复执行体，**没有实跑该伪造 FD 路径下的 Docker/SIGTERM 过程**；信号后果由上述固定源码路径确认。

最小修复方向是让每次公开 direct 入口都实际建立监督生命周期，继承 FD 只影响锁获取方式，不能决定是否跳过监督。新增一个可由调用者伪造的环境标志不足以解除阻断。需要覆盖自行打开的正确 FD、已有正确 FD，以及真实恢复探针期间向父 PID 发 SIGTERM/SIGINT，验证子孙结束前锁始终不可取得。

**P1：恢复后的 PREPARED 证明把“核心发布表缺失”接受为完整性通过。**

位置：[deploy/scripts/prepare-production-data.py:1414](/Users/sc/PycharmProjects/partsignal/deploy/scripts/prepare-production-data.py:1414)，关联 [backend/app/services/integrity.py:21](/Users/sc/PycharmProjects/partsignal/backend/app/services/integrity.py:21) 和 `backend/app/cli.py:275`。

恢复候选进入 PREPARED 前，状态所有者执行 `preflight-integrity`，随后只要求 `alembic_version` 等于候选 head。但是完整性函数在 `content_tasks`、`content_versions`、`publication_works`、`published_articles` 任意一张表不存在时直接返回 `[]`；CLI 因而成功退出。这种既有跳过行为被本任务的新恢复证明路径当作了上线后的数据库有效性证明。

反例是数据库仍保存 `0066_geo_manual_evaluation`，但缺失 `published_articles`，其余用户表、心跳表和基础服务仍正常。同 head 的 `alembic upgrade head` 不会重新创建已经缺失的历史表。完整性检查返回成功，head 查询也成功，状态可以推进 PREPARED。

已追踪完整部署和激活的后续边界，没有发现能够必然拒绝此反例的检查：

- 账号初始化 `backend/app/cli.py:163` 只访问 `User`。
- API readiness `backend/app/main.py:328` 只执行 `SELECT 1` 与 Redis ping。
- worker/scheduler 健康检查 `backend/app/geo_ops_health.py:154` 访问数据库连通性、`GeoOperationHealth`、心跳及 Celery。
- `activate-production.sh:100–111` 使用上述健康结果并最终标记 INITIALIZED；PREPARED 身份校验也没有重新检查这些表。

本轮内存探针复用实际完整性函数和 `transition_upgrade`，模拟一张所需表不存在及 head 正确，观察到完整性返回 `[]`，attempt 和 phase 推进 PREPARED。SQL 驱动、Docker 与状态存储使用内存适配器；**没有执行真实 PostgreSQL 删除表或完整激活反例**。问题是恢复门禁未拒绝既有 schema 漂移，并非恢复命令创建了该漂移。

最小修复方向是增加明确的迁移完成后严格检查合同：这些核心表缺失必须显式失败，不能沿用迁移前允许跳过的语义。需要一个定向 PostgreSQL 16 反例，保留正确 head、缺失其中一张核心发布表，确认恢复候选不能进入 PREPARED，且失败时状态不被推进。

**P2：公开 recorder 仍可把正常 RUNNING attempt 补造成“实际部署失败”。**

位置：[deploy/scripts/prepare-production-data.py:1197](/Users/sc/PycharmProjects/partsignal/deploy/scripts/prepare-production-data.py:1197)，关联同文件 `1164–1192`、`1653–1654`。

公开 `record-upgrade-failure` 接受调用者提交的 stage、非零退出码、signal 和低敏引用。它验证字段格式、当前 candidate、phase 和 attempt 状态，然后把当前 RUNNING attempt 改为 FAILED，并写入 `DEPLOYMENT_COMMAND_FAILED` 或 `DEPLOYMENT_SIGNALLED`。它没有验证调用来自该 attempt 的部署执行者，也没有观察对应部署子进程的真实退出结果；`evidence_ref` 只经过格式校验。

具体命令顺序是：对有效当前候选执行公开 `begin-upgrade`，随后直接执行同 manifest 的 `record-upgrade-failure --stage migration --exit-code 23 --evidence-ref fabricated/migration-exit23`。即使没有执行迁移或发生退出，正常 attempt 也会获得不可变失败记录。在归档、镜像、审批引用等其他合法条件满足时，recover 会消费该记录，开放候选替换。

本轮内存探针通过实际 CLI 派发、record 和 persist 源码，确认 RUNNING → FAILED，生成绑定当前 attempt 的 `DEPLOYMENT_COMMAND_FAILED`，而未观察任何部署或子进程退出。文件系统写入被内存状态替代。现有身份校验能够拒绝错误 candidate、过期 attempt 和冲突记录，但无法证明失败事实的授权来源。

最小修复方向是把实际部署生命周期及其退出结果归属到权威执行 owner，由该 owner 为对应 attempt 记录观察到的失败。公开命令不能仅凭调用者提交的合法字段制造实际失败；只增加退出码格式、attempt ID 或可伪造环境值不足以修复。应保留 PREPARED 的独立批准声明合同，并增加“正常 RUNNING attempt 经公开 recorder 不能补造失败”的负例，同时保持真实部署退出记录可消费。

原三项 finding 的复审状态如下：

| 原 finding | 状态 | 固定源码判断 |
|---|---|---|
| P1 迁移 runtime 证明不完整、缓存可绕过 | **RESOLVED** | `MIGRATION_RUNTIME_V1` 由独立迁移镜像的完整导出 rootfs、镜像配置和 Alembic source 摘要共同定义。失败与修复候选须保持同一 migration image ID 与 fingerprint；第一次迁移前冻结证明，缺历史证明时拒绝补造。可变应用镜像与依赖可以修复，但实际迁移仍使用被冻结的完整旧运行时。 |
| P1 direct recover 信号治理与锁提前释放 | **PARTIALLY_RESOLVED** | 无继承 FD 的公开入口已 self-wrap；正常 `run_locked` 路径转发本次进程组、限时 KILL 并等待子孙。上述 FD 分支仍能跳过监督。 |
| P2 未持久化真实失败、宽泛 supersession | **PARTIALLY_RESOLVED** | 已有持久化 attempt、失败记录、消费约束和不可变回执；PREPARED 声明也有独立种类及批准引用。公开 recorder 仍缺少真实失败来源证明。 |

迁移 runtime 修复的源码及测试覆盖比旧版实质完整：共享 fingerprint owner 覆盖动态导入、应用数据、依赖、Python、base 文件、树外缓存及会改变 loader 选择的元数据；拒绝 `/app` 内 `.pyc/.pyo`、非空 `PYTHONPYCACHEPREFIX`、镜像 volume/entrypoint 等不符合合同的配置。runtime 环境由静态白名单控制。归档、checkout 和镜像中的 Alembic 摘要使用同一规则，实际镜像采用停止容器导出验证，不启动镜像内 Python 自证。

其余已检查安全合同总体保持：recover 不启动业务、不写数据库、不直接置 INITIALIZED；候选切换与 receipt 同一次原子状态写入，中断保持旧状态或完整新状态；错误 manifest/archive/image/runtime/head 被拒绝；完整 previous candidate 和既往失败镜像组合被拒绝；重复 recovery 要求相同内容、当前候选和未开始新 attempt；新 attempt 会使旧 replay 失效。旧 manifest、archive、镜像 tag 和 receipt 没有被 recovery 覆盖。修复候选再次部署失败仍停留维护状态，正常成功路径仍经过完整 deploy、readiness、外部门禁与 activate。数据库漂移的 fail-closed 保证则受上述缺表 finding 限制。

本轮读取了任务合同、适用规范、before 来源、初始及 remediation 增量、最终源码摘要，并逐项阅读所列 recovery、failure、runtime、cache、registry、signal、Compose、image-cache 测试的实际逻辑，以及部署 shell 测试的相关路径。`before/deploy.sh` 有明确的首次读取还原来源，并非干净 Git 基线；结论以固定 SHA 源码与实际增量为权威。最终源码摘要与实际文件一致，后续差异只有已解释的任务治理记录。本轮另对受影响源码、合同与治理文件的已提交增量执行了 `git diff --check`，通过。

[独立验证记录](/Users/sc/.codex/reviews/partsignal/geo1007-137a9fc6-20261006T173228Z/validation.json) 确认主代理在指定 SHA 上运行以下命令，退出码均为 0；本轮没有重复这些昂贵检查：

| 命令 | 证据边界 |
|---|---|
| `make test-upgrade-recovery` | 49 个定向测试，以及两个 SIGTERM 场景。 |
| `make test-upgrade-recovery-compose` | 真实隔离 PostgreSQL/Compose、迁移后退出 23、持久化失败、recover/replay、完整 redeploy/activate，以及真实镜像 rootfs/cache 检查。 |
| `make test-deploy-scripts` | 部署、候选绑定和既有维护流程回归。 |
| `git diff --check` | 当时工作树检查通过；已提交增量的源码检查由本轮另外执行。 |

这些通过证据有明确覆盖缺口：

- direct recover 信号测试主动删除继承 FD 环境变量，因此不能发现第一项问题。它在恢复探针执行期间使用阻塞的测试 Docker CLI 验证 SIGTERM；本轮未验证伪造 FD 分支、真实 Docker Engine 在执行期间的信号交错或 SIGINT。
- Compose 使用当前 checkout 构建测试候选，并显式跳过正式 Git source gate。真实迁移、失败记录和状态转换成立；退出 24 场景是应用导入失败检查，不能等同完整 uvicorn 启动/readiness 故障演练。
- 69 张既有表摘要比较覆盖其实际测试行，许多表为空或稀疏，并排除 `alembic_version` 与运维心跳表。它不能证明丰富的 Publishing/GEO 历史数据都经过恢复验证。
- Compose 的 `EXTERNAL_GATE=MET` 为测试声明，不能当作生产外部服务门禁通过。隔离资源的精确清理有证据；生产备份恢复、真实外部服务与上线审批不在本轮验证范围。
- [远程 CI 观察](/Users/sc/.codex/reviews/partsignal/geo1007-137a9fc6-20261006T173228Z/remote-ci-observation.json) 显示该 SHA 没有 workflow run、commit status 或 check run；combined status 为 `pending`，**不能报告 CI 通过**。

本轮未修改仓库、任务状态或旧证据。最终判定保持 **CHANGES_REQUESTED**；解除阻断需要修复以上三个具体合同并取得对应定向证据。
