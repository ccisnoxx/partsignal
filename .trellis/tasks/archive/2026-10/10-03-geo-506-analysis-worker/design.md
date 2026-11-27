# GEO-506 设计

## 边界

纯规则 geo_analysis/geo_claims 不拥有生命周期，避免反向导入造成循环。geo_analysis_inputs 拥有冻结输入/PG hash，geo_analysis_execution 转换冻结输入并计算四阶段结果，geo_analysis_runs 拥有 revision claim/提交/失败，geo_analysis_dispatch 拥有数据库派发与恢复，geo_reanalysis 拥有管理员命令。

geo_analysis_jobs 仅是 revision 执行元数据，不维护第二套业务 status。revision.status 为权威。租约放在独立表，使终态 Run 的重新分析不破坏采集历史；首次 ANALYZING Run 镜像该 lease。无需外部模型请求状态或内容副本。

## 创建和幂等

创建事务 REPEATABLE READ，先锁 Batch/Run。初次使用冻结 Run Subject；重新分析从当前 Catalog 批量组装相同身份和角色的 alias/domain 字典。事实选择最高同产品 APPROVED 非空版本。输入数组排序，规则身份包含已有四段版本，configuration 模型字段全 null。PG geo_analysis_input_sha256 是唯一 hash 算法。

锁内同 hash PENDING/COMPLETED 复用；FAILED 不复用，显式重跑追加 revision。只允许初次 COLLECTED 或已结束首次分析的重分析；首次 ANALYZING 不能创建新的重分析。RR 的 40001/40P01 显式失败，不吞异常；扫描下次重新读，不重启外部调用。

## 执行和提交

claim 锁 Batch→Run→Analysis→Job，检查 PENDING 且无 lease，数据库时钟分配 token/expiry；初次 COLLECTED 推进 ANALYZING 并镜像租约。已批准事实强绑定从创建起冻结；执行按绑定加载历史事实，不重新选择最新版本。

计算在事务外，无 HTTP/SSRF/外部 AI。normalized citations 归 revision，不修改原 citation；歧义 reasons 保存于 revision。默认无第三方分类字典，未登记类别为 UNKNOWN。

提交重验 token 和 expiry，先在 PENDING 内插入结果并 flush，再清理 job lease 并终结 revision，再独立 UPDATE 首次 Run 状态/lease，最后 pointer-only UPDATE，最后刷新 Batch；同事务 commit。0054 延迟检查和0055 citation 装配检查拒绝半结果。重分析只发布最新成功指针；晚到较旧成功可保留历史但不倒退 current。

0055 的 revision/job/Run 三侧延迟约束读取最终数据库行，拒绝 revision-only 终结后仍 ANALYZING、Run-only 替换 lease 或退出 ANALYZING 后仍有活动 PENDING Job。约束不增加反向锁；读取最终行使同事务结果触发器、状态和 pointer 多次 UPDATE 正常兼容。0054 无 Job 历史不回填，存量纯历史更新不强制伪造 claim。

失败提交单独短事务：revision FAILED/ANALYSIS_FAILED，固定安全摘要，释放 lease；首次 Run FAILED/ANALYSIS，重分析不改采集终态/旧指针。结果插入异常事务回滚后再记录失败。过期任务由扫描同路径失败，旧 token 永不提交。

失败记录事务也发生 DBAPIError 时，Worker 明确抛出不包含异常链的安全 RuntimeError；日志只存分析ID和错误类型。此时不宣称FAILED落库，原lease留给数据库恢复后的过期扫描，原Answer仍不变。

## 投递

collection Celery 任务提交后发送 run UUID；该入口创建/复用 revision 并执行。扫描 COLLECTED 覆盖人工提交及提交后崩溃；扫描无 lease PENDING revision，先持久化 dispatch 时间/次数再发 revision UUID。Broker 故障记录类型和ID，下个周期补投递。扫描大小与间隔复用既有 GEO 配置；过期失败后不无限自动重试，管理员显式 reanalyze。

## 内部 reanalyze

服务自己建立一致事务，先锁最新 User（非键更新），验证 active/password/ADMIN，再 Batch/Run 校验 expected_revision、已有 Answer 和已结束首次分析。reason 是闭合内部原因码，审计只存 ID/revision/reason_code。无 HTTP/复核/查询能力；提交后派发稳定 revision UUID，Broker 失败不撤销已接受记录。

## 迁移和停止

0055 additive，旧记录不回填 job/citation；旧 completed 结果不假装具有新的引用分类。RESTRICT FK 与不可变触发器保留历史。停新 Worker/beat，保留表并前向修复；不重写历史或删除新分析。未解决的文档冲突/破坏性迁移/状态指标安全修改/必要授权/未完成依赖才 blocked。
