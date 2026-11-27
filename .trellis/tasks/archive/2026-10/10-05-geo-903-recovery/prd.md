# Task Brief：GEO-903 备份恢复演练

## 1. 基本信息
GEO-903；R8；done（2026-10-05 本会话用户人工验收完成）；主代理；geo/GEO-903；依赖901/902均done且已人工接受。无提交、发布或生产恢复。

## 2. 目标
数据库、OSS对象及适用密钥成套恢复，任意Run Detail和指标可重算；缺失对象明确失败，Browser条件性N/A有环境检查依据。

## 3. 关联需求
CAP-GEO-16；PRD§14/15/17；数据架构§12；运维§10.3；TEST-GEO-OPS恢复及manifest完整903行。

## 4. 必读文档
根/后端AGENTS，Trellis workflow、infra/backend规范；README、roadmap、WBS、execution guide、template、manifest、governance；PRD、domain、state machine、methodology；技术架构、数据、安全、测试、运维及Accepted ADR001～006。大型合同按完整受影响单元读取：FileRecord/AI凭据/Run Detail/Overview/Batch调度/Browser/0064～0065。

## 5. 当前行为
备份只有SQL gzip；任意URL恢复无隔离守卫，仅表计数。现有0065、不可变证据、CredentialCipher、存储适配器和scheduled factory可复用。902部署gate既有retention任务断言失败。没有生产cron接线。

## 6. 目标行为
带同快照库存与数据库dump的加密集合；对象逐一真实GET/hash；AI主密钥及session/upload签名秘密配套；只新建随机owner标记数据库并精确清理；对象恢复到临时目录；扫描逐项报告，失败不宣称完整。Browser只有部署证据、PG零引用及配置/材料检查全成立才N/A。

## 7. 范围内
备份/恢复编排、隔离和加密、低敏清单/一致性报告、真实恢复与反例测试、运维说明。

## 8. 范围外
904/905/906、R7延期任务、生产发布/主库恢复、cron接线、新业务状态或公式、真实AI/Browser账号、依赖升级、无关重构。

## 9. 不变量
PG唯一业务来源；Redis不备份成状态库；历史/revision/发送事实不改写；已发不重发；缺失对象不造字节/不删Run；恢复只新建owner隔离库。

## 10. 契约变化
OpenAPI/database schema/Alembic均无变化；恢复当前head0065，零数据迁移/回填。不新增HTTP协议。

## 11. 后端实现
Router/Application Service无修改；扫描工具复用CredentialCipher、原生Run Detail/Overview及存储接口。只读RR快照；备份quiesce由运维明确证明；调度验证调用既有service，只在隔离测试中执行。

## 12. 前端
N/A，无路由/query/页面状态变化。

## 13. 测试计划
定向baseline与真实PG恢复；真实对象下载/hash；加密/错密钥/缺失对象/隔离目标拒绝/只读扫描；恢复后历史同窗口并发去重。四项用户gate，无全量产品E2E或性能矩阵。

## 14. 验收
同快照dump与库存，数据摘要完全匹配；恢复所有夹具Run Detail与业务/质量指标；凭据及敏感Header可解密；missing/corrupt显式列文件ID并非零；历史调度窗口并发只返回原回执；Browser N/A带范围证据，材料存在不能N/A。

## 15. 命令
`git diff --check`、`make lint`、`make typecheck`、`make test-deploy-scripts`及实现后精确测试命令见implement。

## 16. 数据和上线
读源备份前暂停外部写入、所有Worker/Beat/清理。隔离恢复无API/Worker/Beat/外部egress；不复用生产OSS/Broker。恢复PENDING/RUNNING按运维runbook显式处置，不复写SENT/UNKNOWN。

## 17. 风险/停止
按用户五类block条件。环境失败精确记录；不从默认配置推断生产false。现有Browser材料必须另保护及实际恢复/撤销验证，不得N/A或伪成功。

## 18. 证据
本目录evidence保存before快照、基线、测试结果、脱敏报告与只读复核。敏感dump/密钥/对象仅临时目录，finally精确清理。

## 19. 后续
904安全、905容量、906上线；804～807仍deferred，不实施。
