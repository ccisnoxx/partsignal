# PartSignal 测试策略

## 层级

- 后端单元测试覆盖状态机、账号类型、凭据加密、SSRF/Header 边界、严格模型响应、快照、生成质量规则、指标和文件校验。
- 后端集成测试使用 PostgreSQL 和 Redis，不使用 SQLite 替代数据库约束。
- 前端使用 Vitest 和 Testing Library 覆盖表单、权限、错误和状态交互。
- Playwright 覆盖批准事实到发布登记、GEO 观测、GEO 分析洞察和 AI 渠道管理主流程，并通过 Redis、真实 Celery Worker 与本机 OpenAI-compatible HTTP 替身执行生成。AI 渠道页面在 1572×999 桌面视口保存三栏验收产物，覆盖创建/编辑、换 Key、Header、模型发现、成功与失败测试、启停、筛选排序分页、统计审计、复制脱敏和删除；GEO 主流程在 1582×995 保存观测列表、详情和分析洞察产物，洞察还覆盖筛选折叠、趋势 Tooltip 与携带同一筛选的打印视图。不得用 `page.route` 固定响应替代真实 API。
- 契约检查比较提交 OpenAPI、FastAPI 运行时 Schema 和前端生成类型。
- 结构重构还需比较 ORM metadata 表集合、mapper 数、Alembic head、迁移历史和生产 preflight 输出，证明物理移动未改变数据库语义。

## 命令

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make e2e
make build
make verify
```

测试替身必须显式配置。确定性生成器不得补充输入事实中不存在的参数，fake OpenAI-compatible 服务必须走固定目的地址 HTTP 传输、固定路径和严格响应解析；本地 CA/HTTPS 测试必须验证 SNI、Host、证书 hostname、peer 越界零发送、重定向和响应上限。开发对象存储必须实际保存上传字节并执行 HEAD 元数据校验。

AI 渠道管理测试必须区分协议和品牌：当前所有受控品牌都只允许登记 OpenAI-compatible 协议，品牌不能改变请求路径。PostgreSQL 集成测试覆盖旧渠道回填 `CUSTOM`、品牌—协议组合校验、服务端列表与分类数量、最近测试、正式业务作业统计和渠道审计；API Key 与敏感 Header 必须在响应、审计、复制结果、React Query mutation state、浏览器存储和截图中均不可恢复。连接测试发送后不自动重试，成功或失败都使具体模型保持停用并由管理员显式重新启用。

自然化测试不得使用原文直返或固定“成功”适配器绕过供应商边界。PostgreSQL 集成测试必须让原始生成和自然化都经过本机 OpenAI-compatible HTTP 替身，断言每个作业至多一次调用、源版本不变、新版本 `source_job_id/based_on_id` 正确、成功结果可再次自然化、重复消息不重复落库，以及调用期间源资格失效时迟到结果不能提交。迁移测试还需覆盖 Prompt 初始空表、历史 `GENERATE` 回填、类型/来源成对检查、同源活动部分唯一索引和存在 `HUMANIZE` 历史后的禁止降级。

本地 E2E 对象存储替身默认监听专用端口 `19009`，可通过 `PARTSIGNAL_E2E_STORAGE_PORT` 覆盖；API 与浏览器上传地址必须使用同一端口，避免复用代理工具常见的 `9000` 端口。

前端组件测试覆盖管理员首次保存/按 revision 更新自然化 Prompt、未配置提示、版本资格、模型选择、活动作业禁用、原快照重试和审核完整 AI 追溯。Playwright 主流程应通过 UI 完成首次配置、原始生成、自然化、新版本比较和审核；不使用 `page.request`、eager 模式或 AIGC 检测器代替被验收步骤。

第三方模型测试数据必须显式标记完整生成输入为 `PUBLIC`，且绑定事实快照中的每条 Evidence 都是 `PUBLIC`。迁移测试必须证明历史任务仍为未分级，创建、重试和 Worker 防御校验必须覆盖 `AI_DATA_CLASSIFICATION_FORBIDDEN`，不得在 fixture 中用默认值绕过门禁。

阶段二 PostgreSQL 集成测试必须同时覆盖 API 与数据库平台一致性、同平台不同账号、任务取消在途门禁、两条发布并发验证只完成任务一次、重复验证拒绝、并发发布失效唯一待办、修复上下文固定与候选复核、显式解决以及 `0013` 前滚策略。数据库反例还必须证明待办不能直接以 `RESOLVED` 插入或删除。审核测试覆盖事实/内容提交、退回、重新提交、批准的追加式历史，事实与内容的空退回意见、冻结事实证据、版本差异和阻断质量问题。前端组件测试消费生成类型，验证匹配账号、服务端 `available_actions`、冻结审核上下文、显式批准和非空异常处置；不得用页面本地状态机替代服务端。

上线门禁测试在 `0012` 历史 Schema 上运行 `python -m app.cli preflight-integrity`，断言稳定 ID、原因码和非零退出；随后证明 `0013` 迁移本身同样阻断，且不产生部分表或版本前进。合法历史必须按追加式 `VERIFIED` 状态事件识别：发布后来移除时任务仍可保持完成；已显式进入拒绝、移除或验证失败的旧错绑保留历史但不再阻断。

`make e2e` 需要本机已有 PostgreSQL、Redis 和 Playwright Chromium；CI 使用服务容器执行同一脚本。使用开发 Compose 基础设施时先执行 `make dev-infra`，再显式传入宿主机连接：

```bash
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 make e2e
```

真实 OSS、真实模型和生产网络不属于普通测试门禁。可选真实模型 smoke test 必须使用专用低权限 Key，缺少 Key 时明确跳过，不能把固定成功替身表述为真实云端成功。

行为保持重构必须先运行基线，再按独立切片执行定向回归，最终运行完整契约、lint、typecheck、单元、PostgreSQL 集成、前端组件、构建和 Playwright 流。最终差异审计还要确认 Router 不含事务或实体写入、Schema 与 ORM 调用方均直接导入权威领域模块、React Query 键没有页面内第二来源，并确认迁移和公共契约相对重构前无新增差异。
