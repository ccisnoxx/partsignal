# 技术设计

## 合同与服务端

新增 `GET /api/v1/content-tasks/creation-options?requested_product_id=<uuid>`，权限与创建命令相同。响应为：

- `products[]`: `id/brand/part_number/approved_fact_versions[]`；Fact 只含 `id/version/classification`。
- `platforms[]`: `id/name`。
- `requested_product | null`: `product_id/brand?/part_number?/eligibility`，eligibility 为 `ELIGIBLE | NOT_FOUND | PRODUCT_INACTIVE | NO_APPROVED_FACTS`。

读模型在 `REPEATABLE READ` 中使用固定 set-based 查询：Product + 合格 Fact 一条，活动 Platform 一条；存在 handoff 时最多再读一次指定 Product。Product 按 `lower(brand), lower(part_number), id`，Fact 按 `version DESC, id`，Platform 按 `lower(name), id` 排序。响应不含 Markdown、Prompt 或生成上下文。

POST body 与 response 不变。创建命令继续先获取 idempotency advisory lock，再按 `Platform -> Product -> Fact` 顺序 `FOR UPDATE`，重新校验活动平台、活动产品、同产品 APPROVED 且非空事实后插入。数据库 Fact/Platform trigger 保持最终保护；options 不是安全控制。

## URL 与表单状态

- Route search 只拥有可选 `productId`。合法 UUID 规范为小写；非法值保留为明确错误状态且不发非法 API 请求。
- options 的 `requested_product` 决定 handoff 反馈；只有 `ELIGIBLE` 使用 `form.reset()` 预选。
- 用户选择其他 Product 时写入新的 URL 历史项；Product change 同步清空 Fact，保留 Platform。Fact/Platform 不进入 URL；Back/Forward 只恢复 Product，不重建整个表单。
- Form schema 只产生 generated `ContentTaskCreate` 三字段。客户端选择范围来自 options，POST 仍接受服务端最终拒绝。

## Idempotency-Key

页面 `useRef` 保存 `{payloadSignature,key}`。第一次有效提交以三个 UUID 的固定顺序签名并调用 `crypto.randomUUID()`；相同签名失败重试复用，签名变化生成新 key。`IDEMPOTENCY_CONFLICT` 和成功后清除 ref；pending guard 保证双击只发送一次。

## 成功与错误

成功顺序：`form.reset -> clear key -> invalidate contentKeys.lists -> navigate /content/tasks with one-shot history state`。列表消费 state，显示 `role=status` 后清除；不导航详情。

`VALIDATION_ERROR.details.errors` 仅映射三个已知 body 字段；其他结构化错误进入 form summary，request ID 独立展示。失败保留当前选择。Options 错误使用 retry；无 Product/Facts/Platform 提供现有业务路由。

## 组件层级与兼容性

```text
NewContentTaskRoute
└── NewContentTaskPage
    ├── Header / OptionsState / HandoffState
    └── FormProvider
        ├── ErrorSummary
        ├── FormSection
        │   ├── Product FormField + Select
        │   ├── Approved Fact FormField + Select
        │   └── Platform FormField + Select
        ├── FormActions
        └── DirtyGuard
```

新增 endpoint 只供 V2 使用；V1 仅重新生成类型。无数据库 migration、新依赖或新架构层。

## 文档决定

- 更新 Frontend V2 `03`，删除旧 New Task 字段。
- 在 `05` 记录 creation-options、URL/幂等与服务端最终资格。
- 在 `08` 记录 Phase 3.2 fixture 与 real-stack 覆盖；完成后更新 `07` Phase 3 状态。
- ADR-015 已覆盖 Read Model 决策，不新增 ADR；`docs/architecture.md` 模块边界不变。

## 审计结论、风险与后续

- API gap：现有 Product list 只投影 latest fact，不能同时保证活动 Product、任意非空 APPROVED FactVersion 和活动 Platform；逐产品 FactVersion 请求会形成 waterfall，因此采用上述最小 read model。
- 旧蓝图冲突：Topic/GEO Source、Content Intent、audience、angle、conversion goal、format、length、generation/manual mode、notes、Prompt、AI model 均不属于当前三字段合同；蓝图改为权威合同，不恢复旧模型或第二 DTO。
- 数据流：route search `productId` → Content creation-options query → Product Select → 当前 Product 的 Fact Select；Platform Select 与 Product 独立。提交只生成三字段 payload，服务端持锁复核后返回 canonical ContentTask。
- V1 兼容：不修改 V1 行为，只同步 generated type；旧 V1 创建表单仅作为幂等与三项选择的行为证据。
- 风险：options 读取后资源可能失效，由 POST 最终校验并保留用户选择；URL Back/Forward 可能先命中缓存，由 `requested_product` 身份匹配后再同步 Product；真实栈缺少 V2 平台配置页，只用既有 API 建立唯一活动平台前置数据。当前无实施阻塞项。
- 推荐下一 Task：`frontend-v2-content-task-detail`，只实现 canonical Task Detail 与服务端投影消费；Editor、Generation、Manual Draft、Review 和 Publication 继续拆分。
