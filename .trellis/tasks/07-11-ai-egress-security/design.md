# AI 出站安全设计

## 问题

当前客户端先解析域名并校验公网地址，随后由 HTTP 客户端再次按域名解析并建立连接。攻击者可在两次解析之间切换为私网、回环或链路本地地址，形成 DNS rebinding/TOCTOU SSRF。

## 核心不变量

1. 每次请求只使用本次解析并完整校验通过的地址集合。
2. 任一 A/AAAA 地址不符合生产公网规则时，整组拒绝。
3. 实际 TCP peer 必须属于批准集合，验证通过前不得发送 Authorization 或敏感 Header。
4. HTTPS 的 Host、SNI 和证书 hostname 校验始终使用原始主机名，不使用目标 IP 替代。
5. 不跟随重定向，不对已开始发送的请求做隐式供应商重试。

## 组件边界

### `ResolvedEndpoint`

不可变值对象，包含：

- 规范化 scheme、原始 hostname、端口、path/query。
- 本次 `getaddrinfo` 返回并通过策略校验的 sockaddr 集合。
- 运行环境允许规则：生产仅公网 HTTPS；开发/测试可显式允许全回环 HTTP。

解析器只负责解析和地址分类，不执行 HTTP 请求。

### Pinned HTTP Transport

在 AI 适配器内部建立一个最小同步传输边界，只支持当前所需的：

- `GET /models`
- `POST /chat/completions` JSON
- HTTP/1.1、有限响应大小、明确超时、禁止重定向

推荐使用 Python 标准库 `http.client` 的连接扩展配合显式 socket：TCP 连接目标使用 `ResolvedEndpoint` 的 IP；TLS `server_hostname` 和 HTTP Host 使用原始 hostname。连接后调用 `getpeername()` 再验证实际 peer，验证完成后才发送请求头。

传输可在尚未发送任何 HTTP 字节前尝试批准集合中的下一个 IP；一旦开始发送请求，不再自动切换或重试。

`discover_models`、模型测试和生成共用该传输，不保留旧的“先校验、再按 hostname 请求”路径。

## URL 与错误处理

- 保留现有 base URL 路径拼接规则，不增加协议探测。
- 非允许地址或实际 peer 越界统一返回 `AI_URL_FORBIDDEN`。
- TLS、连接、超时和供应商 HTTP 错误沿用现有显式 AI 错误分类。
- 错误、日志和审计不得包含凭据、敏感 Header 或供应商响应正文。
- 响应继续执行严格 JSON Schema 解析，不做提取、修复或补值。

## 测试注入

通过项目自有的窄接口注入 resolver、connector 和 clock，不依赖 httpx/httpcore 私有成员。测试必须观察实际连接目标和发送前事件，而不只 Mock URL 校验函数。

## 契约、依赖和部署

- 不改变 OpenAPI、数据库或环境变量。
- 更新 `.trellis/spec/backend/ai-configuration-guidelines.md`，记录解析结果绑定和发送前 peer 校验。
- `httpx` 仍可用于对象存储等其他边界；AI 调用不得再走会二次解析 hostname 的默认路径。
- API 与 Worker 必须同批部署。部署失败时禁用 AI 渠道并修复，不回滚到已知不安全实现。

## 被否方案

- 再次 DNS 校验或缓存 TTL：没有绑定实际 socket。
- 把 URL host 改成 IP 并只设置 Host Header：破坏 SNI 和证书校验。
- 依赖 httpx/httpcore 私有 transport 扩展：形成不稳定集成点。
- 建设通用 egress proxy：超出当前单一 AI 出站边界和 MVP 范围。
- DNS 结果含一个公网地址就放行：混合地址仍可被利用。

## 最终确认补充

- Transport 必须在单次请求内只解析一次，并冻结通过策略校验的全部 sockaddr；任一混合非公网结果使整组失败。
- 可以在发送任何 HTTP 字节前尝试同一批准集合的下一个地址；请求头或正文开始发送后不得自动切换或重试。
- TCP 建立后先以 `getpeername()` 核对批准集合，再发送 Authorization 和敏感 Header。
- 连接 IP 不替换 URL 主机语义：TLS `server_hostname`、证书 hostname 校验和 HTTP Host 始终使用原始 hostname。
- 不依赖 httpx/httpcore 私有成员；若标准库或稳定公共接口不能满足边界，停止实施并重新评审。
