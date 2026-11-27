# A03 设计边界

- 账号列表 query key 必须包含 platform id 与 canonical scope，只有 Accounts active 时读取。
- 行命令以当前 exact projection 派生 revision/actions/blockers；确认弹窗在 projection 移除、scope 变化或 409 后不得重放陈旧 intent。
- 账号区只消费服务端安全摘要，不扩展到 A11 之外的配置消费者。
