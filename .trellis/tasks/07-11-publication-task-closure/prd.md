# 发布与任务闭环完整性

## Goal

建立内容任务、发布账号、发布状态和修复流程之间的唯一业务不变量，确保任务只有在发布验证闭环完成后自动结束，后续异常可处理且历史不被改写。

## Requirements

- 发布账号所属平台必须与内容任务锁定平台一致，由服务端最终校验。
- 第一条关联发布达到 `VERIFIED` 时，仍为 `OPEN` 的任务自动转为 `COMPLETED`，不保留人工完成入口。
- 任务存在 `PENDING_MANUAL_PUBLISH`、`PLATFORM_REVIEW` 或 `PUBLISHED` 发布时不得取消，必须先显式处置在途发布。
- `COMPLETED` 是历史终态；发布后来变为 `REMOVED` 或 `VERIFICATION_FAILED` 时任务不回退，只进入异常待办。
- 异常待办不自动创建内容任务；用户判断后才能显式创建修复任务。
- 异常待办拥有独立的 `OPEN → RESOLVED` 生命周期；创建修复任务只建立关联，用户完成实际处置并填写非空说明后才能显式解决。
- 修复任务继承原产品、问题和平台上下文，但必须显式选择当前 `APPROVED FactVersion` 与当前 `ACTIVE PlatformProfileVersion`，并展示各自与原版本的差异。
- 修复任务固定继承原产品、目标问题和平台；受众、内容角度、转化目标、格式、长度和 `canonical_url` 从原任务预填但允许编辑。
- 上线前只读检查必须识别跨平台错绑和缺少 `VERIFIED` 发布的旧 `COMPLETED` 任务，输出稳定 ID 与原因并阻断上线；只能由用户逐条处置，不自动改绑或回退历史。

## Acceptance Criteria

- [x] 跨平台账号发布被事务性拒绝，同平台不同账号可以发布，前端只显示匹配账号和锁定平台。
- [x] 首条发布转为 `VERIFIED` 后任务自动完成，重复或并发操作不会重复转换，状态事件和审计完整。
- [x] 没有 `VERIFIED` 发布的任务不能完成，现有人工完成 API 与 UI 不再形成第二入口。
- [x] 存在在途发布的任务不能取消；终态失败发布不会被误判为在途。
- [x] 发布后续失效时任务保持完成，工作台出现包含原因和原记录上下文的异常待办。
- [x] 用户可从异常待办显式进入修复任务创建，缺少当前事实或平台活动版本时明确阻止，不静默复用旧版本。
- [x] 原产品、目标问题和平台不能在修复流程中漂移；其余策划字段预填且可编辑，事实与平台规则版本必须重新选择。
- [x] 修复任务创建后待办仍保持 `OPEN`；只有带非空处置说明的显式解决命令可以转为 `RESOLVED`，历史关联持续可查。
- [x] 迁移前显式审计已有跨平台错绑，不自动改绑历史数据。
- [x] 任一未处置历史不一致都会阻止上线，处置后重复检查可通过且原历史仍可追溯。

## Dependencies

- 本任务应先于 `07-11-geo-integrity-analysis` 完成契约与状态语义设计。

## 最终计划同步

- 有效优先级：`P0`；属于最终执行顺序 Goal 2，必须等待 Goal 1 完成。
- 与 `07-11-review-evidence` 在 Goal 2 共用一次 OpenAPI 冻结，但发布状态机、异常待办和修复任务仍由本任务唯一拥有。
- 已确认删除 `POST /content-tasks/{id}/complete`，不保留兼容入口；任务只能由首条关联发布 `VERIFIED` 自动完成。
- 已确认公共读取/命令契约包括专用 `PublicationCandidate`、`PublicationRecord.task_id`、服务端 `available_actions`、异常列表/详情、修复上下文、创建修复任务和显式解决。
- 已确认数据库变更为 `0013_publication_closure`：新增 `publication_attentions`、`content_tasks.source_publication_attention_id`、唯一约束、状态保护和发布平台一致性触发器。
- 父任务拥有只读 `preflight-integrity` CLI；本任务负责其中旧 COMPLETED 无 VERIFIED 和非终态跨平台发布检查。
- 完成后必须停止并等待用户启动 Goal 3，不自动提交或推送。
