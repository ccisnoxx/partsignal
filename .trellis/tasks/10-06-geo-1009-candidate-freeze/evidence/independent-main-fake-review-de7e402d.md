**APPROVE，仅限 `20cbdbd2 → de7e402d` 的这两个文件增量。未确认 P0–P3 问题。main 完整门禁仍为 FAILURE，局部批准不能用于声明 main 门禁或发布验收通过。**

已读取根 AGENTS、两份完整候选源码、生产 `PinnedHTTPTransport`、出站守卫、相关 fake 调用者及隔离合同，并检查 Python 3.12 标准库实现。本次复核没有重跑测试，也没有修改仓库或环境。

- **修复作用准确。** [geo_fake_server.py:100](/Users/sc/PycharmProjects/partsignal/backend/app/geo_fake_server.py:100) 的唯一行为变化是 `request_queue_size = 12`。已核对标准库 `TCPServer.server_activate()`，该值直接传给监听 socket 的 `listen()`，影响尚未接受的 TCP 连接排队容量。响应处理、计数锁、重复请求追加、实例隔离和停止流程均未改变；生产 transport、网络守卫、Python 版本配置、Dockerfile 和验证入口在两个固定提交间保持一致。
- **反例观察真实 TCP 行为。** [test_geo_fake_provider.py:153](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_fake_provider.py:153) 创建已经监听、尚未启动 accept 循环的 server，保留 12 个真实连接。守卫最终调用原始 `socket.connect()`，没有伪造连接成功。旧源码记录在连接阶段出现 `ConnectionResetError`；新源码的定向记录完成该用例。它没有仅断言配置值，也没有放宽客户端超时、增加重试或降低原计数要求。
- **释放路径闭合。** 新用例退出或中途连接失败时，`ExitStack` 先关闭已成功建立的客户端 socket，再由 server 上下文关闭监听 socket；失败的 `create_connection()` 自行关闭其 socket。该用例没有启动请求线程，因此无需调用会等待 accept 循环的 `shutdown()`。既有 [geo_fake_server.py:325](/Users/sc/PycharmProjects/partsignal/backend/app/geo_fake_server.py:325) 的唤醒、shutdown、请求线程等待与 accept 线程 join 流程保持原样。
- **已检查容量需求相容。** 原计数用例是 6 个发送者、12 次请求；已检查的容量测试是 10 路实际 HTTP 并发。12 的 backlog 可覆盖这些已知突发需求，没有发现容量值与这些调用者不匹配。它不构成无限并发或任意内核配置下的容量保证。

独立证据核对结果：

| 证据 | 核实结果 |
|---|---|
| clean `20cbdbd2` 完整验证 | exit 2；后端单元 `3864 passed / 1 failed`，原计数用例在 `CONNECT` 阶段失败；后续门禁未执行 |
| 新 TCP 反例旧源码记录 | exit 1，原始连接发生 `ConnectionResetError` |
| 四文件定向验证记录 | exit 0；原始进度输出为 `72 + 72 + 2 = 146` 个通过点；约 10.66 秒 |
| Ruff 记录 | exit 0，`All checks passed!` |
| 固定提交 diff 检查 | 本次只读 `git diff --check` exit 0；两提交间仅这两个文件变化 |
| AST 对比 | 原有 12 个顶层函数全部未变，包含并发计数用例；仅新增 TCP 反例 |

两份源码的前后 SHA256 均独立重算并与 [source-proof 记录](/Users/sc/.codex/reviews/partsignal/rc-candidate-20261007/main-fake-backlog-source-proof.json) 一致；四份验证日志的 SHA256 也同时匹配各自执行 JSON 和 source-proof。固定修复源码的摘要为：

- `geo_fake_server.py`：`ee780503c75fa821d1f9d16e0d6081456b9c99854e7ec9c7dce5b329dc120826`
- `test_geo_fake_provider.py`：`27dbccbde3f4c4be2de6c6f2df9a10fbac897791359643c6ad17de535f1881cc`

覆盖缺口是：red、green 和 lint 的真实执行身份均为 **`20cbdbd2 + dirty`**，源码摘要记录用于事后绑定固定 `de7e402d`；执行 JSON 本身没有逐文件执行时摘要，因此不能称作 clean `de7e402d` 重跑。现有 red/green 证据来自 macOS Python 3.12，没有本次 Linux 容器验证；初次完整失败日志也没有保留底层连接 errno，backlog 根因判断由标准库实现和独立 TCP 反例共同支持。

本结论不解除完整 main 门禁的失败状态。第二次 full gate、第七次 CI、RC 或生产执行均不在本次复核范围内，既有恢复验收无需重做。
