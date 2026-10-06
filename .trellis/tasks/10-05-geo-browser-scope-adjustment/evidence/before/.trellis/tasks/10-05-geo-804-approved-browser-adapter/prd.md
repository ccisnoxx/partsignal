# GEO-804 Task Brief：第一个合规批准的真实界面 Adapter

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID | GEO-804 |
| 发布增量 | R7 |
| 负责人 | 主代理 |
| 当前分支 | geo/GEO-804（进入任务时已经存在，未创建或切换） |
| 依赖 | GEO-802、GEO-803；manifest 均为 done，2026-10-05 人工接受记录齐全 |
| 状态 | blocked；依赖门禁满足，平台批准及 staging smoke 输入缺失，未开始实施 |
| PR/Commit | 无；未提交、推送、部署或发布 |

## 2. 目标

仅针对一个经合规批准的真实 AI 产品界面，实现 temporary chat、单次 submit、稳定等待、原始回答与引用提取、版本元数据。DOM 不确定、答案未稳定或为空必须失败；批准频率限制必须生效。真实 smoke 只能在已获人工授权的受控 staging 执行。

## 3. 关联需求

WBS GEO-804 完整任务行；PRD §6.3、§11.3、§14.3/14.4，AC-RUN-01/02/03、AC-SEC-02/03；状态机 §7；Worker/Collector §12、§16/17；安全 §3、§6、§14；测试 §5.2；运维 §12；Accepted ADR-002、ADR-003、ADR-005（包含 GEO-002 已接受修订）。

## 4. 必读与已核对资料

- 根 AGENTS.md、backend/AGENTS.md、.trellis/workflow.md；backend/infra/guides spec 索引及相关 CI、本地测试和错误合同。browser-collector 与 tests/browser-fixture 无子级 AGENTS.md。
- docs/geo-monitoring/README.md。
- delivery 01-implementation-roadmap、02-work-breakdown-structure、04-codex-execution-guide、05-task-template、task-manifest.yaml。
- product 01-product-vision-and-scope、02-geo-core-prd。
- business 02-domain-model、03-workflows-and-state-machines。
- technical 01-technical-architecture、05-worker-and-collector-architecture、06-security-and-compliance、07-testing-and-quality、08-deployment-and-operations。
- ADR-002-unified-observation-run-model、ADR-003-separate-collection-analysis-review、ADR-005-staged-collector-rollout。
- GEO-801/802/803 的 Task Brief、设计（存在时）、实施/接受记录；当前 OpenAPI 的 Browser Profile/settings、冻结输入、Answer/Citation、错误目录、会话组件及访问边界；database 对应章节与 0063 revision/SQL。
- browser-collector/src/service.mjs、main.mjs、session.mjs；参考 Adapter、可复用合同、现有单元；tests/browser-fixture/README.md；backend Registry、资格、geo_runs、geo_collection_admission 与会话 access；Browser Compose/overlay 与 Makefile。

用户补充授权检查 .env 相关配置；检查结果只保留非敏感派生信息，不保存配置正文、凭据或其哈希。

## 5. 当前行为

- GEO-804 开始时为 planned；GEO-802/803 均为 done，依赖不是阻断原因。
- Browser 生产入口仅离线 Chromium 健康、STOP/开关和稳定 UUID 拒绝；启用时仍返回 BROWSER_ADAPTER_NOT_IMPLEMENTED，不读取业务输入或消费队列。
- browser-session Registry 项零采集能力、approved=false、connection_test_supported=false；不能启用采集或产生 PASSED。
- 会话加密引用、人工导入/撤销及专用服务身份访问已实现；AVAILABLE 只证明密文/期限，不证明平台登录、条款批准或 Run SEND 权限。
- GEO-803 参考 Adapter 全部在 tests，具备本地临时会话、流式/晚到引用/稳定等待和失败合同；不进入生产镜像 src 或 Registry，不证明真实平台 DOM。
- 普通 geo_runs Worker 对非 API 冻结模式提前返回。预算/限速 owner 当前解析 GeoApiSettings，Browser settings 没有并发或分钟配额字段。
- .env/.env.staging/.env.production 未配置 GEO Browser 平台、批准、账号或频率。模板四项 GEO 开关默认 false；生产 AI JSON 指向 DeepSeek API 的 HTTPS 端点，不是 BROWSER 平台批准记录。
- 仓库工作区有大量前序未提交修改；本任务不以整个 HEAD diff 作为 GEO-804 增量。

## 6. 目标行为

批准平台明确后，严格使用平台特定 DOM 合同完成临时聊天与唯一业务提交；联合完成信号、loading 消失和正文/引用/元数据稳定检测，设置有界超时。仅保存可证明的原文、实际引用位置与元数据，未知值为 null。输入/结果跨语言边界复用当前 Collector 权威类型。

运行必须具备当前配置/账号/会话与发送授权；频率和并发在权威服务端裁决，不仅在 Adapter 进程内计数。单 attempt 不自动重发，挑战/访问控制立即停止；每次隔离 Context 并在 finally 关闭。证据文件提交仍由 GEO-805 完成。

## 7. 范围内

- [ ] 一个经合规批准的平台专用 Adapter。
- [ ] temporary chat、submit、stable wait、answer/citation extraction、version metadata。
- [ ] 本任务必需的运行资格、发送授权、批准频率限制及本地合同测试。
- [ ] 获授权的受控 staging smoke 与证据。
- [x] 门禁/实现差异核对、Task Brief、基线测试和可恢复证据。

## 8. 范围外

GEO-805 截图、敏感裁剪、安全 DOM 摘要/对象存储与 AnswerSnapshot 文件提交；GEO-806 全套健康/频率/开关管理 UI；GEO-807 小规模完整试点。其他真实平台、账号登录自动化、验证码/反自动化绕过、生产启用、指标或状态机修改、历史迁移、无关重构、依赖大版本升级均不在范围内。

## 9. 不变量

PostgreSQL 是唯一业务状态来源；Redis 只传稳定 ID；事务、锁、revision、状态和业务授权由 Application Service 持有。Collector 不接 ORM、不提交事务、不生成指标。冻结输入/原始证据/终态与追加尝试历史不改写。未批准平台不能自动采集；配置或 API 凭据存在不等于 BROWSER 批准；秘密不进入结果、日志、任务证据或普通 OSS。

## 10. 契约变化

当前 OpenAPI、数据库合同、generated 类型均无改动。当前源码 head 为 0063_geo_browser_sessions；未进行 live Alembic current 查询或前滚。

Browser 配额在现有 settings 中未建模；批准参数确定后才决定是否需要加法 OpenAPI/database/Schema/Alembic 变更。不预设新 revision，不将现有 API 默认配额当作已批准 Browser 配额，不修改 frozen migration 或历史输入。

## 11. 后端与 Collector 设计约束

- 当前没有新 Router、Application Service、read model 或 Worker 实现。
- Adapter 与 Registry 的平台身份/能力需精确匹配，不从 provider_brand/API URL 猜测；不建立通用跨平台 fallback。
- 会话访问沿用 User→Surface→Profile→Session 的当前边界。既有 API 执行沿用配置→accounting advisory lock→Batch→Run，结果从 accounting→Batch→Run；Browser 最终锁序须在其设计中明确，当前不变更这些协议。
- 发送前重验当前 lease/token/期限、revision、合规/会话/开关、外发分级与配额，再原子持久化 SENT。外部 I/O 不持有数据库事务。
- NOT_STARTED 恢复需证明旧 token 已撤销；SENT/UNKNOWN 不自动重发；显式新 attempt 保留原失败。迟到结果不能覆盖终态。
- selector 歧义、空答案、截断、超时、挑战和登录失效使用当前闭合错误/发送状态；未观察到的 HTTP/费用/搜索/版本不猜测。

## 12. 前端

无路由、search params、query key、页面、缓存或 generated 类型变化。若后续批准输入要求新增公开参数，仍先更新 OpenAPI 并生成类型；不在前端建立状态机或配额权威。本任务不提前实现 GEO-806 UI。

## 13. 测试计划与基线

- 已运行现有本地 Playwright Adapter 合同，验证流式暂停、晚到引用、登录/selector/挑战失败、空答案/超时、真实单次 POST、授权拒绝和敏感输出隔离。
- 已运行 backend Browser/会话/Registry/Collector 定向单元基线及 make contract-check。
- 最终运行 git diff --check；状态/证据变更另用任务前文件哈希、manifest 解析和 task-only diff 校验归属。
- Adapter 实施后必须复用本地合同，并用实际 DOM 支撑平台 selector；批准频率和发送边界若发生修改，增加能直接验证持久化/并发授权的定向测试和必要独立只读复核。
- staging smoke 尚缺授权、批准平台/账号/环境和入口，不执行；本地替身成功不替代 smoke。

## 14. 验收标准

1. 已批准唯一平台的临时聊天、单次提交、原文/引用/版本提取可用。
2. DOM 不确定、答案未稳定或为空时失败，不提交空成功。
3. 批准频率/并发限制生效；未授权、过期、撤销、挑战和开关关闭均不获新发送许可。
4. CI 仅本地模拟站；本地合同及授权 staging smoke 有实际证据。
5. 完成实施及本地验证后只进入 review，不自行标 done。

## 15. 精确验证命令

```bash
make test-geo-browser-contract
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_browser_boundary.py backend/tests/unit/test_geo_collector_contract.py backend/tests/unit/test_geo_collector_suite.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_browser_storage_state.py backend/tests/unit/test_geo_browser_session_vault.py -q
make contract-check
git diff --check
```

命令、exit code 和完整日志保存于 evidence；未执行命令不标通过。

## 16. 数据与上线

未新增迁移/回填，未更改 .env、平台配置、会话材料、STOP、network none 或采集开关。未访问真实 AI、staging 或 production，未操作 live 业务数据。恢复当前任务仅需补齐批准输入后继续，不撤销前序任务改动。

## 17. 风险与开放问题

| 缺失输入 | 影响与处理 |
|---|---|
| 唯一平台/真实界面域名及可定位批准记录 | 不能选择平台、批准 Registry 或设计真实 DOM 合同；不以 DeepSeek API 配置替代 |
| 专用账号非敏感标识、负责人、用途、环境/地区、速率/并发、保留及停止规则 | 不能冻结运行与网络批准范围；不接触密码/Cookie/私钥正文 |
| 受控 staging smoke 人工授权及入口 | 不能执行必需的真实验收；不以本地/CI 测试冒充 |

这些缺口符合用户明确的“完成本任务必需的外部输入或人工授权缺失”停止条件。ADR 接受与前序任务 done 不授权具体平台。其他四类停止条件未发现成立证据。文件配置不证明当前运行环境或批准状态。

## 18. 证据与交付状态

evidence/baseline-sha256.json 保存 39 个非敏感维护文件的起始摘要；initial-status.txt 记录原工作树；基线命令日志与 JSON 保存真实结果。完整 preflight 和阻断处理更新 implement.md。没有 Adapter 完成证据，不进入 review/done；状态变化只作用于 GEO-804。

## 19. 后续任务

恢复 GEO-804 需要上述批准输入和 smoke 信息。GEO-805/806/807 仍为后续任务，本次不实现；blocked 不是完成、接受或发布。
