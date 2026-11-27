# 认证刷新跨快照 blocker 设计边界

- 当前缺陷来自客户端把两个可独立变化的服务端快照拼接成 `AuthSession`；权威修复应提供与单一已解析 session 原子绑定的认证 snapshot，而不是在客户端增加时间窗重试。
- snapshot 需要携带足以拒绝跨标签页 cookie/session 替换和 ABA 交错的 generation/binding。具体字段、endpoint 与更新规则由 OpenAPI 和后端 identity owner 共同定义。
- AuthProvider 仍负责 principal boundary commit 顺序；一旦 snapshot 表明主体或权限变化，必须先推进 epoch，再清除业务 query，最后发布新 auth state。
- 普通同主体 CSRF/revision refresh 不推进 principal epoch；这一正向合同与旧主体 continuation 拒绝必须同时有确定性测试。
- 不以服务端最终 403 代替客户端机密缓存清理：旧 ADMIN 数据已经驻留浏览器时，权限降级必须使其不可继续读取或回写。

## 已确认反例

1. `/auth/me` 先返回用户 A 的旧 ADMIN 投影。
2. `/auth/csrf` 返回前，另一管理员把 A 降为 ENGINEER；后端不因 `account_type` 更新撤销 session。
3. CSRF 请求仍成功，客户端拼出旧 ADMIN user 与当前 token，并以未变化 identity commit。
4. principal epoch 不推进，旧敏感 cache 与迟到 continuation 继续被视为 current。

跨标签页 A→B session 替换可产生同类 `user=A + csrf=B` 混合 snapshot。

## D1 实际设计

- canonical 读取已收敛为 `GET /api/v1/auth/session`，从一次已解析的 `SessionRecord + User` 返回严格 `user + csrf_token + session_binding`。
- binding 是域分离 HMAC，不返回或暴露 Session UUID/凭据，也不参与 principal identity；同主体普通 session/CSRF 变化不推进 epoch。
- AuthProvider 以 read generation 和命令 transition barrier 拒绝迟到 snapshot；主体变化继续按 epoch → 非 auth cache 清理 → session 发布提交。
- D1 定向检查和 fresh critical review 已通过；完整候选是否可交付仍由下一轮固定提交 clean-checkout `make verify` 与完整候选复核裁决。
