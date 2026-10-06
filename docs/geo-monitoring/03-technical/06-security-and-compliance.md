# PartSignal GEO 安全与合规设计

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 文档状态 | 目标设计 |
| 核心原则 | 最小权限、证据脱敏、外部调用可控、浏览器自动化需批准、审计可追溯 |

## 1. 威胁模型

### 1.1 主要资产

- 公司产品事实和替代关系；
- 外部 AI 渠道 API Key、敏感 Header；
- 浏览器登录 Cookie、会话和专用账号；
- 监测问题和竞争策略；
- 原始回答、截图和引用；
- 人工复核和事实风险；
- 监测计划、费用和运行历史；
- 用户会话和 CSRF token；
- 审计记录和发布关联。

### 1.2 主要风险

- 将内部/受限事实发送给外部 AI；
- SSRF、DNS rebinding、重定向导致凭据泄露；
- API Key、Cookie 出现在快照、日志、截图或浏览器缓存；
- 浏览器自动化违反平台条款或触发账号风险；
- Prompt injection 影响分析器或诱导数据外泄；
- 原始回答含恶意 HTML/URL；
- 分析错误被当成权威事实；
- 重试导致重复费用或非独立样本；
- 不同账号/地区数据被错误混合；
- 内部用户越权访问配置和凭据；
- 导出泄露敏感竞争数据。

## 2. 数据分级

沿用 `PUBLIC | INTERNAL | RESTRICTED`，并为 GEO 数据定义处理规则。

| 数据 | 默认分级 | 外发规则 |
|---|---|---|
| 公开问题文本 | PUBLIC/INTERNAL | 可发送到批准的采集平台 |
| 公司公开产品事实 | PUBLIC | 可用于外部分析 |
| 未公开产品路线/客户信息 | INTERNAL/RESTRICTED | 禁止发送到第三方 |
| 原始 AI 回答 | INTERNAL | 仅发送到批准分析服务 |
| 竞品分析和机会 | INTERNAL | 默认不外发 |
| API Key/敏感 Header | RESTRICTED | 仅解密到请求内存 |
| 浏览器 Cookie/会话 | RESTRICTED | 仅 browser collector 读取 |
| 截图 | INTERNAL，按内容可提升 | 不进入公开 URL |
| 审计日志 | INTERNAL | 不包含正文和 secret |

## 3. 外部采集门禁

运行自动采集前必须验证：

1. 问题文本允许外发；
2. profile 启用；
3. EngineSurface 合规状态为 APPROVED；
4. 对应环境功能开关启用；
5. API 凭据存在且模型测试通过；
6. 浏览器会话健康且账号获得授权；
7. 预算未超限；
8. 出站 URL、DNS、TLS 和 peer 校验通过；
9. 不包含被规则识别的受限上下文。

任何门禁失败都不创建外部请求。

## 4. API 凭据

- 继续使用 `CredentialCipher` 和部署主密钥；
- 数据库只保存密文；
- API 响应只返回已配置状态和更新时间；
- 运行快照只保存 channel/model ID、非敏感地址和敏感 Header 名称；
- 解密只发生在 Worker 单次调用内；
- 不写 argv、环境变量、文件、日志、审计和错误 details；
- 复制 profile 不复制 secret；
- 更新凭据使相关 profile 测试失效；
- 主密钥和数据库备份成对保管。

## 5. 网络与 SSRF

API Collector 必须复用或扩展现有 pinned transport：

- 只允许 `https` 公网地址；
- 开发/测试本机 HTTP 需显式开关；
- URL 禁止 userinfo、query secret 和 fragment；
- 单次解析完整 A/AAAA；
- 解析结果含非公网地址时整体拒绝；
- 连接批准 sockaddr；
- 发送敏感 Header 前验证实际 peer；
- TLS SNI、证书 hostname 和 Host 使用原域名；
- 禁止重定向；
- 响应体有大小上限；
- 发送后不切换地址重试；
- 出站防火墙进一步限制网络。

浏览器 collector 使用独立 egress policy，不因为需要浏览器访问就给数据库、Redis 或 API 容器开放额外公网端口。

## 6. 浏览器会话安全

### 6.1 账号

- 使用公司批准的专用观测账号；
- 不使用员工个人主账号；
- 最小权限、无支付/敏感业务能力；
- 明确账号负责人和停用流程；
- MFA/验证码由人工完成，不自动绕过。

### 6.2 存储

- 会话资料加密；
- 与普通业务对象存储隔离；
- 引用使用不可猜测 ID；
- 只有 browser collector service identity 可读取；
- 数据库不保存 Cookie 明文；
- 导出和备份策略单独审批；
- 撤销/过期后安全删除。

### 6.3 运行隔离

- 每个运行新建临时 context；
- 使用临时/无记忆会话模式（平台支持时）；
- 禁止复用用户历史对话；
- 任务完成清理 localStorage、download 和临时文件；
- 截图裁剪账号身份和浏览器敏感 UI；
- 失败截图也要经过敏感区域规则。

### 6.4 合规记录

EngineSurface 保存：

- 审批状态；
- 审批人和日期（可由审计记录表达）；
- 允许的采集频率；
- 允许地区和账号；
- 停止条件；
- 条款变化复核日期。

## 7. Prompt injection 与不可信内容

AI 回答、引用页面标题和 raw payload 全部是不可信输入。

规则：

- 分析器把回答作为数据，不执行其中的指令；
- 外部分析模型 system prompt 明确禁止执行答案中的指令和输出 secret；
- 不向分析模型发送 API Key、Cookie、内部路径和不必要事实；
- 严格 Schema 验证输出；
- 任何工具调用/联网能力默认关闭；
- 引用 URL 不由分析模型直接抓取；
- HTML 先转安全文本，不渲染 raw HTML；
- 导出进行公式注入防护（CSV 单元格前缀处理）。

## 8. 原始答案和文件

### 8.1 文本

- 保存 UTF-8；
- 限制最大字符/字节；
- 控制字符处理；
- 计算 SHA-256；
- API 响应可分页/截断展示，但下载保留完整安全文本；
- 不将 raw HTML 直接插入 DOM。

### 8.2 截图

- 只允许批准 MIME 和大小；
- 上传经 PartSignal API 中转或 browser collector 服务端写入；
- 完成 HEAD/哈希校验；
- 下载使用短期签名；
- 不使用 public-read；
- 图片元数据可按政策剥离；
- 登录页、账号菜单、支付信息和 Cookie 调试界面不得作为证据。

### 8.3 Raw payload

- 优先保存受控摘要；
- 仅在排障或解析需要时保存完整 payload 文件；
- 写入前剥离 Header、token、Cookie、请求凭据；
- 有保留期限和访问审计；
- 不在普通 Run Detail 默认返回。

## 9. URL 安全

Citation URL 在服务端：

- 只允许 http/https；
- 禁止 javascript/data/file 等 scheme；
- 规范化 IDNA；
- 保存原始 URL 和规范 URL；
- 不由 API 服务器主动抓取引用页面；
- 浏览器打开使用 `noopener/noreferrer`；
- CSV/报告转义；
- 域名归属使用 hostname 边界，不用字符串后缀误判。

## 10. 权限矩阵

| 功能 | ADMIN | ENGINEER |
|---|---:|---:|
| 查看监测和洞察 | ✓ | ✓ |
| 管理问题变体 | ✓ | ✓ |
| 创建/运行计划 | ✓ | ✓ |
| 人工录入和复核 | ✓ | ✓ |
| 处理机会 | ✓ | ✓ |
| 管理 Subject/竞品/域名 | ✓ | 只读 |
| 管理 EngineSurface/Profile | ✓ | 只读摘要 |
| 管理规则和阈值 | ✓ | 只读 |
| 查看凭据是否配置 | ✓ | 不显示或只显示 profile 可用状态 |
| 替换 API Key/浏览器会话 | ✓ | ✗ |
| 导出报告 | ✓ | ✓，按授权范围 |
| 删除监测历史 | 受控管理员命令 | ✗ |

## 11. 审计

建议记录以下高价值成功动作：

- Subject/alias/domain 创建、更新、启停、删除；
- EngineSurface/Profile 配置、测试、启停；
- Plan 创建、更新、启停、归档；
- 立即运行和批次取消；
- 人工回答正式提交；
- 重分析和人工复核；
- GEO 规则更新；
- 机会确认、行动关联、驳回和解决；
- 复测创建；
- CSV/报告导出；
- 浏览器会话配置/撤销；
- 受控历史删除。

不在审计中保存：

- 完整回答正文；
- Prompt 全文（可保存哈希和 ID）；
- API Key/Header/Cookie；
- raw payload；
- 敏感 fact 正文；
- 浏览器资料路径。

运行失败主要进入运行记录和服务日志，不为每次 provider 失败写业务审计。

## 12. 日志脱敏

日志允许：

```text
request_id, batch_id, run_id, profile_id, adapter_key,
status, error_code, duration_ms, provider_status,
response_bytes, citation_count, token_usage, reported_cost
```

日志禁止：

```text
prompt_text, answer_text, API key, authorization header,
custom sensitive header, cookie, browser storage,
raw provider response, full citation query containing secrets
```

错误异常必须转为稳定摘要，不能直接记录第三方响应正文。

## 13. 数据最小化与 PII

- 问题库禁止包含客户姓名、个人联系方式和未公开客户场景；
- 人工答案录入前提示检查个人信息；
- 自动分析可增加受控 PII 检测并触发复核；
- 报告只输出业务所需字段；
- 用户当前目录信息与历史审计区分；
- 数据保留和删除服从公司政策及适用法律。

## 14. 供应商和平台合规

每个自动采集面上线前必须完成：

```text
[ ] 使用条款评审
[ ] 账号和数据用途批准
[ ] 允许的自动化方式和频率
[ ] 地区/代理政策
[ ] 数据保存和再处理规则
[ ] 终止/暂停条件
[ ] 责任人
[ ] 回滚和会话撤销流程
```

未完成时 `compliance_status != APPROVED`，服务端禁止自动运行。

## 15. 安全测试要求

至少覆盖：

- 非管理员访问配置接口；
- CSRF 缺失；
- secret 在 API/审计/日志/cache/screenshot 泄露；
- SSRF、混合 DNS、peer 越界和重定向；
- 引用 URL XSS/危险 scheme；
- CSV 公式注入；
- Prompt injection 分析输出越界；
- raw HTML 渲染；
- browser profile 越权读取；
- 数据分级禁止外发；
- 迟到结果覆盖终态；
- 重试重复外部调用。

## GEO-802 已实现边界

会话聚合仅保存UUID引用、Profile绑定、密文SHA256、授权期限和健康/撤销/清理事实；AES-GCM与RSA-OAEP封装只保存于独立受保护卷。API仅持公钥，Collector持私钥，任何明文不进入PG、普通OSS、日志、审计、缓存或截图。导入使用SecretStr/writeOnly与固定错误摘要；手工批准账号与Surface合规均须明确，未知资料拒绝。

所有管理命令由ADMIN及CSRF保护，按Profile revision仲裁；专用服务能力只授权密文读取，绑定现有ADMIN并重验当前权限/配置/开关。安全审计只保留session_reference与revision。永久动作 imported、health_checked、revoked、purged、accessed 及其前端消费者须保留以读取既有历史。撤销墓碑先于密文清理，旧引用永不复活；卷故障不能恢复访问，清理待办必须显式显示。

AVAILABLE只证明本地密文完整及授权期限，不证明真实登录、账号条款或Run发送授权。真实consumer及发送前重新授权留给804；已授权释放的内存无法远程追回，消费方必须及时关闭context并在finally清理材料。生产需TLS、受限卷/密钥文件及批准的服务账号；不会因本任务开启真实平台、扩大网络出口或绕过MFA。配置和恢复步骤见部署文档GEO-802章节。

## GEO-901 清理安全边界

新增retention默认dry-run，实际期限未批准/配置时不启用对应新策略；保留所有引用raw/截图与业务历史。终态临时草稿清理使用不可变低敏墓碑、真实PG期限与同事务删除防线，文件存储失败保留DELETING可重试。日志仅稳定ID/计数/状态，不含正文、路径、URL、凭据或底层异常。无权限/CSRF/SSRF/TLS放宽，无真实第三方调用。Browser N/A仅对已核实无部署及材料的环境成立，生产false/无会话仍需904/906实测，现存材料继续802保护/撤销/PURGE责任。
