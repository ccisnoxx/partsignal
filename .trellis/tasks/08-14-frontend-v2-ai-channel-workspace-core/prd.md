# Frontend V2 AI Channel Workspace Core

## Goal

为管理员交付 `/settings/ai/$channelId` 的 Core vertical slice：闭环 List 创建入口及 `basic/request` handoff，用同一个 channel revision 与共享表单维护完整 `AIChannelUpdate`，并提供 API Key/Header 替换式管理。服务端继续作为状态、动作、权限和 revision 的最终权威；API Key 与所有 Header value 永不进入读取响应、Query cache 或可观察诊断面。

本 Task 是已批准父 Task `08-14-frontend-v2-ai-channel-workspace` 的第一个实现子 Task。它从基线提交 `fd6c9217` 的最新 clean `main` 创建临时分支 `codex/frontend-v2-ai-channel-workspace-core`；后续 Models、Runtime 必须等待本 Task 归档并 fast-forward 合入 `main`。

## 已验证事实

- V2 List 已生成 `basic/request/models/usage` handoff，但仓库中尚无 `$channelId` route。
- `AIChannelUpdate` 的 `name/description/protocol_type/provider_brand/base_url/timeout_seconds/expected_revision` 全部 required；Basic 与 Request 不能作为独立 partial form 提交。
- `AIChannelHeader` 当前仍返回普通 Header 的 `value`；create/update 已使用 `expected_channel_revision`，delete 尚未接受 revision。
- V1 `AIChannelDetailPage.tsx` 直接展示/预填 Header value，并直接调用 Header DELETE；合同收紧必须在本 Task 同步 V1。
- V2 已有 `ai-channel.api.ts`、AI Channel List command owner、`DirtyGuard`、Form/Workspace/Table primitives；无需新依赖、全局 store、通用 Workspace framework 或第二 API owner。
- 数据库现有 channel revision 足以拥有 Header 集合；本 Task 不需要数据库迁移。

## Requirements

### R1. 合同与服务端边界

- 从 OpenAPI 与 runtime `AIChannelHeader` 读取投影移除 `value`，普通与敏感 Header 均只返回安全 metadata/action projection。
- Header DELETE 增加 required query `expected_channel_revision >= 0`，锁定真实 Header/Channel 后比较；stale command 在副作用前返回 `409 REVISION_CONFLICT`。
- 保持同一 Header 并发 DELETE 只有一个 `204` 和一条成功审计，等待者返回 `404`；Header 变化继续使 channel 与依赖旧连接配置的 model test 状态失效。
- 不改变 `AIChannelCreate`、完整 `AIChannelUpdate`、API Key replacement 合同，不增加 compatibility field、Header revision 或数据库结构。
- ADMIN、CSRF、安全审计和 secret redaction 继续由服务端边界执行。

### R2. V1 直接消费者

- Header 表不展示 value；普通/敏感 Header 的编辑均从空替换值开始。
- Header DELETE 发送当前 channel revision；409 不自动重放。
- 保持现有 channel 完整 update、API Key、Models、Usage/Logs 行为不变。

### R3. Route 与 canonical navigation

- 注册 ADMIN route `/settings/ai/$channelId`；`channelId` 必须是 UUID，大写合法 UUID 使用 `replace` 规范为小写，非法 ID 在 detail 请求前显式失败。
- canonical search 始终包含 `tab`；缺失/非法 tab 规范为 `tab=basic`，未知参数移除。
- parser 识别最终 `basic|request|models|usage|logs` token，但 Core delivered gate 只开放 `basic|request`；其余 token 在页面渲染前进入 route-level not-found，不跳回 Basic、不渲染 200 占位。
- 合法 tab 切换 push history；canonical 修正 replace；刷新、直达、Back/Forward 恢复 URL owner。
- 返回链接只指向 canonical `/settings/ai`，不新增 `from`、browser storage 或客户端历史副本。

### R4. Create、detail 与 channel actions

- 在 V2 List 增加真实 Create Dialog，一次提交 `AIChannelCreate`；成功后进入新渠道 `?tab=basic`。
- Create Dialog 为短生命周期局部表单；关闭、失败处理完成和成功后清除 API Key，不将 secret 写入 Query cache。
- route loader 只预取 channel detail；Workspace header 展示服务端 identity/status/workflow/revision。
- channel 主动作与 overflow 只消费服务端 `primary_task/available_actions`，复用现有 List command owner；未知、重复或矛盾 token 显式失败，不从状态字段推导。

### R5. Basic/Request 共享表单

- `basic` 与 `request` 由同一个 form owner、canonical detail baseline 和 channel revision 生成完整 `AIChannelUpdate`。
- 两 tab 之间切换保留共享值；离开两个编辑 section 或 Workspace 使用现有 `DirtyGuard`。
- 保存成功以 canonical 服务端响应重置 baseline；Cancel 恢复同一 baseline。
- `409 REVISION_CONFLICT` 保留非敏感草稿、锁定旧 revision 禁止再提交，只提供显式重新加载；不得自动 refetch 覆盖草稿或自动重放。

### R6. API Key 与 Headers UI

- API Key 只能创建/替换，输入无默认值；Dialog 结束立即 reset，mutation `gcTime: 0`，错误/toast/log/test snapshot 不包含 secret。
- Header create/update 均要求完整替换 value；普通与敏感 Header 都从空 value 开始，敏感项使用更明确的不可恢复提示。
- Header create/update/delete 均发送当前 channel revision；Header 没有客户端或服务端独立 revision owner。
- Header 每行动作只消费服务端 token；`is_sensitive/is_configured` 只用于文案和状态，不推导权限。

### R7. Cache、测试与文档

- 扩展现有 `aiChannelKeys`，Query key/data 不包含 form values、API Key、Header value 或完整 mutation payload。
- 成功 mutation 只失效父设计矩阵指定的 AI List/detail/models、Prompt Preview options root、Content generation-options 与该渠道 Logs；不刷新 Prompt 正文、Content history、Generation Job/Version history、Usage 历史或无关配置。
- 失败/409 不写伪成功、不做 optimistic cross-page patch、不自动 invalidate/replay。
- 从 Core 起交付 model/component tests 与严格 Playwright fixture；未知 fixture API 返回 `501` 且 teardown 失败。
- 覆盖 375/768/1024/1440、键盘/焦点、ADMIN 边界、List handoff、canonical URL、dirty/conflict 与 secret sentinel。
- 同步 OpenAPI、runtime、双端 generated types、V1 直接消费者、稳定 spec 与直接受影响的 Frontend V2 docs；`contracts/database.md` 不修改并在 closeout 说明原因。

## Acceptance Criteria

- [x] OpenAPI、runtime response、双端 generated types 和 V1/V2 读取 cache 中不存在 `AIChannelHeader.value`。
- [x] Header DELETE required `expected_channel_revision`；stale 返回 409，并发删除保持单 204/单成功审计。
- [x] `/settings/ai/{uuid}?tab=basic|request` 支持直达、刷新、tab history 与 canonical 修正；非法 UUID 不发 detail 请求。
- [x] `models|usage|logs` 在 Core 阶段为 route-level not-found，没有 200 占位或错误回退。
- [x] List Create Dialog 成功创建后导航到新渠道 canonical Basic URL，API Key 生命周期结束后不可观察。
- [x] Basic/Request 共用完整 payload、baseline、dirty 与 channel revision；切 tab 不丢值。
- [x] 409 保留非敏感草稿、禁用旧 revision 提交且不 replay；显式 reload 才重置。
- [x] API Key 与普通/敏感 Header value 均为替换式输入，任何读取响应、cache、DOM、console、audit、错误与 snapshot 都无 secret sentinel。
- [x] Workspace/channel/Header 动作只由服务端 token 映射；未知或矛盾 token 显式失败。
- [x] Required validation 全部通过，或失败被证实为非本变更且在 closeout 说明；未运行的 optional suite 说明剩余风险。
- [x] OpenAPI、代码、测试、spec/docs 一致；无数据库、依赖、通用 framework、第二状态 owner 或 compatibility fallback。

## Out of Scope

- Models query、discovery、CRUD、真实 model test、启停/删除及其合同收紧。
- Usage/Logs query、指标、日志 UI、客户端聚合/分页、轮询、搜索或导出。
- 完整 Configuration real-stack E2E；它在三个 Workspace 子 Task 后由独立 Task 验收。
- 数据库迁移、Redis 状态、部署配置、新依赖、通用 Workspace/Action/Table/Form framework。
- `/settings/ai/new` route、未交付 tab 的成功占位、自动冲突重放、Header 独立 revision、secret compatibility field。

若实施证据表明 channel revision 无法表达 Header 并发，或现有持久化不能满足已批准行为，必须返回父 Task 重新评审数据库/合同，不得在本 Task 自行扩 scope。
