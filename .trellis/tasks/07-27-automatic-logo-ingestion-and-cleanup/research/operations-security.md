# Logo 导入运行与安全边界研究

## 可复用能力

- 后端已安装 `httpx`，可用于固定上游 Icon Horse 的限时流式下载（`backend/pyproject.toml:8`）。
- 当前依赖没有通用图片解码器；要验证实际图片格式、尺寸和解压像素上限，使用成熟的 Pillow 比手写 PNG/JPEG/WebP/ICO 解析器更小且更可靠。
- Celery Worker 与独立 Beat 已部署，`worker.py` 已通过 `beat_schedule` 执行 PostgreSQL 权威的周期恢复任务；Logo 清理可复用同一运行边界，无需增加 Redis 状态、Cron 服务或新队列（`backend/app/worker.py:15`、`deploy/compose.prod.yaml:42`）。
- `EvidenceStorage` 当前只有浏览器上传授权、`HEAD` 和下载 URL；开发存储只实现 PUT/HEAD/GET，OSS 适配器也没有服务端写入和删除（`backend/app/services/storage.py:62`、`backend/app/dev_storage.py:43`）。

## 固定上游请求

- 请求输入是经过 `HttpUrl` 校验的平台官网，服务端只提取并 IDNA 规范化 `hostname`。
- 上游地址在代码中固定为 `https://icon.horse/icon/{encoded-hostname}`；用户不能提交任意抓取 URL，也不提供可配置的生产上游地址。
- 禁止自动跟随重定向。任何 3xx、非 200、网络失败或超时都显式失败，因此上游不能通过重定向把后端带到私网目标。
- 使用流式响应，先检查 `Content-Length`，并在读取过程中再次执行 2 MiB 硬上限；不完整或超限响应立即失败。
- 只接受 PNG、JPEG、WebP、ICO。响应头只能作为早期过滤，最终以图片解码结果、实际格式、正尺寸和像素上限为准；SVG、HTML、伪造 `Content-Type`、解码失败和解压炸弹均明确拒绝。
- Icon Horse 的通用占位图无法从公开响应可靠区分，因此只作为“待确认候选”展示，管理员确认是品牌事实进入系统的唯一门禁。

## 存储边界

给 `EvidenceStorage` 增加两个最小操作：

- `put(object_key, data, *, content_type, sha256)`：后端保存已经下载并验证的候选字节。
- `delete(object_key)`：幂等删除；对象不存在等同成功，网络、鉴权和服务端错误映射为 `StorageUnavailable`。

开发存储增加带现有签名协议的内部 PUT/DELETE；删除同时处理对象和 metadata 文件。OSS 适配器复用 SDK 的 `put_object` 与 `delete_object`，不引入第二套客户端。

## 周期清理

- 在现有 `celery_app.conf.beat_schedule` 增加一个小时级扫描任务；业务保留期仍按 PRD 的 24 小时/7 天计算。
- 单轮按固定小批次处理 `PLATFORM_LOGO`，使用 PostgreSQL 行锁和状态决定执行权；Redis 消息不保存候选列表或删除状态。
- 后台没有真实用户 actor，清理结果使用中文结构化日志记录 selected/deleted/retry/failed 计数和非敏感 file_id；不伪造审计操作者。
- 管理员触发候选导入属于真实业务命令，继续写追加式审计，记录 provider、规范化域名、格式、大小和结果，不记录远端响应正文。

## 失败语义

| 条件 | 结果 |
|---|---|
| Icon Horse 超时、连接失败或 5xx | `503 LOGO_DISCOVERY_UNAVAILABLE`，平台保持不变 |
| 上游 3xx、4xx、超限、SVG/HTML 或图片无效 | `422 LOGO_CANDIDATE_INVALID`，提示手工上传 |
| 对象存储写入/HEAD 失败 | `503 DEPENDENCY_UNAVAILABLE`，文件保留可清理状态 |
| 对象删除时目标已不存在 | 视为幂等成功，转为 `DELETED` |
| 对象删除暂时失败 | 保持 `DELETING`，结构化告警并在下轮重试 |

## 不采用

- 不让浏览器直接长期引用 Icon Horse。
- 不抓取用户提供的任意网页，不解析 HTML，不跟随任意重定向。
- 不使用 Redis 保存候选、保留期或引用计数。
- 不新增通用抓取器、通用垃圾回收框架、内容哈希去重或 SVG 转换服务。
