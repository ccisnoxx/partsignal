# Frontend V2 Phase 6 Configuration 最终抽象回顾

## 1. 审计结论

- Platform、Platform Type、Prompt 与 AI Channel 的 route、query key、API wrapper、form、action projection 和跨域 cache composition 仍有明确且唯一的 owner；没有证据支持新增通用 Settings、CRUD、Workspace、Table、Runtime、错误处理或状态管理框架。
- 审计确认并关闭两个当前实现缺口：AI Channel 干净配置表单收到后台 canonical 更新后仍可能用旧 revision 保存；AI Channel List 成功启停/删除后遗漏工作区缓存失效与删除清理。
- 修复只修改既有 root owner 和两条页面回归，没有公共 API、数据库、权限、部署、依赖或生成类型变化。
- Configuration 未解决 P0/P1/P2 为 `0`；但当前候选 `make verify` 暴露四个范围外 V2 unit blocker，Engineering 不满足，因此 Phase 6 Exit Gate 为 `NOT_MET`。

## 2. Surface 与 owner 证据矩阵

| Surface | URL / route owner | Query / API owner | Form / action owner | 审计结果 |
| --- | --- | --- | --- | --- |
| Platform List | `frontend-v2/src/routes/_app/settings/platforms/index.tsx:12-29` | `platform.api.ts:32-75` | `platform-list.model.ts:125-188`、`platform-list-page.tsx:75-119` | canonical URL、服务端动作、revision mutation 和消费者失效各有单一 owner |
| Platform Workspace / Accounts | `frontend-v2/src/routes/_app/settings/platforms/$platformId.tsx:20-52` | `platform.api.ts:77-111` | `platform-workspace-page.tsx:107-296,343-1177`、`platform-workspace.model.ts:97-249` | Overview、Accounts、Generation 按 Tab/表单分工；完整 Platform update 保留另一表面权威字段，没有第二 DTO |
| Platform Type | ADMIN route `settings.platforms.types.tsx:7-24` | `platform.api.ts:48-59,113-173` | `platform-types-page.tsx:44-493`、`platform-types.model.ts:34-145` | subsettings 不占 Sidebar；动作、blocker、revision 和三类真实消费者边界稳定 |
| Prompt Library / Editor | `settings.prompts.tsx:20-42` | `prompt.api.ts:23-76` | `prompt-workspace-page.tsx:69-638`、`prompt-workspace.model.ts:17-151` | URL 是选择/search owner，RHF 是 Markdown/dirty owner，服务端 Detail 是 revision/绑定 owner |
| Prompt Preview | Prompt Workspace reference pane | `prompt.api.ts:67-76` 与 Content public API | `prompt-preview.tsx:39-489` | 复用现有 GenerationJob 与不可变 ContentVersion；没有 preview mutation、第二轮询器或专用状态机 |
| AI Channel List | `settings.ai.tsx:14-35` | `ai-channel.api.ts:34-64` | `ai-channel-list-page.tsx:78-150`、`ai-channel-list.model.ts:115-204` | URL、typed action、secret-free create 和精准缓存组合保持唯一；本 Task 补齐工作区缓存闭环 |
| AI Channel Core | `settings.ai_.$channelId.tsx:17-55` | `ai-channel.api.ts:66-84,242-369` | `ai-channel-workspace-page.tsx:89-361`、`ai-channel-workspace.model.ts:111-325` | Basic/Request 共用一个 RHF 草稿与 revision baseline；replacement-only secret 独立于查询缓存 |
| AI Models | Workspace `tab=models` | `ai-channel.api.ts:86-100,150-240` | `ai-channel-models-section.tsx:53-366`、`ai-channel-workspace.model.ts:327-402` | 模型 query/mutation/Dialog 为 domain-local owner；Provider test 单次确认且不抽取通用 CRUD |
| AI Runtime | Workspace `tab=usage|logs` | `ai-channel.api.ts:102-145` | `ai-channel-runtime-section.tsx:55-379`、审计白名单 `ai-channel-workspace.model.ts:404-517` | URL 持有 period/page/pageSize；聚合、actor、分页和安全字段均由服务端投影 |

## 3. 横切边界

| 边界 | 证据 | 结论 |
| --- | --- | --- |
| URL state | Platform、Prompt、AI List/Workspace model 均有 canonical schema 与 route replace；对应 model tests 覆盖非法值、默认值和多余字段 | `MET`：没有第二份 page/tab/filter/selection state |
| Query state | 三个 domain-local key registry 位于 `platform.api.ts:26-45`、`prompt.api.ts:17-21`、`ai-channel.api.ts:34-51` | `MET`：未发现 `queryClient.clear()`、全局 Store、event bus 或复制 key owner |
| Form / dirty | Platform 分表面 RHF；Prompt 单 Editor；AI Basic/Request 单 RHF；DirtyGuard 只读取对应表单 dirty | `MET`：没有并行 boolean 或 URL/form 双写 |
| Server-driven action | Platform/Account/Type/Prompt/Channel/Header/Model 的 resolver 对未知、重复或矛盾 token 显式失败 | `MET`：`isAdmin` 只控制 Platform Type subsettings 入口；业务 mutation 资格不由角色/status/message 重建 |
| Revision / no replay | mutation 载荷使用响应 revision；409 保留草稿/确认上下文并要求显式 reload | `MET`：F-01 关闭后台 canonical 更新后的 baseline 漂移 |
| Secret | create/API Key/Header secret mutation `gcTime: 0`，失败/关闭清空输入；读取投影只有 metadata | `MET`：recent real-stack 另证明 replacement-only、trace off 与 secret scan clean |
| Cache | domain key owner 在 Configuration；route 只组合 Content/Publication 等 public keys | `MET`：F-02 补齐 AI List 对 exact workspace keys 的失效与删除清理 |
| Contract / data | 页面只从 `components/operations` 生成类型派生 DTO；本 Task 没有 schema、OpenAPI、数据库或权限变化 | `MET`：不修改 `contracts/openapi.yaml`、`contracts/database.md` 或 generated schema |

## 4. Findings

### F-01 — P1 — AI Channel 草稿 baseline 可退回旧 revision（已关闭）

- 根因：`LoadedAIChannelWorkspace` 在表单干净时会用新 `channel` 重置字段，但 `draftBaseline` 只在本地 mutation/reload 时同步。后台 query 更新后，用户第一次编辑使 `baseline` 从新 `channel` 切回旧 `draftBaseline`。
- 影响：PATCH 会提交旧 `expected_revision`，产生错误的 revision conflict；用户看到的表单明明来自新快照，却不能直接保存。
- owner 与修复：在既有干净表单同步 effect 中同时更新 `draftBaseline`，dirty 草稿继续冻结旧 baseline，不增加新状态源（`ai-channel-workspace-page.tsx:138-158`）。
- 回归：`ai-channel-workspace-page.test.tsx` 先写入 revision 5 的 query canonical，再编辑并断言 PATCH 使用 revision 5。

### F-02 — P1 — AI Channel List mutation 遗漏工作区缓存闭环（已关闭）

- 根因：List route 成功回调只失效 AI list 和跨域 generation consumers，没有处理同一渠道的 Detail、Models、Usage、Logs keys；与 Workspace 删除边界及 Platform List 的既有做法不一致。
- 影响：启停后可读取未失效的 Workspace/Models 投影；删除后可继续命中已不存在渠道的缓存快照。
- owner 与修复：在既有 route cache composition 回调中，启停/删除精确失效 Detail、Models、Logs；删除额外移除 Detail、Models、Usage root 与 Logs root（`settings.ai.tsx:47-63`）。
- 回归：`ai-channel-list-page.test.tsx` 预置四类 exact cache，完成 UI 删除后断言全部移除。

## 5. 抽象处置

| 候选 | 处置 | 理由 |
| --- | --- | --- |
| 三套 Configuration request error / CSRF parser | 保持 domain-local | Error class、动作文案和调用者类型不同；没有共同失败行为或多实现压力，抽取只会增加跨域依赖 |
| 各页面 `Notice` / `errorMessage` | 不抽取 | 只是局部展示胶水，语义、色调与恢复动作不同；Design System 已拥有 Button/Dialog/ErrorSummary 等稳定 primitive |
| Platform / Prompt / AI Workspace 长文件 | 不按长度拆分 | 文件内状态和副作用由同一页面 owner 协调；不存在第二个消费者，强拆会把 mutation、focus、dirty 和 revision 生命周期分散到薄包装 |
| Cache invalidation helper | 不新增通用层 | Platform、Prompt、AI 的真实消费者集合不同；F-02 在现有 route owner 用 exact keys 即可关闭 |
| 通用 action registry | 不新增 | 每类 generated token union 与矛盾条件不同；现有 domain-local exhaustive resolver 已提供编译期和运行时边界 |

## 6. 测试证据

- 实施前 Configuration targeted：`12 files / 79 tests passed`。
- F-01/F-02 修复后的聚焦回归：`2 files / 17 tests passed`。
- 最近已归档 Configuration real-stack：V2 `13 passed (1.1m)`、指定 V1 `5 passed (1.4m)`，合计 `18 passed`、退出码 `0`；secret/trace 扫描 clean，Redis DB 14、六端口、临时数据库、对象存储和进程均清理（归档 Task `implement.md:222-234`）。
- 修复后 Configuration targeted：`12 files / 81 tests passed`。
- 当前候选的 api:check、typecheck、lint、production build、contract-check 与 `git diff --check` 均通过；build 只有既有 Markdown editor chunk-size warning。
- 唯一一次 `make verify`：合同、Ruff/mypy、双前端 lint/typecheck、backend unit `193 passed`、V1 unit `205 passed`、V1 visual contract `24 passed` 后，在 V2 unit 以 `4 failed / 69 passed files`、`10 failed / 416 passed tests` 停止，未进入 integration/build/E2E。
- 失败归因：`global.test.ts` 7 条唯一 token 断言与 `global.css` print media 的既有 token 重定义冲突；Product Detail 期望遗漏既有 GEO/业务配置导航组；Content Editor 与 Publication Workspace 使用单元素查询但当前 UI 各有两个同文案元素。上述生产/测试文件相对基线 `22f261fe` 均无 diff，不由本 Task 修改造成。

## 7. Exit Gate

| Category | Current result | Evidence / remaining condition |
| --- | --- | --- |
| Product | `MET` | Phase 6 全部路由与既定 Platform/Prompt/AI 心智模型已交付；本 Task 不增减产品行为 |
| Engineering | `NOT_MET` | Configuration targeted/static 全绿，但唯一一次 `make verify` 在四个范围外 V2 unit 文件失败，未进入后续门禁 |
| UX / Accessibility | `MET` | 既有 strict fixture 覆盖四档、键盘、focus、dirty、error、revision；本 Task 未改变布局或交互 primitive |
| Architecture | `MET` | 单一 owner 保持；两个缺口均在 root owner 关闭；未新增抽象、依赖或第二状态源 |
| Contract / Data Integrity | `MET` | runtime/OpenAPI/V1/V2 generated checks 通过；本 Task 无合同/数据变化，最近 Configuration real-stack 仍是直接业务证据 |
| Documentation | `MET` | `07`、`08`、Task audit/implement 与当前实现和失败归因一致；无需修改 ADR/spec/根合同 |

Engineering 为 `NOT_MET`，因此 Phase 6 保持 `NOT_MET`。范围外 owner 关闭上述四个 test file 的十条失败并对新的最终候选重跑 `make verify` 后，才能重新判定；本 Task 不修改这些模块。
