# 设计：PageSpeed 与全域安全闭环

## 任务结构

- 父任务只持有跨子任务事实、授权、最终集成验证和关闭矩阵。
- P0 子任务负责 CSP、Trusted Types、域名/证书/HTTPS、HSTS 与 preload。
- P1 子任务负责 coverage、初始包/CSS、长任务、加载链、LCP 和 DOM。
- P2 子任务负责 Baseline、source map、SEO、Agentic、无障碍和结构化数据。

该拆分对应三个可独立验证的交付物；HSTS 观察期可能持续数月，不应阻塞前端
性能和兼容性工作的独立检查。

## 权威边界

- PageSpeed：只使用 `ibm9s8ga5b`；旧报告不得复制为新验收证据。
- 前端行为：`frontend/src`、`frontend/index.html`、Vite 构建及现有测试。
- PartSignal 安全头：仓库 `deploy/nginx/partsignal-security-headers.conf`。
- 域级 HSTS：新增一个仓库内版本化的 `962850.xyz` 域级 snippet，部署后由
  所有实际 TLS 终止 vhost 引用；移除站点各自的 HSTS 第二事实源。
- API/数据库：不改变 OpenAPI 或数据库契约。

## 公开面与不可逆风险

1. 索引：登录页可被搜索引擎发现并缓存，但认证仍是数据安全边界。
2. `llms.txt`：只允许公开产品名、授权登录属性和公开入口。
3. source map：PageSpeed 匿名抓取要求 `.map` 可公开访问；完整
   `sourcesContent` 会提高源码和业务流程可读性，且第三方副本不可召回。
4. 根域：新增公开 DNS 和 HTTPS 入口，HTTP 先同主机升级，再从根域 HTTPS
   跳转到 `geo`。
5. HSTS：`includeSubDomains` 影响公开、内部、未来和嵌套子域；preload
   移除不能即时生效。
6. 当前全量 Zone 新发现 `relay.962850.xyz`。用户已决定删除其 A，并退役
   配置名 `mux/probe`。日志和脱敏历史配置证明 `mux` 在 7 月曾有真实
   VLESS/Reality + multiplex 长连接，因此退役必须删除活动引用并保留历史证据，
   不能恢复旧监听、删除历史或用占位服务冒充关闭。
7. 官方当前不普遍推荐 preload，且移除通常需 6–12 周到达多数 Chrome、
   其他浏览器可能更久；用户明确要求正式提交不等于可以省略最终不可逆确认。

用户已确认索引、公开资产、临时 TXT、根域行为和三个特殊名称的产品选择；
这些确认允许完成本地实现和精确提案，不等于授权发布、DNS/Nginx/HSTS 或
preload。外部执行仍由 `implement.md` 的独立闸门控制。

注册商登录截图不属于 Lighthouse、HSTS 或 preload 的正式要求。Cloudflare
credentialed GET、双权威/双公共随机 TXT 写后删证明和受控 BIND 原文已经提供
更直接的 DNS 技术控制证据；公开 RDAP 仅记录注册商状态。未独立验证的账户恢复、
自动续费与 nameserver 恢复能力作为运维残余风险保留。

## 关闭模型

父任务维护一张逐项矩阵：

| 字段 | 含义 |
|---|---|
| Report evidence | 当前报告中的原始数值、文本或 audit id |
| Root cause | 代码、配置、依赖或外部基础设施权威位置 |
| Change | 实际修改或经验证的安全保留决策 |
| Verification | 测试、构建、浏览器、响应头或 PageSpeed 证据 |
| Threshold | 可判定的通过标准 |
| Authorization | 是否及何时取得用户授权 |
| Status | Open / Blocked by approval / Closed |

人工审核不会因 Lighthouse 始终显示 manual 而保持开放；使用带日期、浏览器、
步骤和结果的人工验收记录关闭。来自依赖的 Baseline 项也必须证明项目使用情况和
fallback，不能只标记“第三方”。

## 回滚

- 代码：以完整发布版本回滚，不用宽松 CSP 或 silent fallback 临时止血。
- 公开资产：可恢复 noindex/robots 并移除 llms/map，但不能保证外部缓存消失。
- DNS/HTTPS：先保存 Zone、`nginx -T` 和证书快照；配置必须 `nginx -t`
  后 reload。
- HSTS：优先恢复 HTTPS；`max-age=0` 不能即时清除已缓存或预加载策略。
- preload：保持有效 HTTPS，移除 `preload` 后走官方 removal，任务继续监控。
