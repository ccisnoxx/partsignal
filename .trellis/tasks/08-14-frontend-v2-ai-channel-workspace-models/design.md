# Frontend V2 AI Channel Workspace Models 设计

## 1. 设计结论

本 Task 以 `AIModel` resource 为唯一 vertical slice：先收紧 discovery/test/delete revision 与 model no-op 合同，再原子同步后端、V1 直接消费者和 V2 Models UI。复用现有 AI endpoint、`ai-channel.api.ts`、Workspace route/page、`TableShell`、`RowActions`、Form/Dialog primitives、Prompt/Content cache keys；不新增聚合 API、数据库结构、依赖、全局 store 或通用 Model Registry。

Core 的配置表单当前由整个 Workspace page 持有。开放 Models 后，唯一必要的局部结构调整是把该 form owner 收进只在 `basic|request` 挂载的配置 surface；否则确认离开后会留下隐藏 dirty state。该调整保持 Core 行为，不创建通用 Workspace abstraction。

## 2. 边界与数据流

```text
?tab=models
  -> route delivered gate 放行 models
  -> AIChannelWorkspacePage 读取既有 channel detail
  -> AIChannelModelsSection active 时读取 aiChannelKeys.models(channelId)
       -> discovery Dialog（channel revision，一次 Provider 调用，局部结果）
       -> create/edit Dialog（create 无 revision；update 用 model revision）
       -> test Dialog（model revision，一次 Provider 调用）
       -> enable/disable/delete（model revision）
       -> server canonical AIModel / explicit 409
  -> bounded AI/Prompt/Content cache invalidation
```

服务端调用边界：

```text
discovery:
  lock/read channel -> compare expected channel revision -> copy request config -> commit
  -> Provider call once
  -> expire/re-read channel -> compare same revision -> return transient IDs

model test:
  lock channel -> model -> compare expected model revision -> copy request config -> commit
  -> Provider call once
  -> expire/re-lock channel -> model -> compare channel + model snapshots
  -> write PASSED/FAILED, force disabled, increment model revision
```

外部 I/O 不持有数据库行锁；开始发送后不 retry。调用后 revision 变化只能丢弃结果并返回 409，不能把旧结果写回或展示为成功。

## 3. Core 后的实际差距

| 主题 | 当前 `main` | 本 Task 目标 |
| --- | --- | --- |
| route | parser 识别 models，但 delivered gate 返回 404 | 只新增 models；usage/logs 继续 404 |
| V2 API | 只有 `aiChannelKeys.models(channelId)` 占位 | 增 models query + discovery/CRUD/test/toggle/delete typed request |
| Workspace form | Basic/Request form owner 常驻 page | 仅配置 surface 挂载，离开后卸载 dirty owner |
| discovery | POST 无 body；真实调用无 revision 复核 | required channel revision，调用前后复核 |
| model test | POST 无 body；只在调用后复核内部 snapshot | required model revision，调用前先比较，再保留双复核 |
| model delete | 无 revision | required model revision query |
| model toggle | 有 model revision，但允许 no-op | revision 后拒绝同态 |
| V1/direct tests | 无 discovery/test/delete revision | 原子同步真实 current revision |

## 4. OpenAPI 与 backend 合同

| 命令 | Revision owner | Request | 服务端检查 | 失败 |
| --- | --- | --- | --- | --- |
| discover | channel | required `RevisionRequest` body | Provider 调用前后比较 channel revision | `REVISION_CONFLICT`；不返回结果 |
| create model | 新资源 | 现有 `AIModelCreate` | channel 存在、现有校验/约束 | 不伪造 revision |
| update model | model | 现有完整 `AIModelUpdate` | channel → model 锁序后比较 model revision | `REVISION_CONFLICT` |
| test model | model；内部另 snapshot channel | required `RevisionRequest` body | 调用前 model；调用后 channel + model | `REVISION_CONFLICT`；不写测试结果 |
| enable/disable | model | 现有 `RevisionRequest` body | revision、测试门禁、目标非同态 | `INVALID_STATE_TRANSITION` 或现有领域错误 |
| delete model | model | required `expected_revision` query | channel → model 锁序后比较 model revision | `REVISION_CONFLICT`；不审计/删除 |

`AIModelCreate/Update/Out/List` 与 token union 保持唯一模型类型系统。discovery/test 不新增审计或 Usage；model CRUD/toggle 继续沿用当前脱敏审计。`contracts/database.md` 不变。

## 5. V2 所有权

### 5.1 Route 与 tab

- `settings.ai_.$channelId.tsx` 继续拥有 UUID/search canonical、detail prefetch 和跨域 consumer invalidation。
- `isDeliveredAIChannelWorkspaceTab` 扩为 `basic|request|models`；search shape 不变。
- `onTabChange` 接受 `models`。从 dirty Basic/Request 前往 Models 仍由 `DirtyGuard` 阻断；确认放弃后配置 surface 卸载。
- `usage|logs` 仍进入现有 notFound，不渲染占位 section。

### 5.2 API 与 query

继续扩展一个 `ai-channel.api.ts`：

```text
aiChannelKeys.models(channelId)
aiChannelModelsQueryOptions(channelId)
discoverAIChannelModels(channel, csrfToken)
createAIModel(channelId, payload, csrfToken)
updateAIModel(model, payload, csrfToken)
testAIModel(model, csrfToken)
runAIModelCommand(enable|disable|delete, model, csrfToken)
```

函数参数直接使用 generated schemas/operations 的真实 shape。所有 query/mutation `retry: false`；revision 在用户动作开始时从当前 canonical row/channel 读取，不额外 GET 猜值。

### 5.3 Component

```text
AIChannelWorkspacePage
├─ Workspace Header / channel command owner
├─ AIChannelConfigurationSurface [basic|request only]
└─ AIChannelModelsSection         [models only]
   ├─ section heading + Discover / Add capability
   ├─ loading / empty / error / refresh
   ├─ TableShell + ModelRow + RowActions
   ├─ DiscoverModelsDialog
   ├─ ModelDialog (create/edit)
   └─ TestModelDialog
```

`AIChannelModelsSection` 是 domain-specific 稳定 ownership boundary，可以独立文件实现；它必须包含真实 query/mutation/dialog 责任，不能是薄转发 wrapper。表单 schema、payload mapping 与 action resolver 留在现有 `ai-channel-workspace.model.ts`，不建第二 model 层。

## 6. 表单与局部状态

| 状态 | Owner | 生命周期 | Query cache |
| --- | --- | --- | --- |
| discovery result | discovery Dialog | 打开后由明确确认产生；关闭销毁 | 不写 |
| create draft | Model Dialog | 关闭销毁；discovery 可预填 ID/显示名 | 不写 |
| edit draft | Model Dialog + baseline model revision | 409 保留并锁定旧 revision；显式 reload 后重置 | 成功才用 canonical response |
| test target | Test Dialog | confirm 后 single-flight；结束关闭/展示结果 | 成功 canonical model 可更新 |
| delete/toggle target | row action | 当前 canonical row revision | 成功后更新/移除 |

`request_parameters_json` 先用 `JSON.parse`，再要求 plain object、拒绝 array/null 和 reserved keys `model/messages/stream`。这只是前端表单反馈；后端 Pydantic 仍是最终边界，不复制 Provider-specific 参数 schema。

## 7. 服务端 action authority

### Channel capability

- `DISCOVER_MODELS` 与 `CREATE_MODEL` 只决定 Models section 是否显示对应入口。
- Workspace Header `TEST_MODEL` 变为 `show-models`，不再使用 disabled future handoff。
- 不在 Header overflow 和 section heading 重复同一 discovery/create 高频入口。

### Model rows

| `primary_task` | UI target |
| --- | --- |
| `TEST_CONNECTION` | 打开真实测试确认 |
| `VIEW_FAILURE_AND_RETRY` | 展示安全失败摘要并确认重新测试 |
| `ENABLE_MODEL` | 发送 enable + current model revision |
| `ENABLE_CHANNEL` | 复用现有 channel enable command owner |
| `VIEW_MODEL_RUNTIME` | Runtime 未交付时禁用并说明原因 |

overflow 只映射 `UPDATE/TEST/ENABLE/DISABLE/DELETE`，与 primary 同义动作去重。resolver 检查 unknown、duplicate 及明显矛盾 token，但命令资格最终仍由服务端 revision/state 校验；前端不从字段生成缺失动作。

## 8. Cache invalidation

| 成功事件 | AI list/detail/models | Prompt Preview | Content generation-options | channel logs | Usage/历史 |
| --- | --- | --- | --- | --- | --- |
| discovery | 不变 | 不变 | 不变 | 不变 | 不变 |
| model create | invalidate list/detail/models | 不变 | 不变 | invalidate | 不变 |
| model update | invalidate list/detail；canonical update/refetch models | invalidate root | predicate invalidate | invalidate | 不变 |
| model test | invalidate list/detail；canonical update/refetch models | 不变 | 不变 | 不变 | 不变 |
| enable/disable/delete | invalidate list/detail；canonical update/remove/refetch models | invalidate root | predicate invalidate | invalidate | 不变 |
| 409/失败 | 不写、不失效 | 不变 | 不变 | 不变 | 不变 |

不刷新 Prompt detail/list、Content task/editor/history、Generation Job/Version history 或 Usage。Models query 只有一个 owner，不创建局部 key 或跨页 optimistic patch。

## 9. Provider、安全与错误边界

- API Key/Header value 只在后端真实调用栈短暂解密；V2 Models 从不读取或持有它们。
- discovery result 只有 model ID/configured/primary task；test result 只有安全 `AIModel` 投影和公开摘要。
- AppError message 不拼接 URL、请求 Header、request parameters 或 Provider body；fixture 不记录 request body 字符串。
- pending gate 与 React Query `retry: false` 防浏览器重复；服务端遵循开始发送后不自动 retry 的既有 AI 网络合同。
- fixture 使用公开 `.invalid`/假 model ID 与 secret sentinel 反向断言，只证明 production UI；真实协议由现有本机 Provider E2E 证明。

## 10. Compatibility、文档与回滚

- required request 是 intentional contract break；OpenAPI、runtime、双端 generated types、V1/V2 直接调用者在同一 Task 更新，不保留 optional body/query。
- 更新 AI backend spec 与 Frontend Workspace state spec；Frontend V2 02/03/05/07/08/09 只改 Models 已交付、revision/action/cache/test 的权威事实。
- 无数据库、数据迁移、部署或 dependency 变化；回滚按 contract/backend、V1 consumer、V2 Models 三层定位，但交付提交必须保持合同与所有消费者原子一致。

## 11. 测试分层

- backend contract：冻结三项 required revision 与响应错误矩阵。
- backend PostgreSQL integration：验证锁序、stale/no-op、调用次数、调用期间变化、状态/审计/secret。
- V1 component/E2E：验证旧消费者同步且本机 Provider 真实 discovery/test 仍工作。
- V2 model/component：验证 JSON/action/query/mutation/conflict/cache 与 Core form 回归。
- V2 strict fixture E2E：验证 production build、route、UI、四档响应式、keyboard/focus、未知 API 和 sentinel；不声称真实 Provider。
- V2 real-stack direct consumer 由 typecheck 保证合同同步，完整真实栈运行保留为 optional/后续 Configuration E2E。

## 12. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 打开 Models 后隐藏 dirty form 常驻 | 配置 surface 自己拥有 RHF，并只在 basic/request 挂载 |
| revision owner 混用 | discovery 只用 channel；既有模型命令只用 model；create 不带 revision |
| Provider 重复调用 | 显式确认、pending single-flight、client/server 无 retry、调用次数断言 |
| 合同收紧遗漏动态 E2E 调用 | 全仓搜索 endpoint 字面量和动态 URL；V1 setup 依赖与 V2 real-stack 同步 |
| action UI 重建业务状态 | typed resolver 只消费 token；服务端命令重验事实 |
| workspace page 继续膨胀 | 只拆一个有真实 query/mutation/dialog ownership 的 Models section；不抽通用框架 |

## 13. Ponytail 约束

- 沿用现有 endpoint、generated types、AI API owner、route、cache keys、Table/Form/Dialog/RowActions。
- 只增加 Models 所需的一个 domain-specific section；不增加 registry、adapter、factory、generic CRUD hook、全局 store 或新依赖。
- 不实现搜索、分页、批量、默认模型、自动流程、复制配置或 Provider-specific form；真实需求出现后再单独规划。
