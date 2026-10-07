# GEO-607 洞察性能门禁

使用真实 PostgreSQL、现有认证 HTTP 会话和虚构答案，不请求外部 AI 服务。
从现有集成 fixture 建立专用临时数据库，迁移至 head；退出时强制清理该临时数据库。
不关闭 trigger、约束、租约、复核或不可变守卫，不写应用指标缓存。

数据集固定生成 100,000 个 Run（另有 20 个模板及已有迁移反例）：20 个产品、365 天、
每批 10 次重复。每批 7 次完成分析、1 次待采集、2 次采集失败；分析模板覆盖待复核、
人工确认、无需复核三类，包含原始引用、引用分类、批准事实和声明。
时间固定在 2026-10-01 前一年，30 天窗口为 `[2026-09-02, 2026-10-02)`；洞察同时读取前30天。
所有对象、文本和来源均虚构，手工 Profile 明确配置为无需截图。这个数据形态在测量前确定。

```sh
make test-geo-performance
```

或使用隔离 Compose 项目：

```sh
make test-geo-performance COMPOSE='docker compose -p geo607-validation -f .trellis/tasks/10-04-geo-607-insight-performance/evidence/validation-compose.yaml'
```

每个场景预热2次，然后测量20个完整 HTTP 请求（含认证、响应生成和客户端 JSON 解析）。
P95采用 nearest-rank，目标为 PRD §15.4 的3秒；产品和全对象场景必须同时通过。
洞察严格检查每次15条 SELECT（认证1条、应用14条），报告预览多一次数据库时钟为16条。
每次还验证单产品600/全对象8400个当前候选、420/4375个合格Run、非空前期和实际计划行数，
防止空结果或全部不合格样本假通过。
对实际发出的12条 GEO SELECT运行 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`；
认证查询参数不进入证据。输出 fixture、原始耗时、环境和全部查询计划到 `.results/candidate/`。

优化前可显式设置 `GEO_PERF_PHASE=baseline` 保存不强制耗时阈值的观测；正式 Make 门禁
强制 candidate，不能通过环境变量误用基线模式。性能测试独立执行，普通 unit/integration
不隐式生成大数据。R5完整门禁由 `make verify` 包含此目标。小数据测量合同检查另在
`test_geo_performance_fixture.py`，它不生成P95通过证据。

该 fixture 覆盖短回答、单引用、20产品和单个手工采集环境，每产品重复同一模板；
高输入多样性、长回答、多引用、多平台、
真实网络和目标 VPS 容量验收属于 GEO-905，不能由本地结果推断生产启用。
