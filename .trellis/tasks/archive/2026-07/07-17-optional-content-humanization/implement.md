# 可选文章自然化修订实施计划

## 1. 开始条件

- [x] 用户评审并批准 `prd.md`、`design.md` 和本文件。
- [x] 运行 `python3 ./.trellis/scripts/task.py start 07-17-optional-content-humanization`，任务进入 `in_progress` 后再修改业务代码。
- [x] 加载 `trellis-before-dev`，完整读取 `.trellis/spec/backend/index.md`、AI 配置/数据库规范及相关 frontend 规范。
- [x] 记录 `git status --short --branch`；保留当前用户的 `AGENTS.md` 与 `.agents/skills/playwright-cli/` 变更，不覆盖、不纳入本任务提交。
- [x] 确认主工作目录仍位于 `main`。如工作区不干净，不执行 `git pull`，仅在现有状态上隔离本任务文件。

本任务使用 Codex inline 模式，跳过 `implement.jsonl` / `check.jsonl` 派发清单；主会话直接实施和检查。

## 2. 契约与数据库设计先行

- [x] 更新 `contracts/openapi.yaml`：
  - `GET/PUT /api/v1/content-humanization-prompt`
  - `POST /api/v1/content-versions/{content_version_id}/humanization-jobs`
  - `HumanizationPromptPut` / `HumanizationPrompt`
  - `GenerationJob.job_type` / `source_content_version_id`
  - `HumanizationSnapshot`、`HumanizationTrace`
  - `GenerationJobDetail.input_snapshot` 严格 `oneOf`
  - `GenerationOptions.humanization_prompt_configured`
  - `ContentReviewContext.humanization_traces`
- [x] 更新 `contracts/database.md`，写明单例 Prompt、`GENERATE/HUMANIZE` 成对约束、活动作业部分唯一索引、内容版本关系、PUBLIC 门禁和有数据后的禁止 downgrade。
- [x] 更新 `docs/architecture.md`，明确只有一套 AI 作业状态机和自然化版本链。
- [x] 在写代码前逐项核对契约字段、nullable、错误状态和权限，禁止后端自行增加兼容字段。

回滚点：公共契约尚未被实现前，只撤销本任务新写的契约草案；不得修改历史迁移或生成类型来掩盖契约不一致。

## 3. 迁移与 ORM

- [x] 新增 `backend/alembic/versions/0017_content_humanization.py`：
  - 创建空的 `content_humanization_prompts` 单例表。
  - 增加并回填 `generation_jobs.job_type='GENERATE'`，随后移除默认。
  - 增加 `source_content_version_id`、外键、类型/来源成对检查和活动自然化部分唯一索引。
  - downgrade 在存在 `HUMANIZE` 作业时显式拒绝；无历史作业时删除新增结构。
- [x] 更新 `backend/app/models/configuration.py` 和 `backend/app/models/ai_generation.py`；在 `backend/app/models/__init__.py` 维持 mapper 注册。
- [x] 不修改 `backend/app/migration_schema_v1.py`、`0001`–`0016` 或内容不可变触发器。
- [x] 更新 `backend/tests/integration/test_migrations.py`：
  - fresh -> head 无 Prompt 行
  - `0016 -> 0017` 历史作业全部为 `GENERATE`
  - 成对约束、外键、部分唯一索引反例
  - 无自然化历史可 downgrade
  - 已有自然化作业拒绝 downgrade 且版本号不前进/结构不部分删除

定向验证：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_migrations.py -q
```

## 4. Prompt 配置闭环

- [x] 在 `backend/app/schemas/configuration.py` 增加严格 Prompt 请求/响应 Schema。
- [x] 在 `backend/app/services/platform_configuration.py` 增加单例 Prompt 首次创建和乐观锁更新；空白、错误 revision 和重复首次创建显式失败。
- [x] 在 `backend/app/routers/configuration.py` 增加管理员 GET/PUT，只做参数、权限和投影映射。
- [x] 审计动作使用稳定名称，例如 `content_humanization_prompt.saved`，只记录 revision，不记录正文。
- [x] 增加配置 API 集成测试：未配置 404、非管理员 403、首次创建、更新、并发冲突、空白拒绝、审计不含 Prompt。

回滚点：配置功能独立于作业激活；迁移后仍无 Prompt 行时自然化保持关闭。

## 5. 快照、作业创建与版本链

- [x] 在 `backend/app/schemas/content.py` 增加 `HumanizationSnapshot`、源内容快照、作业类型和审核追溯 Schema；按 `job_type` 严格解析，禁止候选字段 fallback。
- [x] 提取一个聚焦的 AI 内容链解析函数，唯一负责沿 `based_on_id/source_job_id` 返回最初 `GenerationSnapshot` 和全部 `HumanizationSnapshot`；供人工修订质量检查、自然化创建和审核读取复用。
- [x] 在 `backend/app/services/content_production.py`：
  - 让原生成作业显式写入 `job_type='GENERATE'`。
  - 增加 `create_humanization_job`，按 `ContentTask -> ContentVersion` 顺序加锁并验证来源。
  - 验证全局 Prompt、用户所选模型、当前和原始冻结 PUBLIC 条件。
  - 冻结源正文/哈希、Prompt revision、原生成事实、模型渠道和最终消息。
  - 幂等复核包含 job type、源版本和模型。
  - 部分唯一冲突映射为 `HUMANIZATION_ALREADY_ACTIVE`。
  - 重试按作业类型复制原快照并重新检查当前来源资格，不读取当前 Prompt。
- [x] 在 `backend/app/routers/production.py` 增加自然化 POST；现有列表/详情/重试支持两种作业。
- [x] 保持 Redis 只传一个作业 UUID，不新增队列名或 Celery task。

定向单元测试至少覆盖：

- [x] Prompt 与 user message 精确组成及严格快照解析。
- [x] DRAFT / CHANGES_REQUESTED 正常；任务终态、非法状态和 HUMAN 来源拒绝。
- [x] 缺 Prompt、模型缺失/未测试/停用、当前或原快照非 PUBLIC 拒绝。
- [x] 相同幂等键复用、载荷冲突、同源活动作业并发冲突。
- [x] 失败重试保留原 Prompt revision、模型和源哈希；更换模型必须创建新作业。

## 6. Worker、质量检查与可靠性

- [x] 让 `backend/app/services/generation.py` 按 `job_type` 选择严格快照和构造调用，复用一个 OpenAI-compatible 客户端边界。
- [x] 把质量检查依赖收窄为两类快照都能显式构造的上下文；保持现有标题/正文长度、禁用表达、未知数字和必要披露语义不变。
- [x] 自然化调用前和调用后复核任务、事实、产品、源版本类型/状态/任务/事实/哈希；迟到响应不创建版本。
- [x] 成功时创建一个 `source_type=AI`、`based_on_id=source.id` 的 DRAFT，回写原有 provider/timing/token 指标。
- [x] 日志增加非敏感 `job_type` 和源版本 ID，不记录 Prompt 或正文。
- [x] `generation_dispatch.py`、Beat 恢复和 Celery UUID 消息尽量保持代码不变；只调整必要的用户可见“生成作业”文案为“AI 作业”时同步测试。

增加或扩展 `backend/tests/integration/test_generation_reliability.py`，必要时新建聚焦的 `test_content_humanization.py`，覆盖：

- [x] 真实 OpenAI-compatible HTTP 替身只收到一次自然化请求且严格返回四字段 JSON。
- [x] 成功创建一个新版本，源版本不变，`source_job_id/based_on_id` 正确。
- [x] 重复 Celery 消息、并发 Worker、PENDING 补投递和 RUNNING 租约不会重复调用/落库。
- [x] 调用期间源版本进入审核或任务终态时，迟到响应不落库。
- [x] 严格响应错误、网络错误、Header/凭据删除和输出事实质量问题路径。
- [x] 成功结果再次自然化及同源活动索引行为。

定向验证：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_generation.py backend/tests/unit/test_ai_boundaries.py -q
DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_generation_reliability.py -q
```

若新增独立集成文件，把它加入第二条命令。环境变量使用调用环境现有值，不在日志或文档中写真实凭据。

## 7. 审核追溯

- [x] 更新 `backend/app/services/review.py`，使用共享链路解析结果保留原 `generation_trace`，并按顺序返回 `humanization_traces`。
- [x] 链路缺失、跨任务/事实、job type 与快照不一致时返回明确审核上下文错误，不回退到当前配置。
- [x] 扩展审核集成测试：原始生成稿无自然化 trace；一次/多次自然化按序展示；自然化后的人工修订仍继承完整追溯；版本 diff 以直接 `based_on_id` 为优先。

## 8. 前端配置与任务工作台

- [x] 运行 `make contract-generate` 更新 `frontend/src/shared/api/schema.d.ts`，不手写重复 DTO。
- [x] 在 `frontend/src/shared/api/queryKeys.ts` 增加全局自然化 Prompt query key。
- [x] 扩展 `PlatformPromptsPage.tsx`：
  - 未配置状态、首次保存、revision 更新、冲突和建议模板文档链接。
  - 不新增路由、全局 Store、Prompt 删除或隐式默认。
- [x] 扩展 `ContentTasksPage.tsx`：
  - 版本行自然化入口与模型确认 Modal。
  - 未配置、非 PUBLIC、非法状态/HUMAN、任务终态或同源活动作业的清楚禁用原因。
  - AI 作业列表区分 `GENERATE/HUMANIZE`，显示源/结果链接、状态、失败、指标和原快照重试。
  - 任一活动作业轮询；成功后失效 jobs/versions，避免页面内复制服务端状态。
- [x] 内容详情/审核面板展示自然化 trace 和已有差异，不增加第二个重复自然化入口。
- [x] 更新 `StatusTag` 或局部标签，使“原始生成/自然化”含义清楚但不新增全局状态系统。

前端组件测试：

- [x] `ConfigurationPages.test.tsx` 覆盖未配置、首次保存和更新；配置 API 集成测试覆盖权限与修订冲突。
- [x] `ContentTasksPage.test.tsx` 覆盖入口资格、模型选择、创建载荷、活动作业、失败重试、成功失效和未配置提示。
- [x] 内容审核组件测试覆盖原生成与自然化追溯。
- [x] 保持键盘可操作、Modal 焦点、按钮可访问名称和局部错误恢复。

定向验证：

```bash
npm --prefix frontend run test -- ContentTasksPage ConfigurationPages
npm --prefix frontend run typecheck
```

## 9. 文档、模板与许可证

- [x] 新增 `docs/content-humanization-prompt.md`：
  - 项目安全版建议 Prompt，只保留自然表达规则。
  - 明确批准事实优先、禁止虚构观点/体验/数据、严格 JSON 由系统契约负责。
  - 标明 `op7418/Humanizer-zh` 来源、MIT 版权/许可要求和访问日期。
  - 说明管理员必须审阅后显式保存，文档不是运行时 fallback。
- [x] 更新 `docs/testing.md` 的自然化真实 HTTP 替身和可靠性门禁。
- [x] 更新 `.trellis/spec/backend/ai-configuration-guidelines.md`、`database-guidelines.md`，记录稳定契约和正确/错误示例。
- [x] 检查方案文档是否已有相同事实；只更新权威位置，不复制维护第二份 API/数据库说明。

## 10. 最终验证顺序

先运行最小检查，再扩大范围：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_generation.py backend/tests/unit/test_ai_boundaries.py -q
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_migrations.py -q
npm --prefix frontend run test -- ContentTasksPage ConfigurationPages
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make build
make e2e
```

E2E 必须通过 UI 完成：管理员首次配置自然化 Prompt → 原始生成成功 → 对 AI 草稿选择模型自然化 → Worker 调用 HTTP 替身 → 新版本出现 → 比较源/结果 → 进入审核。不得用 `page.request` 执行被验收步骤，不得使用 eager 或确定性假自然化。

如果完整 `make verify` 因环境、时长或真实基础设施不可运行，必须记录失败命令、实际输出、已运行替代检查和剩余风险；不得把未执行检查写成通过。

## 11. 差异审计与提交门禁

- [x] 检查最终 diff，确认没有第二套作业状态机、Prompt fallback、候选快照解析、静默默认、广泛异常吞噬、重复质量逻辑或无关清理。
- [x] 确认未修改/纳入用户现有 `AGENTS.md` 和 `.agents/skills/playwright-cli/` 变更。
- [x] 确认新增/实质修改的 Python 模块、函数、复杂分支、日志和错误信息完成中文 touched-scope 文档检查。
- [x] 确认 OpenAPI、运行时 Schema、生成类型、数据库文档、架构、测试和实现一致。
- [ ] 在任何 Git commit 前向用户提交精确文件清单与 commit 计划并等待确认；不得自动 push。

## 12. 发布与回滚门禁

- [ ] 迁移、后端/Worker/Beat、前端全部部署并检查通过前，保持全局 Prompt 未配置。
- [ ] 首次配置 Prompt 是显式功能开启点；配置后执行预发布 smoke。
- [ ] 首个 `HUMANIZE` 作业产生前可以回退应用并降级迁移，先备份当前 Prompt。
- [ ] 首个 `HUMANIZE` 作业产生后禁止 downgrade 或部署不识别自然化快照的旧应用；问题只能前滚修复，历史不得删除、改绑或伪装为原始生成。
