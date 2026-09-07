# 普通 Content Task 数据库规范定向上下文

## 用途

`.trellis/spec/backend/database-guidelines.md` 超过当前 sub-agent context injection 单文件上限。本文件只为实施与检查代理提供本任务直接相关的定向索引；修改稳定规范前仍须读取原文件中对应完整小节。

## 当前稳定规则

- `.trellis/spec/backend/database-guidelines.md:499-501`：普通任务请求 body 为 `product_id`、`fact_version_id`、`platform_profile_id`，`Idempotency-Key` 长度 8–128；当前文字为同键同三字段 replay、异载荷 `409 IDEMPOTENCY_CONFLICT`。
- `.trellis/spec/backend/database-guidelines.md:512-515`：普通创建先获取 PostgreSQL transaction advisory lock，再读取唯一 key；replay 无额外副作用，Redis 不保存幂等状态，响应不暴露 key。
- `.trellis/spec/backend/database-guidelines.md:534-556`：失败矩阵和 integration 要求覆盖同键异载荷、资格校验与并发只创建一行。

## 本任务需要补齐的稳定规则

- ordinary canonical identity = 三个目标字段 + 不存在 `ContentTaskGeoSource`；GEO winner 不得被普通 command replay。
- 数据库最终映射只接受 `error.orig.sqlstate == "23505"` 与 `error.orig.diag.constraint_name == "uq_content_tasks_idempotency_key"`。
- 普通 caller 在 exact constraint 后 root rollback，再按 key 查询并验证 winner；same ordinary identity replay，可证明不同 identity 或 GEO source kind 使用既有 `IDEMPOTENCY_CONFLICT`。
- winner 缺失、identity 不可验证、diagnostics 缺失、非 `23505` 或其他 constraint 时原样重新抛出最初的 `IntegrityError`。
- 正常同 key 并发仍由 advisory lock 串行并走普通 lookup；不得把受控 exact-constraint sentinel 写成正常生产 race。
- known/unknown 失败不得留下候选 task、版本、事实、审核、pointer/revision、审计或 dispatch 副作用。

## 修改限制

只在原稳定规范的普通 Content Task 创建小节补充上述事实，不写入 test-only 同步实现，不扩大到 GEO incoming policy、publication repair、Generation Job 或全局 mapper。
