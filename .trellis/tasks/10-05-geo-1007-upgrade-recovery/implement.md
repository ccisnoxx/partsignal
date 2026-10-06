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
