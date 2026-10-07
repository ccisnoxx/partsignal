# GEO-905 / R8 容量硬化实施与验证记录

当前状态为blocked：代码与本地容量检查完成，目标环境规格、测试入口授权及冻结阈值缺失。
状态以task-manifest为准；本记录不构成目标VPS验收或GEO-906发布授权。

## 依据与执行边界

GEO-607、GEO-902均done并有人工接受，GEO-905允许planned进入执行。
按Task Brief完成preflight和当前行为基线，manifest改为in_progress。根树包含大量前序任务改动，
本次只维护905增量，before/源码patch保留归因依据；未提交、部署或实施906。

目标环境规格、入口授权与冻结阈值尚待输入。PRD列表/详情2s、洞察3s是既有合同，
技术测试文档500ms/800ms/2s/创建5s为建议，要求目标环境验证后冻结。
本地Docker仅2CPU、4095643648字节内存，PG16.15/Python3.12.14，不能冒充VPS验收。

## 实现

Run列表先在同一RR快照按所有既有过滤选ID/created_at、确定性排序与offset/limit，
再按选定一页加载完整冻结输入、答案、当前分析复核及资格投影。
过滤/total/latest/current、ASC-DESC和同时间UUID顺序保持；Router/状态机/指标未改。
基线第4000页P95=1.008s，实际计划对宽JSON行做external merge，临时写35120块约274MiB；
最终独立负载候选深页0.169s、内层仅24字节键，页内PK加载20行，临时419块约3.3MiB，
实际SQL执行88.742ms。相同本地fixture深页HTTP P95下降83.3%；不外推至目标环境。

不新增索引/物化：实测瓶颈由分页前数据宽度解决，复用0057日期索引、Run PK和后继/答案/复核索引。
现有Batch缓存可由完整历史重建；读取和授权不依赖缓存状态。继续实时RR从PG权威事实派生，
Redis只传稳定ID，不维护业务缓存。不以修改指标或历史来换性能。

CELERY_CONCURRENCY现在为真实启动参数，默认1、范围1..10；三套Compose移除固定CLI1覆盖。
prefetch1、acks_late、失联重投、PG准入/预算锁、lease/SENT裁决和事务外I/O不变。
配置变化需受控recreate；不调整实际runtime或部署限额。

## 已取得的证据

| 检查 | 实际结果 |
|---|---|
| 既有100k R5洞察门禁 | 1 passed；全局洞察P95=2.875s、总览1.546s，产品查询0.153–0.272s；满足原3s，不证明建议2s |
| 905读取定向回归 | read_models/runs/review_reads/read_consistency 46 passed，固定查询数、RR交错/排序/过滤覆盖 |
| 1000批次与Worker隔离修正 | 3 passed；1000唯一root、幂等重放；threads/prefork各20消息、10答案、10本地请求；观测在fixture计数20/0 |
| Worker启动配置 | 7 passed，真实consumer读取env1/10及三套Compose不覆盖 |
| 初始100k列表/导出基线 | 首0.177s、深1.008s、复核0.157s、批次0.014s、状态0.159s、详情0.008s；保存实际EXPLAIN |
| 100k CSV基线 | 100000有序行/100000块/93015708字节，36.109s，首块44ms；5000行后RSS增长1155072字节；正常与1000行断流均回池 |
| 首次候选容量门禁 | 1 failed/3 passed；深页0.263s已改善，状态筛选0.590s未达500ms；与完整integration争用资源，保留失败并在其退出后重测 |
| 最终make test-geo-capacity | 4 passed / 540.12s；100021存量，100000候选；列表首/深/复核P95=0.067/0.169/0.069s，批次/状态=0.013/0.165s，详情=0.008s |
| 最终1000-run批次 | 创建0.662s（单次）、锁内投影P95=0.065s；1000唯一root与幂等重放验证通过 |
| 最终CSV | 100000有序行/100000块/93015708字节，51.182s，首块47ms；5000行后RSS采样增长1273856字节；正常与1000行断流均回池 |
| 最终10路Worker | threads及prefork各20消息/10Run/10本地请求；prefork采集1.696s、11进程采样PSS=840221696字节（801.3MiB）；无真实平台调用 |
| make lint / make typecheck | 候选执行均exit0；后端249源码typecheck通过；最终lint在Worker隔离修复后exit0 |
| make test-integration | 原命令1170 passed/6 setup errors/43 warnings，缺显式PG恢复工具；未称原命令通过 |
| 恢复6项补验证 | 显式PG16容器工具/独立来源与目标，6 passed；不重跑已通过的1170项 |
| git diff --check | 实施及收尾均exit0，增量diff另行保存并核对 |

最终容量门禁在完整integration退出后独立运行。每个HTTP场景预热2次/20样本、nearest-rank，
验证非空/100000实际候选/复核17500；真实SQL EXPLAIN ANALYZE BUFFERS JSON保留。
CSV实际ASGI发送不缓冲全量；threads和prefork只用本地fake，唯一UUID队列清理。
全部样本/计划/日志及精确恢复工具命令见[Trellis实施记录](../../../.trellis/tasks/10-05-geo-905-capacity/implement.md)。

## 独立复核及隔离

fresh critical_reviewer复核最终生产源码及修复后测试，未确认未修复的问题。
确认并修正threads无db参数观测使用默认连接、Make旧baseline phase可能移除0057索引两项P2。
本次默认开发库实测没有geo_operation_health表，未观察到虚构运维计数落库；修复仍保护已到0065的环境。
复核没有替代最终性能或目标环境验证。审计digest与写入证据等级记录在Trellis。

## 合同、迁移、安全和限制

OpenAPI/generated、数据库合同/ORM、Alembic均无新增；head仍0065_geo_observability。
测试临时库成功前滚到head，无历史回填/破坏性迁移或生产执行；无需新增迁移回滚。
应用事务、锁顺序、revision、幂等键/发送边界、审计与不可变守卫保持；CSV白名单/防注入和认证/CSRF/SSRF/TLS未放宽。
前端路由/query key/URL状态/页面无变化。所有业务文本/对象/平台均虚构；无真实AI调用。

fixture为20冻结输入、短回答、单引用、365天100k存量，30天当前8400候选；
未证明30天100k密度、高输入多样性、长回答、多引用、持续运行或目标VPS容量上限。
prefork主加10子进程最终采样PSS约801MiB，高于staging512MiB限额；production1GiB余量也未获验证，不能直接提高实际并发。
未运行生产迁移/部署、远端CI、browser真实平台、完整E2E或GEO-906。后续仅在本任务补齐目标环境和冻结输入后完成容量验收，906仍为独立后续任务。

## 停止与恢复条件

manifest与Trellis均in_progress→blocked，命中用户限定的“完成本任务必需的外部输入或人工授权缺失”。
不因上述已分类的本地setup错误或已通过的性能重测阻断，也不虚构review/done。
恢复需提供目标环境资源规格、明确授权的测试入口、冻结阈值和代表性数据负载；
也可明确接受本地隔离环境及其阈值/负载为验收目标，再按该定义补齐未覆盖证据。
