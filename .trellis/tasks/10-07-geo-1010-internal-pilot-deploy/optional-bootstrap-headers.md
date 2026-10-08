# 首次 AI 初始化的可选 Header

用户原文：需要自定义 Header，但是自定义 header 不是必须，应该是可选配置才对。

配置中心已有 Header CRUD、校验、普通/敏感存储、连接测试与生成快照合同；缺口仅在首次 Production maintenance bootstrap。此前严格 envelope 拒绝 Header，准备清单的 `custom_headers_required=true` 被 `AI_CUSTOM_HEADERS_UNSUPPORTED` 拒绝。该限制由本次可选输入替代，不修改 HTTP API、数据库结构或前端。

## 输入与职责

- backend 严格 stdin envelope 接受可选 `headers`，省略或 `[]` 表示无 Header；每项仅 `name/value/is_sensitive`。复用既有 Schema、Header 校验和 record-bound AES-GCM，不接收客户端 revision，不打印输入或异常正文。
- 既有 Header service 提取无 commit 事务参与函数；HTTP wrapper 保留提交合同。T1 按 channel → Headers → model 顺序创建并冻结最终 revision；Header 行与脱敏 SUCCESS audit 同事务。T2 仍只测试一次完整配置，T3 仍原子启用。
- Host 参数只接收可选名称：普通 `--header-name`、敏感 `--sensitive-header-name`，均可重复指定。API Key 后按普通/敏感顺序无回显读取值，全部通过同一 stdin pipe 交接；不写 argv、环境、文件、state 或日志。
- 本地非 secret 清单以可选 `custom_headers` 元数据数组替代旧布尔字段。每项仅名称、敏感标记、值 JSON 编码上界；空/省略无需额外交接。预检用合成值调用真实严格 reader，计算包含所有值上界的完整 64 KiB envelope。Host 在写 STARTED 前检查实际完整大小、名称和值字符及读取是否成功。

## 验证与现场边界

选择现有 CLI 单元边界、Host 输入/state/真实 PTY 边界、准备检查 subprocess 与真实 PostgreSQL bootstrap 集成边界验证。真实 provider 请求、Host 清空/安装、UI E2E和完整候选 Gate不在本次局部验证中伪造通过。PostgreSQL/Docker 当前不可用，数据库集成验证和新候选完整 Gate需在可用环境继续执行。

该变更仍属于已授权 DEPLOY 准备，main commit/push/fetch 按当前会话授权执行。独立只读复核关注 T1 事务、加密/脱敏、Host no-echo/stdin 与 STARTED 顺序。具体结果另存验证证据；未闭合凭据/操作者/窗口/现场阶段不自动标为就绪。

受保护 `.env.production.ai.json` 没有被改写。其旧 `custom_headers_required` 不能推导真实 Header 名称、敏感标记或值预算；新版只读检查返回 `AI_KEY_SET_MISMATCH`，需要按新输入合同更新元数据。保留之前尚未确认的 credential ready/owner/TTY/编码上界，不代填任何真实值或就绪确认。Header 支持需求已明确为可选，不再等待此前二选一澄清。
