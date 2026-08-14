# Frontend V2 AI Channel Workspace Core 设计

## 1. 设计结论

Core 以 channel aggregate 为唯一 slice：OpenAPI/backend 收紧 Header 读取与 DELETE revision，V1 同步直接消费者，V2 在现有 AI domain API owner 上交付 Create + Workspace Basic/Request。共享 `AIChannelUpdate`、channel revision、dirty baseline 与 Header 集合不能再拆，否则会产生 partial payload 或第二 revision owner。

复用现有 route/form/workspace/table primitives、`ai-channel.api.ts`、List command owner、Prompt/Content cache keys。不得新增 Workspace context API、全局 store、通用 action registry、API wrapper、依赖或数据库结构。

## 2. 边界与数据流

```text
List Create Dialog
  -> POST AIChannelCreate
  -> safe canonical AIChannel response
  -> invalidate lists / seed exact detail
  -> /settings/ai/{id}?tab=basic

$channelId route
  -> validate/canonicalize UUID + tab
  -> prefetch aiChannelKeys.detail(id)
  -> AIChannelWorkspacePage
       -> shared ChannelConfigurationSection(basic|request)
       -> API Key replacement Dialog
       -> Header Table/Dialog
       -> existing channel command owner

mutation
  -> ADMIN + CSRF + expected channel revision
  -> service lock/check/command
  -> safe canonical response
  -> exact cache update + bounded invalidation
```

`models|usage|logs` 是合法最终 tab token，但 Core route 的 delivered gate 在 query/render 前返回 not-found；后续子 Task 只扩 gate，不改变 Core canonical schema。

## 3. 合同与服务端

- `AIChannelHeader` 删除 `value`；backend `AIChannelHeaderOut` 与 router projection 不再读取/返回明文。
- Header DELETE 使用 required query `expected_channel_revision`。service 锁定 Header 后锁定其真实 Channel，比较 revision，再执行统一 model-test invalidation、审计与删除。
- 保留数据库约束与现有 channel revision owner；不添加 Header revision。
- 并发 DELETE 的既有单成功语义保持：第一个提交 204/一条成功审计，等待者找不到目标返回 404。
- `AIChannelUpdate` 继续完整 required；不提供 partial endpoint 或 fallback default。

## 4. V2 ownership

### Route

`frontend-v2/src/routes/_app/_admin/settings.ai_.$channelId.tsx` 拥有 UUID/search canonical、detail prefetch、tab navigation、跨域 invalidation callback 与 delete 后导航；文件名中的 `_` 让 Detail 不继承 List search schema。`settings.ai.tsx` 继续拥有 List search，只增加 Create callback。

canonical URL：

```text
/settings/ai/{lowercase-uuid}?tab=basic
/settings/ai/{lowercase-uuid}?tab=request
```

非法/缺失 tab replace 为 Basic；大写 UUID replace 为小写；未知参数移除。合法用户导航 push history。

### Query/API

扩展单一 `ai-channel.api.ts`：

```text
aiChannelKeys.lists()
aiChannelKeys.list(params)
aiChannelKeys.details()
aiChannelKeys.detail(channelId)
aiChannelKeys.models(channelId)  # Core mutation invalidation only
```

request functions 从 generated operations/schema 推导。secret/form payload 不进入 query key/data；secret mutation `gcTime: 0` 并在结束时 reset。

### Form

`ChannelConfigurationSection` 在 `basic|request` 之间保持同一 owner：baseline 来自同一次 detail revision，提交总是完整 `AIChannelUpdate`。切离配置 surface 时 `DirtyGuard` 介入；确认放弃后卸载。

409 时冻结旧 baseline 的提交资格但保留非敏感 values；只有显式 reload exact detail 才 reset。API Key/Header 409 清除 secret，metadata 可保留，用户 reload 后重新输入。

### Action

Workspace header 复用 `runAIChannelCommand`，Header 行使用 domain-local exhaustive resolver。server token 是显示资格，不替代服务端 ADMIN/CSRF/revision/state 校验。未知、重复、矛盾 token 返回明确中文 UI 错误。

## 5. Cache 与 secret

- create：invalidate all AI lists，使用安全 response seed/refetch exact detail；不失效 Prompt/Content。
- channel update/enable/disable：set exact detail，invalidate lists/models root、Prompt Preview root、Content generation-options predicate、channel logs root。
- API Key/Header create/update/delete：set/refetch detail，使用同一连接配置 invalidation 矩阵。
- channel delete：移除 exact detail/models/runtime，invalidate lists、Prompt Preview 与 generation-options；历史 Job/Version 不动。
- 409/失败：不写 cache、不 invalidate、不 replay。

API Key/Header value 只存在于输入与单次 request 变量的最短生命周期；不得进入响应、Query cache、toast、公开错误、审计、console、copy、snapshot 或 fixture 日志。Base URL 等非凭据字段可以存在于 ADMIN detail cache，但读取 cache 不得形成完整可执行请求配置。

## 6. UI 与复用

- 页面借用 Platform Workspace 的 header/tab/conflict 形态，不抽新 Workspace 组件。
- Basic/Request 复用 `DetailSection`、Form Kit、`StickyActionBar`、`DirtyGuard`。
- Header 列表复用 Table Kit/`RowActions`，移动端折叠非关键列。
- 不使用三栏 `WorkspaceShell`；当前只有单主区 tabs。
- Create/API Key/Header Dialog 都是局部 owner，关闭后销毁；focus return 与 Escape 使用现有 Dialog 能力。

## 7. Compatibility、迁移与回滚

- 这是 intentional contract break：V1 与 V2 generated types/consumer 在同 Task 原子更新；不保留 optional `value` 或 optional revision。
- 无数据库、数据迁移或部署配置变化，`contracts/database.md` 不改。
- 回滚点按合同先行、V1 consumer、V2 route/UI 分层保持可定位；未完成时不提交。若服务端 revision owner 证据与父计划冲突，停止并回到 planning。

## 8. 主要风险

- Header value 删除影响旧消费者：全仓搜索 generated operation/field consumer，双端 generate + V1 test/E2E 覆盖。
- 409 背景 refetch 覆盖草稿：form baseline 与 Query data 分离，conflict 不 invalidation，显式 reload 才 reset。
- secret 被 fixture/诊断收集：fixture 不记录 request body 字符串，使用 sentinel 对 response/DOM/console/cache/snapshot 做反向断言。
- Core review 面较大：保持一个 aggregate slice，不纳入 Models/Runtime，不建抽象或依赖。
