# Frontend V2 Phase 6 Configuration 抽象回顾与 Exit Gate 审计设计

## 1. Decision

本 Task 采用 **audit-first、evidence-only、允许零代码修改** 的设计，不预设需要新抽象：

```text
Phase 6 contracts / ADR / specs
  -> routes
    -> configuration domain models + API owners + pages
      -> design-system/shared primitives
  -> model/component/fixture/real-stack evidence
  -> research/audit.md
  -> 仅关闭已证实 P0/P1/P2
  -> current-candidate Exit Gate
```

抽象不是交付目标；唯一目标是确认所有权是否仍唯一，并关闭会阻止 Phase 6 退出的真实缺口。审计没有发现 blocker 时，只更新证据与权威文档。

## 2. Existing architecture to preserve

### 2.1 Route and domain boundary

- routes 只拥有 search/params canonicalization、loader/prefetch、ADMIN boundary、metadata 与跨域 cache composition。
- `frontend-v2/src/domains/configuration/` 继续拥有 Platform、Prompt、AI Channel 的 query keys、API wrappers、纯 model 映射、form/mutation coordination 与 domain UI。
- `design-system/` 只拥有 RowActions、Table、Workspace、Form、Dialog、Select、Badge 等稳定 UI 语义，不认识 Configuration token、权限或业务状态。
- generated OpenAPI types 是 API DTO 权威；本 Task 不手写重复 response/request type。

### 2.2 State ownership

| State | Authoritative owner |
| --- | --- |
| search、filter、pagination、workspace tab、usage period、log page | TanStack Router URL schema |
| list/detail/models/usage/logs/audit/preview options | TanStack Query + domain key factory |
| editable fields、dirty baseline、expected revision | RHF + current canonical response |
| dialog target、focus return、secret input、temporary discovery result | React local state |
| eligibility、primary/secondary commands、deletion blockers | server projections |

任何 finding 都先归还给表中既有 owner；不增加 global store、event bus、context service 或第二套状态机。

### 2.3 Contract and safety boundary

- Platform、Account、Type、Prompt、Channel、Header、Model 的 revision 由各自 canonical response 推进。
- 409 不 replay；失败不 optimistic update，不用 message 解析兼容行为。
- API Key/Header values 只写不读，secret mutation 不保留 cache。
- Usage/Logs/Audit Detail 直接消费服务端聚合、分页、actor 和安全投影；浏览器不补算、不 join Users、不 dump raw JSON。
- Prompt Preview 复用真实 GenerationJob -> immutable ContentVersion 链路，不创建 preview 状态机或第二类 Job。

## 3. Audit method

### 3.1 Evidence matrix

实施首先创建 `research/audit.md`，按以下列记录：

```text
ID | Severity | Surface | Invariant | Evidence | Root owner | Decision | Validation | Status
```

Severity：

- P0：数据/secret 泄漏、错误授权、不可逆破坏或 gate 无法可信运行；
- P1：核心行为、并发、合同或主要流程错误；
- P2：明确的架构/可访问性/响应式/测试或文档 blocker；
- P3：非阻塞维护建议，只记录，不纳入本 Task 实施。

### 3.2 Fixed review dimensions

1. route 薄层与依赖方向；
2. API DTO、read model、query key 和 cache consumer 唯一 owner；
3. URL/Query/Form/local state 分离；
4. `primary_task/available_actions/deletion` 穷尽映射与服务端最终守卫；
5. revision、dirty、409 no-replay 和 canonical reload；
6. secret replacement-only、Runtime 安全投影和测试 artifact；
7. Table/Workspace/Dialog/primitive 是否复用既有 Design System；
8. unit/component/strict fixture/real-stack 是否互补、是否存在空白或重复假证据；
9. docs/ADR/spec/OpenAPI/generated/runtime 是否一致。

## 4. Structural decision ladder

每个 finding 按以下顺序停在第一项可成立的方案：

1. 删除死代码、无消费者 wrapper 或重复状态；
2. 复用当前已有 owner；
3. 在共同 root owner 做局部修正；
4. 只有稳定语义已有多个真实消费者时，提取最小共享函数或纯 UI primitive；
5. 若需要公共合同/数据库/权限/部署变化，停止并回到 planning。

以下不构成抽象证据：两个同名 `Notice`、短 `errorMessage`、不同资源的 revision dialog、不同 consumer 集合的 invalidation 序列、文件行数或未来 Phase 7/8 可能复用。

## 5. Authorized implementation boundary

### Expected audit/read set

- `frontend-v2/src/domains/configuration/**`
- Configuration routes under `frontend-v2/src/routes/_app/**/settings*`
- Configuration model/component tests and nine Phase 6 Playwright specs
- `frontend-v2/src/design-system/**` 与跨域 public query owners（只读核对）
- OpenAPI/generated types、直接相关 backend owner 与 archived Task（只读核对）

### Writable set after approval

- `frontend-v2/src/domains/configuration/**` 与对应 colocated tests，仅限已证实 finding；
- Configuration routes，仅限 owner/canonicalization/cache composition finding；
- 既有 Design System 文件，仅在真实跨页面 UI invariant 已被证明时；
- 当前 Task 的 `research/audit.md`、`implement.md`；
- `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md`、必要的 `09-architecture-decisions.md` 与 `.trellis/spec/frontend/*`。

默认不修改 contracts、backend、database、deployment、V1 或 dependencies。若证据要求跨越该边界，保持 gate `NOT_MET` 并回到 planning。

## 6. Test and evidence design

- model/component tests 证明 pure mapping、state ownership、mutation/error/cache 行为；不测试框架内部实现。
- strict fixture Playwright 证明 production artifact、允许请求集合、URL/Back/Forward、键盘/焦点和四档响应式；不冒充 backend 业务权威。
- 最近 Configuration real-stack 证明真实 FastAPI/PostgreSQL/Celery/Provider、revision conflict、replacement-only、consumer handoff、Usage/Logs 和 cleanup。
- 最终 `make verify` 在实施后的唯一候选上统一证明 contract、V1/V2 lint/typecheck/unit、backend integration、build、real-stack、fixture E2E 与 Compose config；失败必须先归因，不通过删测试或扩大 fallback 消失。

## 7. Documentation and contract impact

- `07` 记录抽象回顾结果、finding 关闭状态和 Phase 6 gate。
- `08` 记录 targeted/current-candidate 验证与最近 real-stack 证据的关系。
- `09` 只在既有 ADR 与实现不一致或出现新的、已批准稳定决策时更新；不为“没有变化”新增 ADR。
- frontend specs 只保存值得长期复用的稳定约束，不复制 Task audit 细节。
- OpenAPI/database docs 默认不变，因为本设计不批准 API/schema 变化。

## 8. Exit Gate rule

最终 evidence matrix 分别给出 Product、Engineering、UX/Accessibility、Architecture、Contract/Data Integrity、Documentation 六类结论。只有全部为 `MET`、required validation 通过且 open P0/P1/P2 为 0，才能把 Phase 6 改判 `MET`；否则保持 `NOT_MET` 并列出精确 blocker，不降低门禁。

## 9. Rollback

- 规划提交只包含 Task metadata 与三份规划文档，可独立回退。
- 实施回退单位为本 Task 的一个候选提交；不保留半完成抽象或只更新文档的假 `MET`。
- 不执行数据库迁移、外部写入或不可逆数据操作。
