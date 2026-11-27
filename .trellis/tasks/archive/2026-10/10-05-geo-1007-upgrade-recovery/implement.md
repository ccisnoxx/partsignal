# GEO-1007 实施与恢复证据

设计和测试计划在首次源码修改之前写入 design.md。入场工作树位于 geo/GEO-906，含大量前序改动；本任务按 evidence/before 与增量 diff 隔离记录，未提交、推送、归档或操作远端。用户 GEO-1007 对应 delivery manifest 的恢复范围 GEO-1008，原页面/API GEO-1007 不改编号或状态。

## 方案与最终合同

选择受控前向修复：同 schema head、同完整 Python/SQL 迁移树，两份认证归档、maintained tree 和 failed/fixed 冻结镜像全部一致；全项目及活动数据挂载 stopped，完整新 manifest/镜像身份校验，失败身份 CAS、唯一 recovery ID 与批准引用。维护窗口显式 abort/recover 需升级前一致性备份绑定及外发/业务写入对账，现有 upgrade 无该证据，不能用 previous_candidate 直接 initialized；另行授权设计。

恢复入口只原子绑定新 candidate、追加 old/new 全身份与迁移摘要及失败缓存策略回执，仍 UPGRADE_DEPLOYING。previous_candidate 保留；完全一致重放需全服务 stopped 且仍 deploying，冲突/旧 artifact/错误候选/manifest/schema/归档/迁移树均失败关闭。prepared 前由权威 Compose、冻结 backend 验证既有 preflight-integrity 和实际唯一 schema head；完整 deploy、外部 Gate 与 activation 仍必须执行，bootstrap unknown/failed 不能绕过。

upgrade先完整consumer与只读phase/candidate判定，registry交付/identity验证后才原子begin，仍早于任何run/up；clean-init顺序不改。首次 initialized→upgrade 在迁移前证明 runtime/host 与 frozen image Env 均无非空 PYTHONPYCACHEPREFIX，并原子绑定 DEFAULT_PYTHON_CACHE_V1 策略。历史缺失/unknown/候选错配不接受；同候选重入不补造历史证明。两端离线镜像仍拒绝默认树内 pyc/pyo 和镜像默认缓存前缀。canonical Dockerfile 的 runtime/test 在 uv sync 后清理迁移缓存；历史缓存镜像、缺少镜像/归档或策略证明保持维护安全停止。

run-locked 转发 SIGINT/SIGTERM 到子进程组，最长 10 秒后 SIGKILL，不因重复信号延长；子进程退出后释放维护锁。Engine 已接收的操作不由终止 client 自动撤销，现场须核对容器/schema/状态，再由恢复 stopped 守卫裁决。

## 实际验证

| 验证 | 结果 | 低敏证据 |
| --- | --- | --- |
| 原死路：upgrade失败，新candidate及未initialized rollback拒绝 | 复现 | baseline-red.log、compose-registry-final.log |
| 恢复身份/阶段/manifest/归档/静默/原子中断/重放/schema/信号 | 19 PASS | unit-registry-final.log |
| 失败执行策略绑定、unknown/缺失/错配/重入不补造 | 6 PASS | cache-policy-registry-final.log |
| 历史策略门禁因果反例 | 仅禁用新guard时按预期失败；磁盘源码不变 | historical-policy-red.log |
| 真实缓存镜像 | 默认树内、默认Env树外拒绝；历史runtime清除时需要既有策略，CAS前拒绝 | image-cache-historical-counterexample.log |
| 隔离 PostgreSQL 16 / 权威 Compose | 真实迁移提交后 exit23、API启动exit24；显式接管、replay、deploy→activate PASS | compose-registry-final.log |
| 数据保持 | 69张既有表完整行摘要相同，排除revision与可变诊断heartbeat表 | compose-registry-final.log |
| SIGTERM 普通子孙退出及锁 | PASS | unit-policy-final.log |
| 忽略TERM的子孙 | 10秒后强制进程组终止，锁持有至退出，阶段不推进 | sigterm-forced-group.log |
| Compose失败后SIGTERM | exit143，专有container/network/image/temp清理0 | compose-sigterm.log |
| canonical backend test/production 构建 | 两目标构建完成，迁移缓存0，专有镜像清理 | canonical-test-build.log、canonical-production-build.log |
| registry未缓存交付 / 坏manifest零交付 | 2 PASS；修复前红例exit81 | registry-order-red.log、registry-order-final.log |
| 发布定向回归 | 新时序最终串行PASS；误并行失败单独保留 | production-registry-serial.log、production-policy-serial.log |
| Python lint | PASS | ruff-registry-final.log |

Production Engine自检与隔离Compose曾误并行使用固定网络，production-policy-final.log exit1是本次调度冲突；在Compose清理后改串行，详见 parallel-network-conflict.md。此前fixture导入、摘要诊断和缓存保证失败均保留原始日志，最终成功证据不能将这些历史失败改称通过。

## 独立复核与覆盖边界

fresh critical_reviewer 已发现并推动修复：failed镜像证明遗漏；默认迁移缓存；树外prefix；历史runtime清除；缓存策略入场、历史拒绝和registry pull时序已实施，最后一轮fresh复核无确认新阻断，见 evidence/review5-result.md。独立审查任务完成不等于候选实现已接受，最终结果见 evidence/review5-result.md；审计Bundle见下方引用。

本地合成AI/OSS MET只是隔离夹具，不代表生产批准或真实外部服务。69表夹具显式创建账号，未覆盖有内容Publishing/GEO不可变历史；Compose SIGTERM在失败命令退出后注入，未覆盖Engine操作进行中。目标服务器、公网maintenance、生产备份/外发对账、正式clean main候选与GEO-1009/1010全门禁未执行。没有相关风险要求运行无关全仓make verify。

最终全工作树 diff --check 的 GEO-1001审计Markdown尾随空格属于入场既有问题；不顺手修改。只对本任务维护文件及实际增量检查，新增测试/模板亦检查空白、语法和低敏内容。

## 交付状态

任务已置 review，delivery同范围GEO-1008同步review，原页面/API GEO-1007仍planned。review不是人工接受、正式候选冻结或生产发布。保留任务指针与所有证据，不归档。

审计Bundle ID：20261006T054537Z-geo-1007-upgrade-recovery-592e0aff；持久化目录 /Users/sc/.codex/audits/multi-agent/partsignal-2069b161/20261006T054537Z-geo-1007-upgrade-recovery-592e0aff。5项fresh独立审查任务，首轮写审计unknown，后续快照证据限受审源码；Digest最终校验结果另存 evidence/audit-verify.log。

最终文档YAML解析、SHA256SUMS（排除运行cache）、本任务增量空白及scope diff检查通过；最终专有资源清理库存为空。独立复核返回后仅澄清Runbook“身份检查与离线探针”用语，不改变行为；当前源码摘要见 final-source-hashes.json。审计Digest已复制到evidence，原Bundle闭合且audit-verify通过。


## 2026-10-06：固定 commit 独立审查后的修复

用户对 8162f58029e3425c39bebab6806634e519330985 返回 CHANGES_REQUESTED，并明确要求“直接修复，保留严格失败恢复语义”。以上 2026-10-05 的测试/复核是原交付历史，不再代表当前恢复程序已经通过审查。未扩大为 geo/GEO-906 整分支验收，不提交/推送，不操作生产。

### 最终行为与兼容边界

- manifest 增加 images.migration 与 MIGRATION_RUNTIME_V1。首次默认 backend；修复 manifest 显式保留失败迁移镜像，Compose migrate 与 API/CLI 使用独立 image 角色。恢复严格要求原迁移 image ID 以及完整 rootfs/执行配置指纹；所有 app、动态加载内容、依赖、Python/缓存/mtime、共享库、基础系统冻结，局部 AST 不能充当闭包证明。old/new archive、checkout 与镜像的 Alembic 树另行认证。
- 首次 begin-upgrade 在迁移前原子冻结 candidate-bound runtime/cache proof；失败候选的历史证明缺失不能由恢复时的当前正常配置补造。应用 runtime.env 只接受已认证脚本直接声明的生产合同白名单，模板不能新增 loader 授权，合法可选日预算保留；Dockerfile 清理整个 /app 缓存。
- deploy.sh 非零退出持久化 candidate/attempt/stage/exit/signal/time/kind/低敏引用；prepared 后的问题用独立批准声明，不伪装部署失败。recover 必须消费当前终态失败 attempt 的未消费 record，并将原事实绑定进原子 receipt。正常 deploying/prepared 候选、重试后的旧失败均拒绝；失败 prepared 不能激活。
- 正式 recover-upgrade 自动进入 run-locked，验证继承FD；SIGINT/SIGTERM 转发整组，10秒后必要时 SIGKILL，确认无可执行子孙才解锁。OS 状态不可读时保留锁，不能把投递信号当成停止证明。恢复不启动服务、不写业务数据、仍 UPGRADE_DEPLOYING，随后必须完整 deploy/readiness/integrity/schema/Gate/activate。
- 新 consumer 不接受缺 migration identity/fingerprint 的旧 manifest。已失败的旧状态若未在迁移前记录证明或没有失败事实，继续安全停止，不能迁移旧 state 补造历史。

### 实际验证与证据

| 检查 | 结果与范围 |
| --- | --- |
| make test-upgrade-recovery | 49项通过：recovery19、failure6、runtime-policy7、runtime8、cache-policy6、registry-order3；另两项SIGTERM场景通过。见 evidence/remediation-final-unit.log。 |
| 实际 recover-upgrade 父PID SIGTERM | 阻塞fake docker ps期间注入；忽略TERM的子孙不可执行后才释放锁，原state字节不变、退出143。generic整组期限另覆盖。 |
| test-upgrade-image-cache.py | 真实Docker识别同Alembic而app schema/db/models/helper/main/native/data、依赖/Python/base/mtime/pyc选择变化；app unchecked-hash缓存拒绝、重复导出稳定、owned资源清零。见 remediation-isolated-runtime-images.log。 |
| test-upgrade-recovery-compose.py | 真实PG16/权威Compose，head0065→0066后artifact exit23，APIimport exit24，原死路拒绝，严格恢复/replay/完整deploy→activate，69张既有表完整行摘要保持；本次资源清零。见 remediation-isolated-runtime-compose.log。 |
| canonical production/test | 两目标实际构建通过；完整rootfs指纹与当前Alembic源码匹配，见 remediation-canonical-production.log、remediation-canonical-test.log、remediation-canonical-fingerprints.json。 |
| test-deploy-production.sh | 真实本地Engine网络兼容与生产输入/manifest/编排/两阶段激活/rollback消费者自检通过；见 remediation-final-production.log。 |
| 权威Compose迁移绑定 | 默认migration=backend；显式恢复配置时migrate使用原reference、api使用修复backend、迁移command固定；见 remediation-compose-image-binding.log，最终production自检亦包含此断言。 |
| 定向Ruff | 全部15项维护Python脚本检查通过；未运行无关全仓测试。 |

最终复核另发现白名单遗漏可选日预算，以及模板未经候选认证却可以新增 loader 授权；分别加入预算正例和真实临时模板漂移负例，确认修复前红，再由已认证脚本直接拥有稳定允许键。最终7项runtime-policy、完整49项与Production自检覆盖修正后结果。

中间AST/部分app闭包候选被fresh只读审查拒绝，原因是动态加载和非Python数据不在完整程序证明中；最终用独立完整迁移镜像替换该模型。首次Compose API故障用uvicorn多worker respawn观察导致等待不能结束，已精确停止本次资源；改为直接import app.main确认真实exit24，正常修复候选仍完整部署/健康/激活。生产自检夹具最初从开发env复制额外变量，被新生产白名单正确拒绝；诊断到具体断言后过滤为生产模板字段，最终同一入口通过。其余中间失败日志保留作为过程证据，不计入最终通过。

### 独立审查与未验证范围

最终 fresh critical_reviewer 已只读核对完整最终diff与源码，无未解除确认问题；预算兼容与模板loader授权两项发现已独立复核关闭，见 evidence/remediation-review-final.md。本次Audit Bundle：20261006T134155Z-geo1007-review-remediation-e9a77228。审查任务完成与候选通过分别记录，不能把Agent运行状态视为接受。

本地Compose使用合成账号和稀疏业务表；69表摘要不证明丰富Content/Publishing/GEO不可变业务历史。AI/OSS MET为明确合成夹具，非真实Gate。目标服务器、公网maintenance503、真实备份/registry/AI/OSS、精确新commit远端CI及正式clean main候选未验证；未执行make test-deploy-scripts整体（其无关Frontend/GEO/E2E门禁未因本修复改变）。实际recovery信号证据来自fake Docker阻塞边界；没有声称真实Engine操作进行中SIGTERM已覆盖。仍review，人工接受与生产发布未执行。

最终49项与Production harness均确认退出0；审查后仅文档/记录/校验清单收尾，未更改执行行为。审计Bundle已closed且audit-verify通过，六列Digest见 evidence/remediation-subagent-digest.md，验证记录见 remediation-audit-verify.log。两个canonical专有标签按已冻结image ID核对后移除；不清理共享镜像、开发资源或Engine。最终资源库存和源码摘要见 remediation-final-resources.json、remediation-final-source-hashes.json。


## 提交、推送与会话收尾

用户在修复交付后明确要求“请提交并推送，然后收尾”。修复及对应证据已提交为 `d431e51894c0574928fee3bcc25bce9fec0725d1`（fix(deploy): enforce strict upgrade failure recovery），推送到 origin/geo/GEO-906，未合并main。收尾记录引用这一真实提交，不更改已验运行行为。

提交前确认全部58个变更归属本修复，维护文件与最终验证快照一致；代码/维护文档staged diff检查通过。原始patch证据中的context空白与失败日志中两处原始输出行尾空白按证据语法保留，不篡改历史输出。49项、两个SIGTERM场景及真实Docker/PG Compose等既有有效证据复用，没有因提交重复运行无关全门禁。

会话收尾清除本会话任务指针并记录journal；任务继续review，保留所有资料和人工验收入口，不归档或修改其他任务。用户提交推送授权未扩大为整个geo/GEO-906分支接受、生产恢复/发布或GEO-1009/1010执行。提交后的精确commit远端CI未在本次收尾中验证。


## 2026-10-06：137a9fc6 独立复审后的执行所有权修复

固定137a9fc6的独立审查为CHANGES_REQUESTED，迁移运行时闭包RESOLVED，监督FD绕过、公开失败recorder来源和post-migration缺表仍阻断。旧日志/审查保留为历史，本轮未沿用APPROVE。用户明确授权按顺序修复、验证、提交推送、固定新SHA fresh独立复审，再按结果决定单项接受。

公开 recover-upgrade/deploy-production 无条件持锁 supervisor + 私有 fork worker；继承FD只复用锁。SIGINT/SIGTERM、10秒SIGKILL、OS子孙停止证明由 production_maintenance_execution.py 拥有，嵌套私有进程组也受治理，macOS zombie EPERM不当作错误解锁。部署编排由 production_deployment.py 执行；worker创建attempt、通过外部CLI不继承的私有pipe报告attempt/stage，父级依据实际waitpid/信号及已冻结状态写失败事实。删除公开begin-upgrade、mark-upgrade-prepared和record-upgrade-failure入口，不增加env监督豁免。prepared后独立批准声明仍保留其明确人工语义。

迁移前默认integrity允许未建表；所有部署迁移后与恢复prepared证明使用--require-schema，四张核心发布表缺任一张显式REQUIRED_TABLE_MISSING。保留精确head、行完整性、同冻结migration image/rootfs/source约束，正确head不能替代表结构。两个执行模块纳入13项producer/consumer权威allowlist，Runbook/spec/template同步。

预提交验证命令、HEAD、dirty标识、UTC开始结束、退出码和完整日志保存在evidence/execution-owner-remediation。targeted-recovery-final为50项（新source信号单独4项，其中3为既有），实际recovery/监督信号7场景通过；backend debugger定向unit20通过。真实PG16/Compose保留正确0066head、临时改名published_articles且保留行/OID：recover后实际deploy退出1，仍UPGRADE_DEPLOYING/current attempt FAILED/candidate不变；还原后完整deploy→activate，69表行摘要相同，owned资源清零。真实迁移运行时镜像负例保持通过。production-regression-final和production-cleanup通过。

中间失败与诊断保留：macOS zombie EPERM；部署校验顺序V1错误提示漂移；入场image probe原validation exit2改变；新增迁移后strict检查使旧AWK混用pre/post时序。逐项根因修正，最终成功没有覆盖历史失败。新SHA固定后验证、fresh独立复审与接受决定另行记录。本轮仍review，task.commit中的d431e518是上一轮历史实施提交；新审查以实际新提交SHA为准。

未运行无关frontend/GEO/E2E全门禁；未验证真实服务器、公网maintenance、生产备份/registry/AI/OSS、丰富业务不可变历史、远端CI、clean main/RC。合成MET与稀疏69表摘要不代表生产验收。用户GEO-1007对应delivery GEO-1008，原页面GEO-1007不重编号。


## 新固定提交复审与单项接受

修复提交 `baea420fb8a479d66d578d3f4fd91d38086b8c29` 已推送 origin/geo/GEO-906。clean固定SHA下重新运行定向恢复51项+7个监督信号场景、真实PG16/Compose及runtime镜像、生产harness、backend20unit，全部exit0。记录含命令、SHA、dirty=false、UTC开始结束、退出码、日志SHA256；见本轮evidence下fixed-sha-*。

fresh只读critical_reviewer对该SHA返回APPROVE，监督旁路、失败事实来源、严格缺表与原runtime合同均RESOLVED；见independent-review-baea420f.md。审前/后全tracked源码快照无变化。按用户第五项条件授权，单项接受记录acceptance.json绑定该受审SHA，task状态completed（项目done约定）/completedAt为实际2026-10-06。保留历史，不归档其他任务；GEO-1007仍对应delivery1008，原页面任务编号不变。

此接受不表示geo/GEO-906整分支通过、生产恢复在真实服务器演练或v1.0.0-rc1冻结。下一阶段重新审计Browser/Catalog/CRON/Opportunity/文档/候选完整门禁矩阵，再由全分支PR/main/RC各自门禁裁决。PR已存在#1；固定受审SHA没有远端CI，不宣称CI通过。
