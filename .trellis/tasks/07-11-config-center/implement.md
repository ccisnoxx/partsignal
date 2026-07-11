# 配置中心与 AI 生成策略执行计划

## 1. Contract First

- [ ] 更新 `contracts/database.md`：账号类型、平台类型/Prompt、AI 渠道/Header/模型、任务草稿、作业快照、指标和删除规则。
- [ ] 更新 `contracts/openapi.yaml`：用户管理、改密、平台类型/Prompt、AI 配置、模型发现/测试、生成选项、任务 Prompt 和作业追溯。
- [ ] 明确错误码：配置不存在/未测试/未启用、Prompt 缺失、URL 禁止、解密失败、外部超时、严格响应解析失败、最后管理员保护。
- [ ] 生成前端 OpenAPI 类型并先通过契约语义检查。

## 2. Database And Runtime Models

- [ ] 新增迁移，把现有六角色映射为 `ADMIN` / `ENGINEER`，增加强制改密字段并移除角色关联表。
- [ ] 新增平台类型、当前 Prompt、AI 渠道、渠道 Header、模型配置表及约束。
- [ ] 为平台、内容任务和生成作业增加类型、Prompt、模型、输入快照与调用指标字段。
- [ ] 删除内容版本的模型自报事实/证据/披露 ID 字段，保持旧迁移冻结不变。
- [ ] 增加数据库约束和删除行为：类型引用限制、Prompt 级联、渠道模型级联、作业配置外键 `SET NULL`、历史用户 `RESTRICT`。
- [ ] 更新 SQLAlchemy 模型、Pydantic Schema 和迁移回归测试。

## 3. Identity And Authorization

- [ ] 用账号类型替换六角色依赖，集中实现 `ADMIN` 与 `ENGINEER` 权限检查，管理员继承工程师能力。
- [ ] 更新用户创建、更新、停用/启用、密码重置和自助改密接口。
- [ ] 实现临时密码会话门禁、重置后会话撤销和最后管理员事务保护。
- [ ] 删除事实与内容审批的创建者不同校验，保留其他状态、证据、质量和审计规则。
- [ ] 更新初始化 CLI，使开发环境创建明确的管理员账号，不再生成六个职责分离账号。

## 4. Platform Configuration

- [ ] 实现平台类型 CRUD、引用保护和旧平台显式归类。
- [ ] 实现每类型唯一 Prompt 的读取、原地保存和物理删除，使用修订号避免并发覆盖。
- [ ] 扩展具体平台创建/更新契约，要求新平台选择类型。
- [ ] 内容任务创建时冻结平台类型快照；未归类旧平台和旧任务生成显式失败。

## 5. Credential And Network Boundary

- [ ] 增加凭据加密依赖与 `CredentialCipher`，从环境读取主密钥并实现关联数据、解密失败和脱敏测试。
- [ ] 实现渠道 API Key 与普通/敏感 Header 的写入、替换、读取投影和审计脱敏。
- [ ] 实现 URL 规范化、公网 HTTPS 校验、DNS 地址检查、禁止重定向和开发本机 HTTP 例外。
- [ ] 实现保留 Header、Header 注入、自定义参数保留键和 JSON 值校验。

## 6. AI Configuration And Testing

- [ ] 实现渠道 CRUD、启停、物理删除和 10–600 秒超时。
- [ ] 实现 `/models` 获取与手工 `model_id` 添加，不自动落库或猜测模型。
- [ ] 实现模型 CRUD、自定义参数、测试状态失效、启停和物理删除。
- [ ] 实现固定非业务模型测试，复用正式严格解析器，不创建业务作业或内容。
- [ ] 验证渠道启用至少需要一个测试通过模型，模型启用必须自身测试通过。

## 7. Real Generation

- [ ] 增加任务级 `user_prompt` 保存接口和乐观锁。
- [ ] 实现生成选项接口，返回只读平台 Prompt 和可用模型，不泄露管理字段。
- [ ] 以一个版本化固定契约构造最终 system message，以白名单字段构造 user message。
- [ ] 在创建作业事务中冻结完整非敏感快照和配置引用，只把 UUID 投递 Celery。
- [ ] 实现 `OpenAICompatibleClient` 的模型列表和非流式 Chat Completions，统一 Header、超时、一次调用和脱敏错误。
- [ ] 实现严格四字段 JSON 解析与 `extra=forbid` 校验，删除模型自报事实 ID 流程。
- [ ] 调整数字来源、必要披露、平台规则和人工审核提示；明确不做自由文本语义冲突判断。
- [ ] 保存供应商请求 ID、耗时和可空 token 用量，创建一个 `DRAFT ContentVersion`。
- [ ] 调整重试：复制原快照，只读取当前凭据；配置已删除时拒绝，不读取最新 Prompt 或任务草稿。

## 8. Frontend

- [ ] 将现有设置页拆分为管理员 `用户管理` 与 `配置中心` 路由，更新主导航和路由保护。
- [ ] 实现用户新增、账号类型、停用/启用、临时密码重置和自助改密流程。
- [ ] 实现 AI 渠道详情、Header 管理、获取模型、手工模型、自定义 JSON 参数、模型测试和启停交互。
- [ ] 实现平台类型管理和单一 Markdown Prompt 编辑器，扩展具体平台归类界面。
- [ ] 扩展内容任务页：保存 `user_prompt`、只读 Prompt、模型选择、生成和作业指标/快照详情。
- [ ] 更新内容追溯页，移除模型自报 ID，展示事实版本和生成作业快照。

## 9. Documentation And Configuration

- [ ] 更新 `.env.example`、Compose 与部署文档，说明凭据主密钥、生产 URL 限制和开发本机 HTTP 例外。
- [ ] 更新 README、架构/测试/部署文档及父 MVP 规划，移除“真实 LLM 范围外”“六角色职责分离”“禁止自审”等过时描述。
- [ ] 对新增和实质修改的 Python 模块、公共服务、异常路径、日志和开发者输出执行中文文档检查。

## 10. Validation

优先执行目标测试，再执行完整门禁：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_migrations.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend
UV_CACHE_DIR=.cache/uv uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run test
npm --prefix frontend run lint
npm --prefix frontend run typecheck
make contract-check
make test-integration
make build
make e2e
```

新增测试至少覆盖：

- [ ] 凭据加密、永不回显、日志/审计脱敏和错误主密钥。
- [ ] SSRF 地址、重定向、DNS 解析、Header 注入和保留字段。
- [ ] 模型发现失败后的手工配置、测试门禁和配置变化失效。
- [ ] 严格 JSON 成功及代码块、附加文本、额外/缺失字段失败。
- [ ] Prompt 覆盖/删除、渠道/模型删除与历史快照、重试语义。
- [ ] 任务 Prompt 并发修改、事实附加、数字来源和必要披露。
- [ ] `ADMIN` / `ENGINEER` 权限、最后管理员、停用会话、临时密码和自审。
- [ ] OpenAPI 运行时语义一致、前端生成类型无漂移和完整浏览器流程。

## 11. Risk And Rollback Points

- 身份迁移、内容追溯字段删除和真实模型接入不可拆成带兼容分支的长期双轨；每阶段合入前必须保证契约、迁移和调用方同时更新。
- 凭据主密钥丢失无法恢复数据库密文，部署前必须备份并验证恢复流程。
- 真实模型测试和端到端测试使用专用低权限测试 Key；无真实 Key 时必须明确跳过外部集成测试，不能用固定成功替身冒充。
- 回滚应用前先停用全部渠道。数据库回滚只在备份完成且确认不会丢失需保留的新作业时执行。
