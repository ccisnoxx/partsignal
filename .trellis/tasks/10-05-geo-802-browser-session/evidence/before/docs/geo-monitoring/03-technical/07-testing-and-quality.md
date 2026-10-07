# GEO-607 / R5 性能执行门禁

`make test-geo-performance`使用临时PostgreSQL和虚构数据生成100k Run，纳入`make verify`。
固定30天窗口及紧邻前期，测产品600/全对象8400当前候选；候选数量与实际计划行数必须一致，
不能用200、响应大小或空数据证明密集性能。认证HTTP预热2次后采20样本，nearest-rank P95≤3s。
总览/洞察固定15条SELECT，报告预览16条（另取数据库时钟），12条GEO SQL全部执行实际EXPLAIN。
只读一次RR及完整冻结维度/公式仍由既有权威服务维护。基准不请求外部AI，不关闭数据库守卫。
原始样本、计划、环境、失败分类、迁移与人工接受状态见
[GEO-607验收记录](../04-delivery/06-r5-insight-performance-acceptance.md)。

# PartSignal GEO 测试与质量策略

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 文档状态 | 目标设计 |
| 原则 | 契约优先、PostgreSQL 真实约束、可重复替身、公式金标、真实纵向 E2E |

## 1. 测试层级

| 层级 | 目的 | 工具 |
|---|---|---|
| 单元 | 状态机、公式、匹配、URL、规则和错误分类 | Pytest/Vitest |
| 契约 | OpenAPI、Pydantic、运行时 Schema、生成类型一致 | contract check |
| PostgreSQL 集成 | 约束、锁、事务、迁移、并发和查询 | Pytest + PostgreSQL |
| Worker 集成 | Redis、Celery、租约、补投递、at-most-once | Pytest + Redis + Worker |
| Collector contract | 不同 adapter 符合统一输入输出和错误语义 | fake provider/local site |
| 前端组件 | 表单、筛选、状态、冲突和安全展示 | Vitest + Testing Library |
| E2E | 用户从配置到运行、分析、机会和复测 | Playwright + real stack |
| 安全 | secret、SSRF、XSS、CSV、权限、数据分级 | 定向自动测试 |
| 性能 | 大批次、洞察查询、导出、并发 Worker | 脚本/基准测试 |
| 运维 | 迁移、备份恢复、开关、停止和恢复 | CI/隔离环境 |

## 2. 测试数据原则

- 使用虚构公司、产品、型号、竞品和域名；
- 不使用真实生产 API Key、Cookie 和账号；
- 外部 provider 使用本机显式替身；
- 所有第三方外发测试事实显式标记 PUBLIC；
- 测试时间固定或使用数据库 clock；
- 运行 ID、请求 ID 和 provider response 可确定；
- 金标答案覆盖中文、英文、型号、连字符和歧义别名；
- 错误 fixture 不能因默认值绕过门禁。

## 3. 单元测试矩阵

### 3.1 Catalog

- subject type/product/parent 组合；
- alias 规范化和歧义；
- IDNA 域名；
- domain ownership；
- available actions；
- deletion blocker。

### 3.2 Planning

- PromptVariant 唯一性；
- branded/unbranded；
- 运行矩阵数量；
- 不合格 profile blocker；
- repeat 范围；
- Cron/timezone；
- budget known/unknown；
- plan stage/action。

### 3.3 State machines

- Plan 所有合法和非法转换；
- Batch 投影；
- Run collection/analysis/review 转换；
- Opportunity 转换；
- 终态不可回退。

### 3.4 Metrics

建立金标小数据集，覆盖：

- 分母为 0；
- 失败运行不算未提及；
- branded/unbranded 分离；
- Mention/Recommendation SOV；
- 同一回答多个竞品；
- 引用 URL 去重；
- ACCURATE/PARTIAL/INCORRECT/UNJUDGEABLE；
- 样本等级；
- 前周期；
- 模型版本不同；
- 人工复核覆盖机器分析；
- NEEDS_REVIEW 排除；
- 稳定性全成功、全失败和混合。

### 3.5 Opportunity rules

每条规则测试：

- 正常触发；
- 阈值边界；
- 样本不足；
- 无分母；
- 去重 identity；
- 已有开放机会更新；
- 已解决机会是否创建新周期机会；
- 不可比窗口跳过；
- trigger snapshot 完整。

## 4. 数据库与迁移测试

### 4.1 Schema

- 所有新表、索引、FK、CHECK 和 unique；
- metadata 与 Alembic head 一致；
- downgrade 非默认，不要求生产回退；
- 从当前 head 前滚；
- 空库和有现有 GEO 数据的数据库均可迁移；
- 旧 `GeoObservation` 不被改写。

### 4.2 并发

至少覆盖：

- 同一 Product 并发创建 OWN_PRODUCT subject；
- alias 唯一冲突；
- 同调度窗口创建 batch；
- 同 run 并发 claim；
- 同 run 并发提交 manual answer；
- 并发创建 retry successor；
- 并发 AnalysisRevision；
- 同 opportunity identity 并发触发；
- 并发预算预留；
- 取消与 claim 竞态；
- 迟到结果和终态竞态。

数据库错误映射只测试精确 constraint diagnostics，其他异常保持 unknown。

### 4.3 不可变性

使用直接 SQL 反例证明：

- AnswerSnapshot 不能 UPDATE；
- Review 不能 UPDATE/DELETE；
- Run input snapshot 不能修改；
- 终态 run 不能回退；
- Opportunity trigger snapshot 不能修改；
- 引用的 subject/profile 不能物理删除。

## 5. Collector Contract Tests

每个 Collector 必须通过共同套件：

```text
validate supported profile
reject unsupported mode
return non-empty answer
normalize citation positions
report unknown capabilities as null
preserve provider request ID
enforce response size
classify 401/403/429/5xx/timeout/disconnect
never expose credential
at most one send per attempt
no redirect
no retry after send
```

### 5.1 Fake API provider

支持脚本化响应：

- success with/without citations；
- web search true/false/unknown；
- malformed JSON；
- empty answer；
- 429 + Retry-After；
- slow body；
- connection drop before send/after send；
- redirect；
- oversized Content-Length/chunked body；
- provider error body containing fake secret；
- usage/cost partial。

测试断言 secret 不进入 error/log/audit。

### 5.2 Browser adapter local site

使用本地测试应用模拟：

- 登录态；
- streaming answer；
- DOM 稳定；
- citations cards；
- selector change；
- bot challenge；
- timeout；
- sensitive account menu；
- temporary chat mode。

CI 不访问真实 ChatGPT、豆包、DeepSeek 等第三方产品。

## 6. Analysis 金标测试

建立 `backend/tests/fixtures/geo_analysis/`：

GEO-005 / R0 已建立共享虚构语料和独立金标。当前格式、版本规则、敏感数据边界及加载命令以 [fixture README](../../../backend/tests/fixtures/geo_analysis/README.md) 为唯一权威，`make test-geo-fixtures` 执行离线 Schema/关系/敏感数据校验；Python 和 frontend/src/test 加载同一 JSON。实际验证与环境限制见 [GEO-005 实施证据](../../../.trellis/tasks/10-01-geo-005-fixtures-gold/implement.md)。本任务只交付测试基础设施，以下分析器质量验收仍由后续任务完成。

- answer text；
- subject/alias snapshot；
- fact markdown；
- expected mentions；
- expected recommendation/rank；
- expected claims/verdict/severity；
- review_required reasons。

类别包括：

- 精确型号；
- 型号后缀；
- 大小写和连字符；
- 同名品牌；
- 否定提及；
- 仅列举未推荐；
- 有序和无序推荐；
- 条件性替代；
- 参数数字冲突；
- 事实不足；
- Prompt injection 文本；
- 中英文混合。

分析器升级必须重新运行全部金标，并明确变更预期，不能只更新 snapshot 让测试通过。

## 7. API 集成测试

每组资源测试：

- 认证、CSRF 和账号类型；
- 正常 CRUD；
- revision；
- 分页/排序/筛选；
- action projection；
- idempotency；
- error envelope 和 request ID；
- 删除阻断；
- 审计；
- 敏感字段不回显。

复杂读模型测试：

- 同一 REPEATABLE READ 快照；
- query count 不随行数线性增长；
- filter options 来自真实数据；
- 数据质量排除计数；
- 所有 metric 返回 numerator/denominator；
- 下钻条件与摘要一致。

## 8. Worker 集成测试

真实 PostgreSQL、Redis 和 Celery Worker：

1. 创建计划和批次；
2. dispatch run UUID；
3. Worker claim；
4. fake provider 返回；
5. 保存 AnswerSnapshot；
6. Analysis Worker 完成；
7. Run COMPLETED；
8. Insight 可见。

故障测试：

- dispatch 丢失后补投递；
- 重复消息不重复调用；
- Worker 在发送前崩溃；
- Worker 在发送后崩溃；
- lease 过期；
- 迟到结果；
- kill switch；
- profile 停用；
- budget 超限；
- Redis 重连；
- 分析失败不丢 AnswerSnapshot。

## 9. 前端组件测试

重点覆盖：

- 路由 search schema；
- 列表 URL 持久化；
- Plan preview；
- run_count 由服务端使用；
- available_actions；
- revision conflict 保留输入；
- manual draft dirty 和提交；
- NEEDS_REVIEW；
- review correction；
- Metric null/observed/reportable/stable；
- DataQualityBanner；
- 后台轮询不清空成功数据；
- export error；
- secret 不进入 mutation state/localStorage/sessionStorage/console；
- principal epoch 隔离。

## 10. Playwright E2E

### GEO-106：当前 Catalog 纵向验收

`frontend/tests/e2e/catalog-real-stack.spec.ts` 使用真实 FastAPI/PostgreSQL，无路由 fixture；从页面准备 Product 和批准事实，创建 OWN_PRODUCT、竞品品牌/产品及双方 alias/domain，验证真实唯一冲突、保留输入、刷新及 ENGINEER 只读。`backend/tests/integration/test_geo_catalog_acceptance.py` 比较完整 Product 行、全部事实版本和审核历史，保证配置不改写事实。既有 Catalog API/并发用例继续覆盖权限、CSRF、revision、约束和锁交错。

该文件登记在 canonical `e2e-local.sh`，沿用隔离环境、秘密扫描和清理。布局/键盘证据由明确 fixture 的 `catalog-ui.spec.ts` 提供。实际结果及当前域名搜索缺口见 [GEO-106 验证记录](../../../.trellis/tasks/10-02-geo-106-catalog-acceptance/implement.md)。后续 E2E-01 的问题变体、profile、计划与运行属于目标方案，不能视为本任务已实现。

### E2E-01：主数据和计划

当前 GEO-205 配置切片由 `frontend/tests/e2e/surfaces-real-stack.spec.ts` 验收，登记在 canonical `e2e-local.sh`：真实 PostgreSQL/API 的管理员创建、启用、配置修改停用/UNTESTED、刷新持久化、真实子引用删除保护及 ENGINEER 摘要。保留 runtime 请求审计和秘密扫描；仅取消精确 GET，不豁免写请求中止。桌面和 375px 证据支持布局复核。权限、CSRF、未知键/值敏感回显、revision/锁交错与无缓存首次 GET 竞争由定向集成/组件用例保护，实际结果见 [GEO-205 记录](../../../.trellis/tasks/10-02-geo-205-surface-management/implement.md)。以下计划/运行步骤仍为后续任务目标。

- 管理员创建 subject/alias/domain；
- 工程师创建问题变体；
- 管理员创建 MANUAL profile；
- 工程师创建计划；
- 预览运行数正确；
- 启用和立即运行。

### E2E-02：人工回答级观测

- 打开 PENDING manual run；
- 保存草稿；
- 上传截图；
- 提交答案和引用；
- 分析进入 NEEDS_REVIEW；
- 人工修正；
- 运行 COMPLETED；
- 洞察显示结果。

### E2E-03：API 自动观测

- 管理员绑定 fake OpenAI-compatible profile；
- 连接测试通过；
- 创建并执行批次；
- UI 轮询看到状态推进；
- 回答、引用、usage 和 cost 可查看；
- 不使用 page.route 伪造业务响应。

### E2E-04：机会闭环

- 金标数据触发 TOPIC_COVERAGE_GAP；
- 用户确认机会；
- 创建 ContentTask；
- 模拟/执行任务完成；
- 创建复测；
- 查看前后比较；
- 显式解决。

### E2E-05：报告

- 应用筛选；
- 打开打印报告；
- 筛选、截止时间、数据质量和指标一致；
- CSV 列和值与列表相同。

## 11. 安全测试

| 测试 ID | 内容 |
|---|---|
| TEST-GEO-SEC-001 | API Key/Header/Cookie 不出现在 API、日志、审计、前端 cache、截图 |
| TEST-GEO-SEC-002 | SSRF、混合 DNS、peer 越界、redirect、超限 |
| TEST-GEO-SEC-003 | INTERNAL/RESTRICTED 数据阻断外部分析 |
| TEST-GEO-SEC-004 | 引用危险 scheme 和 HTML XSS |
| TEST-GEO-SEC-005 | CSV 公式注入 |
| TEST-GEO-SEC-006 | ENGINEER 不能修改 profile/rules/secret |
| TEST-GEO-SEC-007 | Prompt injection 不能调用工具或泄露 system/secret |
| TEST-GEO-SEC-008 | Browser session 引用越权和撤销 |

## 12. 性能测试

最低测试场景：

- 创建 1,000 run 批次；
- 10 个并发 Worker claim；
- 30 天 100,000 run 洞察查询；
- 1,000 citations/claims 明细分页；
- CSV 100,000 行流式导出；
- 批量 opportunity evaluation；
- 重分析限批；
- 对象存储截图并发写入。

验收建议：

| 场景 | 目标 |
|---|---|
| 列表 P95 | <500 ms |
| Run Detail P95 | <800 ms |
| 30 天 Insights P95 | <2 s |
| 1,000 run 批次创建 | <5 s 且无部分数据 |
| API Worker | 无重复外部调用 |
| CSV | 常量级内存增长 |

实际阈值应在目标 VPS 环境验证后冻结。

## 13. 运维和恢复测试

- 当前 head → 新 migrations；
- preflight 不合格时阻断；
- 功能开关关闭后的 API/Worker/Scheduler 一致行为；
- Scheduler 停止和恢复；
- PENDING 补投递；
- UNKNOWN_OUTCOME 不自动重发；
- 数据库备份恢复；
- OSS 证据恢复/缺失提示；
- 主密钥配对；
- Browser session 撤销；
- release rollback 兼容性。

## 14. 阶段质量门禁

每个任务至少运行：

```bash
make contract-check
make lint
make typecheck
make test-unit
```

涉及数据库、Worker 或业务流程时增加：

```bash
make test-integration
make e2e
```

发布增量完成时运行：

```bash
make verify
```

并补充 GEO 专项金标、性能、安全和恢复测试。

## 15. Definition of Done

任务完成需满足：

```text
[ ] 需求和不变量有明确引用
[ ] OpenAPI 已更新并生成前端类型
[ ] database contract 和 Alembic 已更新
[ ] Router 无事务/实体写入
[ ] 状态机由服务端唯一拥有
[ ] 单元和集成覆盖正常、边界、并发和反例
[ ] 前端加载/空/失败/冲突/权限完整
[ ] 无 secret 泄露
[ ] 相关 E2E 通过
[ ] 文档和任务状态已更新
[ ] 验证命令和结果已记录
```

### GEO-303：批次创建验收边界

使用真实PostgreSQL验证计划/临时配置冻结、同键并发/异载荷、调度同窗口跨revision与时区、1000 roots、分块写入/审计/数量完整性失败全回滚、历史引用删除保护及0048非空前滚/metadata对齐。普通验证不访问真实AI；创建没有派发或浏览器旅程。指定完整门禁、定向验证与测量证据见 [实施记录](../../../.trellis/tasks/10-02-geo-303-batch-factory/implement.md)。

### GEO-304：原始证据验收边界

真实 PostgreSQL 验证 0050 空库及非空前滚、历史原样保留、旧采集事实缺原始证据时原子拒绝和降级安全停止；验证 AnswerSnapshot/Citation 的 UPDATE/no-op/DELETE/提交后追加反例、闭合摘要 secret 拒绝、引用位置完整性与文件资格。文件边界通过本地 fake-OSS 实际 PUT/HEAD 重验字节元数据，并覆盖缺失/更换对象/不可用、上传者、GC 先后顺序及 REPEATABLE READ 陈旧快照冲突。此存储任务无新增浏览器旅程，相关门禁和证据见 [实施记录](../../../.trellis/tasks/10-02-geo-304-answer-evidence/implement.md)。


## GEO-306 / R2 实际读取验证边界

真实隔离PostgreSQL及本地fake-OSS验证：完整冻结输入与原始证据单请求返回；latest/all attempts、sample与attempt费用、全部Batch摘要不受分页影响；冻结维度、字面搜索、稳定分页及半开时间窗口；缓存状态漂移时status筛选仍按最新尝试投影。可控交错在count后新增Batch/停用Profile、读取Run后提交Answer，确认同一REPEATABLE READ没有混合新旧行。固定查询数覆盖空证据/40条引用、单/10 runs与多批次，全部SQL是SELECT，不自动刷新认证heartbeat或读取凭据/lease。签名下载及篡改拒绝只使用本地模拟站，签名失败明确503。数据质量只测试NOT_IMPLEMENTED/null合同，不宣称指标或分析已完成。实际门禁和限制见[GEO-306实施记录](../../../.trellis/tasks/10-02-geo-306-read-model/implement.md)。

## GEO-307 / R2 前端验证边界

组件测试覆盖 URL/query owner、服务端动作、轮询停止、错误/权限、dirty、canonical 保存、409 输入保留、未知提交同键恢复、主体切换与迟到响应、截图真实摘要/传输/校验/放弃、不可变原文安全展示及过期签名恢复。文件恢复必须覆盖 VERIFIED/FAILED/ABORTED 已提交而回执丢失，不能用 mock 把 complete/abort 伪装成幂等成功。

`runs-real-stack.spec.ts` 由隔离真实栈入口注册：准备现有配置后，UI 创建三次人工采样批次，保存并刷新恢复草稿和筛选，上传本地 PNG、编辑重复引用位置、正式提交和检查证据/hash/时间线，验证完整批次 collected 与 pending_manual_count。测试不连接真实 AI；完整门禁、首次诊断和实际限制记录在 [GEO-307 实施证据](../../../.trellis/tasks/10-02-geo-307-run-center/implement.md)。


## GEO-308 / R2 收口验收边界

新增 `test_geo_manual_races.py` 使用真实 PostgreSQL 锁等待，确定取消存储 writer / manual-submit、草稿 revision / submit 的两个先后顺序。`test_geo_r2_immutability.py` 在正式提交之后，用新事务攻击冻结聚合并验证整笔 rollback、精确 SQLSTATE/constraint、全行事实相等和原幂等回执。取消 writer 仅测试已有策略及存储，不代表 HTTP/UI 取消已实现。

既有 `runs-real-stack.spec.ts` 继续证明三次人工采样，并使用 Router 解析后的 URL 状态验收数字形式搜索词，`geo-real-stack.spec.ts` 补充新旧导航、旧筛选书签/历史详情刷新及实际上传对象字节/hash，保留文章更正、工作台指标和优化任务来源验收。`surfaces-real-stack.spec.ts` 使用自己的工程师账号，消除共享 seed 改密污染，保持真实首次改密、CSRF 和只读权限。`questions-real-stack.spec.ts` 的手工导航使用 Router 序列化，固定数值搜索词，避免科学计数法字符串被解析为number后丢失筛选。完整 R2 边界及门禁结果见 [R2 验收](../04-delivery/07-r2-acceptance.md) 与 [实施记录](../../../.trellis/tasks/10-02-geo-308-r2-acceptance/implement.md)；不把 COLLECTED 宣称为分析/复核完成。

## GEO-401 / R3 抽象合同验证边界

`backend/tests/unit/test_geo_collector_contract.py` 离线验证冻结 DTO 到独立不可变值对象的
转换、三模式闭合配置、原文/unknown/partial usage、金额精度、引用安全及实际位置、闭合
摘要、错误必填发送状态/阶段组合、发送后禁止 SAFE_BEFORE_SEND、429 仅新 attempt 元数据，
以及 Protocol 的必填发送回调和 Collector 无 ORM/事务依赖。复用 Registry/Run/Answer 基线。
这是抽象协议和值对象单元验证，不证明真实 provider 的字节发送次数、网络防线、Worker
发送隔离、截图裁剪或 raw bytes 脱敏；这些分别由 GEO-402/404/405/406 与 Browser 任务验证。
没有新增 HTTP、持久化写入或页面旅程，因此不增加数据库迁移或 E2E 用例。指定门禁与
实际独立复核证据见 [实施记录](../../../.trellis/tasks/10-03-geo-401-collector-contract/implement.md)。


## GEO-402 / R3 本地合同套件验证边界

独立 TCP fake provider 覆盖成功/重复原始引用、三态搜索、partial usage/cost，以及
429、Header/正文超时、接收请求后断连、307、Content-Length/chunked 超限、非法 JSON/
结构/空白回答和 401/403/503。每 attempt 计数和正文 SHA256 由真实接收记录生成，
并发重复请求全部保留；发送授权拒绝零请求，显式新 UUID 独立计数。

套件同时自测正常测试驱动和故意重试/跟随 redirect/泄漏异常的反例，不能以 fake 去重
掩盖违规。实际响应携带的测试 canary 不进入结果、统计、错误、日志或 JSON 产物；
CI 入口先扫描再输出，扫描失败非零且不打印值。网络守卫拒绝非回环 DNS/TCP。
`make test-geo-collector-contract` 可独立运行，部署脚本门禁和已有 CI unit 均接入。
完整协议见 [测试说明](../../../backend/tests/fixtures/geo_provider/README.md)，
逐项结果与环境缺口见 [实施证据](../../../.trellis/tasks/10-03-geo-402-fake-provider/implement.md)。

此处不证明尚未实现的生产 adapter、TLS、Profile 管理测试、业务审计、Worker lease/
重复消息/发送隔离/迟到结果，也不实现 Browser、分析或指标。

### GEO-404：真实 API Collector 合同与安全金标

`make test-geo-collector-contract` 已纳入真实 `OpenAICompatibleGeoCollector`，复用 GEO-402
独立合同断言和本地 fake provider，而非用生产解析器生成期望值。新增用例为
`test_geo_openai_collector.py`、`test_geo_openai_response.py`、`test_geo_openai_network.py`。
覆盖原问题请求哈希、原文保留、实际引用位置、null/部分元数据、费用精度、稳定错误矩阵、
每 attempt 单次调用、发送回调拒绝、无重定向、SSRF/peer 和各种响应定界大小限制。
JSON 金标包括非法 encoding、重复键、NaN、深层嵌套、截断、空/NUL/超长回答及非法
usage/cost/引用。Profile/模型参数覆盖测试通过实际发送 bytes 检查无额外指令。

真实 TLS 金标使用临时本地 CA、真实 socket 和回环 fake provider，验证受信 CA、
SNI/Host，以及不受信 CA/错误主机名在回调和 HTTP 首字节前失败。测试专用 connector 将
已批准公网 sockaddr 路由至本地 listener，不改变生产 TLS/SSRF 校验。所有测试应用
仅允许回环连接的网络 guard；CI 输出和临时产物在打印前扫描凭据 canary。

此验证只证明同步 Collector/传输边界；不证明未来 Worker 的数据库 SENT、lease、
重复消息、迟到结果或外部平台可用性，也不构成真实平台采集批准。实际命令、结果和
未运行检查见 [GEO-404 实施证据](../../../.trellis/tasks/10-03-geo-404-openai-collector/implement.md)。

### GEO-408：自动采集真实栈纵向验收

根 `make e2e` 纳入独立的 GEO 三阶段入口：正常采集、关闭 API、关闭总开关。
真实 production preview 操作管理、Profile 诊断、计划和批次 UI，调用已有 API/PG/Celery；
严格虚构输入、进程内批准/报价及确切 loopback 地址只由 test assembly 提供，生产门禁不变。
按真实 Run UUID 计数，覆盖轮询、原文/重复引用、独立 usage/null、费用/失败覆盖、429、
接收后断连、显式后继和旧终态保留，以及分类/预算/两个开关的外发前零调用。
重复消息通过真实稳定 ID 再投递和 Worker 完成回执验收，不使用 fake 去重或 SQL 改状态。
所有阶段复用 secret canary 扫描及独占资源精确清理；没有真实供应商普通测试。
测试装配、安全停止及演示映射见 [R3 验收指南](../04-delivery/08-r3-api-acceptance.md)，
实际结果、环境和残留限制见 [GEO-408 实施记录](../../../.trellis/tasks/10-03-geo-408-api-acceptance/implement.md)。


### GEO-506：Analysis Worker 与 revision 生命周期

真实隔离PostgreSQL/Redis/Celery测试覆盖UUID消息、重复/并发创建和claim、四段规则normalized结果、
review reasons、首轮Run/Batch推进、同hash复用、失败显式新revision、管理员/改密/开关边界。
计算、子结果插入、pointer发布、commit四个故障位置验证整批结果回滚与答案/引用保留；
错误日志只保留ID/类型，原始异常canary不泄露。expired/token不符在扫描前拒绝，恢复后旧token拒绝；
晚到较旧成功不倒退pointer，重分析失败/过期不修改采集终态或旧current。

直接SQL负例覆盖跨答案引用、Subject越界、未完成分类、缺分类成功、lease非原子释放、
只终结revision但留下ANALYZING Run，以及Job/分类历史UPDATE/DELETE。事实退休后仍使用原绑定。
独立只读复核关注持久化和并发，具体发现与修正、精确命令及全部门禁结果见
[GEO-506实施证据](../../../.trellis/tasks/10-03-geo-506-analysis-worker/implement.md)。
无HTTP/frontend旅程变更，不运行无关Browser矩阵或真实外部AI；公共复核和指标质量门禁由后续任务交付。


## GEO-707 / R6 机会闭环验收边界

`test_geo_opportunity_loop.py` 使用真实 PG、计划/行动/复测/决策 HTTP 和实际确定性分析/规则。集成层仅准备虚构采集事实及批准内容夹具，ContentTask 完成由既有发布领域服务产生，不直接写完成/解决状态。真实栈 `geo-loop-real-stack.spec.ts` 覆盖人工证据提交、分析 Worker、机会认领、内容人工稿/审核/发布核验、复测与显式恢复解决及审计工作台。没有创建页面的行动和 RETEST 使用公共 API 编排；本任务不增加这些页面。

独立 E2E evaluator 辅助入口仅接受 test、当前随机数据库 owner token 匹配与 GEO707 虚构运行；它调用实际机会应用服务，不插入机会或伪造恢复。trace/video 关闭；取消只允许已登记阶段的精确只读请求，文件 PUT 仅在同一具体文件路径确实返回204后接受 Chromium 空响应结束事件，十个文件仍逐一验证 VERIFIED、字节数和SHA-256。凭据和敏感正文不进入审计或交付证据。实际测试/脱敏状态、完整门禁缺口与环境阻断见 [R6 机会闭环验收](../04-delivery/10-r6-opportunity-acceptance.md)，不可把分段检查或失败门禁写成全部通过。

canonical 隔离 test 栈将 GEO_RECOVERY_SCAN_SECONDS 设为 5 秒，使用真实 Beat/Worker 推进人工采集；生产默认 60 秒和其他 lease/重试边界不变。十次串行观测不应每次等待生产扫描周期；该设置不跳过资格、分析、复核或状态裁决。
