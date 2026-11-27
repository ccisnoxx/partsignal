# IntegrityError 领域错误映射

## Goal

为 Frontend V2 功能合同一致性基线建立一份可 review、可实施拆分的 PostgreSQL 完整性错误权威映射方案：已知数据库约束必须由负责业务命令的 service owner 精确转换为领域错误；只有真实 `expected_revision` 过期继续使用 `REVISION_CONFLICT`；未知 `IntegrityError` 必须显式失败且不得伪装成固定 409、成功响应或 revision 冲突。

本 Task 只完成只读审计与规划，不运行 `task.py start`，不实施任何修复。

## Background

- Frontend V2 功能合同一致性基线、完整 non-2xx response contract gate、线上只读验收及其后续前端修复已经完成并归档。
- 当前全局 `backend/app/errors.py` 的 `integrity_error_handler` 会把未被 service 精确处理的 `sqlalchemy.exc.IntegrityError` 统一转换为 HTTP 409、`code=REVISION_CONFLICT`、`message=数据约束冲突`。
- 该行为混淆唯一约束、外键约束、CHECK、NOT NULL、其他完整性失败与 optimistic revision 冲突，可能诱导客户端进入错误的“保留草稿/显式 reload”恢复路径。
- 已知已有若干正确样例需要复核：产品身份唯一约束映射 `PRODUCT_ALREADY_EXISTS`；Platform Type slug 唯一约束映射 `PLATFORM_TYPE_SLUG_EXISTS`；Platform Account normalized identifier 映射 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`；用户删除外键失败按结构化 `sqlstate` 识别。

## Confirmed Decisions

- 删除全局 `IntegrityError -> REVISION_CONFLICT` 业务映射；unknown 回到 FastAPI/Starlette 默认 500 boundary，由 request Session owner 回滚，不冻结新的 JSON body/code/header/request ID 合同。
- 已知约束只由拥有该 command 的 service 根据结构化 PostgreSQL diagnostics 做窄 allowlist 映射；禁止错误文本解析、模糊匹配和未确认约束后的二次查询推断。
- T1 只是撤销错误 409，不修改 OpenAPI/generated client；新增领域 code、稳定 JSON 500 或前端 409 恢复政策变化必须 contract-first。
- 实施按 T1 unknown boundary、T2 configuration、T3 identity、T4 content/generation、T5 publication/GEO、T6 frontend projection 拆分；每项均有独立 production/test/required-command 对照。
- `putContentHumanizationPrompt` 的“资源不存在 + expected_revision”是独立的 revision code 误用，不属于 `IntegrityError` mapper；由 T2-C 先决定语义，再由 T2 实现。

## Requirements

### R1. 完整路径与约束审计

- 搜索并记录全部 `IntegrityError` import、`except IntegrityError`、可能触发数据库完整性约束的 `flush`/`commit`、全局 exception handler，以及对应的 HTTP `operationId`。
- 审计全部 Alembic migration、ORM model、`contracts/database.md` 和其他数据库约束定义，不得用用户列出的 service owner 清单替代完整搜索。
- 至少覆盖 `identity.py`、`product_facts.py`、`platform_configuration.py`、`content_planning.py`、`content_production.py`、`publication.py`、`ai_configuration.py`。

### R2. constraint-to-domain-error matrix

为每个数据库约束至少记录：

- `constraint_name`；
- table/columns；
- 类型（UNIQUE/FK/CHECK/NOT NULL/EXCLUDE/其他）；
- migration/model/database contract 定义位置；
- 可能触发它的 service command 与 HTTP `operationId`；
- 当前业务预检、当前 `IntegrityError` 处理方式和当前 HTTP status/code/details；
- 建议的领域 status/code/details；
- transaction rollback/savepoint owner；
- 必要的单元、HTTP、真实 PostgreSQL integration/concurrency 测试。

### R3. 错误分类与识别边界

- 明确区分真实 `expected_revision` 过期、已知数据库约束竞态、未知 `IntegrityError` 三类失败。
- 已知约束仅可依赖结构化 PostgreSQL/DBAPI 诊断字段（例如 `constraint_name`、`sqlstate`）映射。
- 禁止使用 `str(error)`、数据库英文错误消息、模糊 substring、猜测 column/value，或捕获所有 `IntegrityError` 后统一返回同一 code。
- 未知 `IntegrityError` 必须 fail explicit，不得泄露 SQL、表名、约束内容或堆栈。

### R4. 事务与副作用语义

- 说明 `IntegrityError` 后 SQLAlchemy Session failed state，以及 mapper 应位于 `flush`、savepoint、rollback 或 `commit` 哪一层。
- 明确 rollback/savepoint owner，避免 rollback 丢失本应保留的业务状态。
- 失败路径不得留下成功 `AuditLog`、事件、revision 递增或部分写入。
- 并发唯一约束方案必须证明业务预检和数据库最终权威返回同一领域错误、仅一个写入成功、失败请求无成功审计或部分状态。

### R5. 全局 handler 与公共合同

- 删除全局 `integrity_error_handler`，把 unknown 交给框架默认 500 boundary；只固定 HTTP status 与不泄漏边界，不把默认 body/code/header 写成稳定公共合同。
- 在没有合同证据时不得自行发明 error code/status。
- 若建议的 status/code 尚未出现在 OpenAPI，按 contract-first 顺序规划 `contracts/openapi.yaml`、runtime route metadata、generated client、backend contract tests、frontend error projection/恢复行为。
- 复核所有前端 `REVISION_CONFLICT` consumer，确保只有真实 revision 冲突进入“保留草稿/显式 reload”路径。

### R6. 实施拆分

- 若矩阵证明一个共享的窄 mapper 加少量 service owner 可以安全完成，给出一个实现 Task 的精确方案。
- 若横跨多个稳定领域或大量公共 error code，将本 Task 限定为“权威约束映射审计与实施拆分”，按稳定 service/domain owner 创建后续 Task 方案与依赖顺序。
- 不得按异常类型或文件数量机械拆分，也不得创建通用 registry、插件、策略框架或第二套错误类型系统，除非多个真实重复 owner 的证据证明必要。

### R7. 文档与规划交付物

- 交付 reviewable 的 `prd.md`、`design.md`、`implement.md` 和完整 constraint-to-domain-error matrix。
- 展示当前错误数据流、目标错误数据流、已知/未知约束边界、全局 handler 去留证据、事务方案、公共 API/generated client/前端 consumer 影响。
- 明确后续实施 Task 的精确文件边界、依赖顺序、required/optional validation、独立 Review 与停止条件、回滚边界。
- 推荐第一个实施 Task，并给出精确、可观察的验收标准。

## Constraints

- 本规划阶段不修复任何 `IntegrityError`，不修改数据库 schema、不新增 migration、不修改生产数据。
- 不修改真实 revision conflict 语义，不修改无关 service、router、权限或状态转换。
- 不进行前端视觉改动，不顺手处理 `ai-operation-history-contract-reconciliation`、`configuration-secondary-stale-state` 或其他 P2/P3 缺口。
- 不归档或改写任何已完成的历史 Trellis Task。
- 当前 `main` 存在任务范围外的 `.gitignore` 修改、大量 staged artifacts 删除和其他既有脏文件；全部保持不动。
- 不运行 `git add -A`、`git add .`、`commit -a`、`reset`、`checkout`、`stash` 或清理命令。
- 本规划阶段不提交、不归档、不 push；只允许修改本 Task 工件及必要的父子关联记录。
- 后续如提交，必须先设计路径受限提交与 staged index 隔离方案。

## Out of Scope

- 任何生产代码、合同、数据库、迁移、generated client、测试或稳定 spec 的实际修改。
- 把所有数据库错误替换成另一个通用 409，或解析 PostgreSQL 错误文本。
- 立即创建或启动后续实施 Task；本轮只交付拆分方案，待用户 review。

## Acceptance Criteria

- [x] 完整清点 `IntegrityError` 路径并给出可复核总数、文件与 `operationId` 锚点。
- [x] 完整清点命名与未命名数据库约束并给出可复核总数、定义位置和触发 owner。
- [x] constraint-to-domain-error matrix 覆盖每行规定字段，并明确“已有正确映射 / 错误落入全局 `REVISION_CONFLICT` / 不可达或仅数据库防线 / 尚需合同决策”。
- [x] 三类失败、已知/未知边界、禁止识别方式和不泄露要求有明确设计。
- [x] 全局 handler 去留决策有当前 runtime、OpenAPI、测试与前端 consumer 证据支持。
- [x] transaction/rollback/savepoint 设计说明失败状态与副作用原子性。
- [x] 测试方案包含真实 PostgreSQL `constraint_name`/`sqlstate`、唯一约束并发、失败副作用和未知约束 sentinel；mock 不作为唯一证明。
- [x] 明确 `contracts/database.md`、OpenAPI、runtime metadata、generated client、稳定 specs 和业务设计文档分别是否需要更新及理由。
- [x] 给出按稳定 domain/service owner 拆分的后续实施 Task、依赖顺序、文件边界、required/optional validation、Review/停止条件和回滚边界。
- [x] `putContentHumanizationPrompt` 明确误用已纳入 T2-C/T2，且 T1–T6 声明的测试文件均进入对应 required command；T6 的 15 个 production consumer 均有具体测试 owner或拟新增文件。
- [x] 推荐第一个实施 Task并给出精确验收标准。
- [x] `prd.md`、`design.md`、`implement.md` 和研究矩阵可进入新的独立 review，且 `task.json.status` 仍为 `planning`。
- [x] 未修改代码、合同、数据库、生产数据、历史 Task，未提交、归档或 push。

## Required Final Report

完成规划后向用户汇报：

1. IntegrityError 路径与数据库约束总数；
2. 已有正确领域映射；
3. 仍落入错误全局 `REVISION_CONFLICT` 的路径；
4. 未知 `IntegrityError` 推荐失败边界；
5. 公共合同变更需求；
6. 推荐实施拆分；
7. 第一个实施 Task 的精确范围与验收标准。
