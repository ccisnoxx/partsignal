# GEO 本地 provider 与 Collector 合同套件（GEO-402 / R3）

该替身属于测试基础设施，不是生产 Collector，不加入 app.main、默认 Collector Registry、
Worker、Compose 或数据库。所有普通 CI 请求只连接回环；不能将其成功响应解释为
Profile 已通过连接测试或已获执行资格。共享虚构正文来自
[geo_analysis v1](../geo_analysis/README.md)，不复制或修改金标。

## 运行与控制协议

从仓库根目录执行：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend python -m app.geo_fake_server --port 19012
make test-geo-collector-contract
```

服务只能绑定 `127.0.0.1`；测试使用 `running_geo_fake()` 分配随机端口并自动关闭连接、
唤醒延迟和等待请求线程。CLI 单进程，退出即清空观测；不在生产启动。

| 方法/路径 | 含义 |
|---|---|
| `GET /health` | 本地存活确认，不访问任何依赖 |
| `PUT /__geo__/scenarios/{attempt_uuid}` | 设置该 attempt 的闭合场景，返回 configured 布尔值 |
| `POST /v1/chat/completions` | 模拟 provider；必须提供规范 UUID 的 `X-GEO-Attempt-ID` |
| `GET /__geo__/calls/{attempt_uuid}` | 返回 attempt_id、count、requests 及 redirect_hits |
| `GET或POST /__geo__/redirect-target` | 重定向陷阱；任何到达都会增加 redirect_hits |

`X-GEO-Attempt-ID` 是测试关联 Header，对应新 Run UUID（每个 attempt 有独立 Run），
不写入业务协议/快照。POST 请求体使用固定 model、stream=false 和原 user prompt。
统计只记录完整接收的请求正文 SHA256 和字节数，不记录 Header、正文、名称或配置。
**同一 UUID 重复请求如实追加，不能由 fake 去重伪造 at-most-once。**
`redirect_hits` 是实例级计数，即使跟随后丢失 attempt Header 也能捕获；共享实例时应
在套件开始前保持陷阱计数为零。控制端点和 health 不计业务调用。

场景 JSON 禁止额外字段，字段如下（Python 构造使用 `FakeMode`）：

- `mode`：下表枚举，默认 success。
- `delay_seconds`：有限数值，0 < value ≤ 5，默认 1.5；用于 timeout/slow_body。
- `response_bytes`：严格整数，1..4194304，默认 2097153；用于 oversize 两种模式。
- `answer_text`：1..1048576 字符，默认虚构提示；测试成功 case 直接读取 GEO-005 原文。
- `web_search_observed`：严格布尔或 null，默认 null；不因能力声明而推断搜索。
- `partial_usage`：默认 false；开启时只报告 prompt_tokens=7，不补算 total。
- `reported_cost`：默认 false；开启时报告虚构 0.001200 USD，未报告时缺省。
- `echo_sensitive`：默认 false；用于故意将当前请求的虚构凭据写入 response debug/错误
  和成功响应 Set-Cookie。仅存在于请求/响应内存，不能持久化、日志或控制响应回显。

| mode | 实际网络行为 |
|---|---|
| success | Chat Completions 结构，保留完整原文、模型/版本、独立请求 ID |
| citations | success 加两次同 URL 的原始引用，实际位置 1、3，不去重 |
| 429 | 完整 429 响应及 Retry-After=2，不自动重试 |
| timeout | 已收到请求后延迟响应 Header |
| slow_body | 发送 Header 和一个字节后停止正文，触发读超时 |
| disconnect | 完整收到业务请求后真实关闭 TCP，不发送响应 |
| redirect | 307，Location 仅指向本地陷阱 |
| oversize | Content-Length 声明超限，并发送对应字节 |
| oversize_chunked | 无 Content-Length 的真实 HTTP chunked 超限流 |
| invalid_response | message.content 类型错误 |
| invalid_json | 截断、无法解析的 JSON |
| empty_answer | 空白正文，不能视为成功 |
| 401 / 403 / 503 | 对应完整 provider 错误响应 |

发送前故障通过关闭本地监听 socket 产生真实 connection refused；不能把已经收到的
request 伪装为 NOT_STARTED。替身不访问第三方、不抓取引用、不执行问题中的指令。

## 合同复用与证据边界

`tests.geo_collector_contract` 公开 `assert_collection_case`、`assert_authorization_rejection`
和 `FAILURE_CASES`。未来 Collector 用新的 request UUID、启动的本地 provider 和自己的
`GeoCollector` 实例接入；测试工厂负责把独立测试 Header 注入受控 transport。
断言检查 before_send 先于接收且恰好一次、正文哈希、每 attempt 请求次数、无 redirect、
原文/引用位置、unknown/partial metadata、请求 ID、稳定错误及显式 send state。

套件自测 `tests.geo_reference_collector.ReferenceCollector` 只能使用本地 server 对象，
只理解本替身协议、以受控字段构造结果，不接收业务配置/URL/ORM，不实现生产 adapter。
未知费用为 null，Header/debug 不保留，raw bytes 不保存。其存在仅证明套件能运行；
故意重试、跟随重定向、泄漏异常的驱动必须被套件拒绝。既有 `PinnedHTTPTransport`
另用真实 TCP 验证 429、timeout、disconnect、redirect、Content-Length/chunked 限额。
本任务不证明 Worker 重复消息、SENT 持久化、租约竞争、迟到结果或生产 TLS；这些由
GEO-403/404/405/406 在真实边界补充，不提前实现。

## 日志、产物与 CI

测试内存生成独立 API/Header/Cookie canary，验证这些值实际经过错误/成功响应，再检查
稳定错误、结果、统计、日志和 JSON 产物不含值。统计无请求全文；默认 HTTP access/error
日志和非法 method 错误禁止回显输入。secret scan 检查原值、URL/JSON/Base64 形式，
失败诊断只给固定规则，不打印命中值。

`deploy/scripts/test-geo-collector-contract.py` 捕获整轮 pytest 输出，在展示前扫描输出和
临时产物；支持 `--scan-root <目录>` 增加证据扫描，缺目录/读取失败/泄漏均非零退出。
检测泄漏时抑制原日志。测试出站守卫拒绝所有非回环 DNS/TCP，守卫自身有反例自测。
脚本接入 `make test-deploy-scripts`，现有 CI 后端 unit 也收集套件，无需增加外部服务。
secret scan 不能替代通用 DLP、安全审批、生产日志审查或业务审计集成。
