# L2 设计：bulk 结果精确分区与未知结果收敛

## API 边界

`user.api.ts` 在已取得原始 `items` 与目标 `status` 的位置完成结果语义校验。运行时 schema 只负责基础
字段类型，随后用请求 ID 集合验证响应为精确一一分区：每个请求 ID 出现一次且只在 success/failure 一侧；
不存在重复、交叉、遗漏和外来 ID；success 投影的 `is_active` 与请求状态一致。

该校验失败不等同于业务失败。因为请求已经发出且服务端可能已经提交，必须抛专用
`UserBulkStatusUnknownOutcomeError`，由页面在目标包含 current actor 时调用 AuthProvider-owned
reconciliation。页面不得根据空数组、错误文本或普通异常类猜测 current actor 未变更。

## 错误分类

- 合法 200 且 actor 在 success：执行 principal boundary。
- 合法 200 且 actor 精确在 failure：explicit failure，不执行 boundary。
- 语义不完整/畸形 200、无法严格匹配 OpenAPI 的 4xx、transport/abort/parse error 或意外状态：unknown，
  只执行 canonical reconciliation，不重发 POST。

严格错误信封解析以 OpenAPI 为准。`details` 是必需字段，合同外字段也不能被静默接受为“已证明未提交”。

## 验证边界

单元测试覆盖每一种集合破坏和 malformed 4xx，并精确断言 POST 次数及 boundary/reconciliation 次数。
已有真实双页面 response-loss 场景继续证明每页一次 canonical session recovery、无请求风暴、旧 ADMIN
路由/缓存/continuation 不恢复。修复后的 fixed candidate 必须重新经过全新 detached checkout 的一次完整
门禁与 fresh 独立高风险复核。
