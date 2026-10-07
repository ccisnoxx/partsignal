# GEO-803：本地 Browser Adapter 合同

本目录是虚构 AI 产品，仅供测试，不对应真实平台、账号或生产 Adapter。
`server.mjs` 每实例监听随机 `127.0.0.1` 端口；`index.html` / `fixture.js`
提供真实可交互 DOM。无需新增依赖，使用 Browser Collector 已锁定的 Playwright 1.61.1。

从仓库根运行：

```bash
make test-geo-browser-contract
# 与 CI 一致：独立 Linux Chromium，只有回环接口。
make test-geo-browser-contract GEO_BROWSER_CONTRACT_CONTAINER=1
```

本机命令需要已安装对应 Chromium；可用
`npm --prefix browser-collector exec -- playwright install chromium` 安装固定版本的运行时。
容器命令使用同版官方镜像，首次可能下载镜像。依赖安装与业务测试分开；测试不访问外部 AI。
`make e2e` 必须先通过本套件。CI 为独立包执行 `npm ci`，设置上述容器选项；
Node 测试和模拟站在同一 `--network none` 容器内，非 root、Chromium sandbox开启，
沿用 GEO-801 seccomp/cap_drop ALL/只读根，不开放端口或业务网络。
只挂本包、fixture及本轮输出目录，不挂仓库 `.env`、数据库、Redis、密钥、Cookie或普通OSS。

## 模拟协议

测试调用 `startBrowserFixture(sensitiveValues)` 后，以 `configure(runUUID, mode)` 新建场景，
返回 `/chat/<UUID>`。重复配置UUID拒绝；不同实例可使用相同UUID且计数隔离。
站点只有本地 HTML/脚本、`GET /scenario/<UUID>` 和 `POST /submit/<UUID>`。
POST 严格接受 `{prompt: string}`，校验同源Origin和32KiB上限；未知路径/模式明确拒绝。
`stats(UUID)` 只保存真实POST次数、原问题UTF8长度和SHA256，不保留正文/Header/Cookie。
同UUID多次POST全部计数，不去重。`close()` 关闭全部连接和随机listener并清空观测。

| 场景 | 可观察行为 |
|---|---|
| streaming / paused-stream | 逐步正文；长暂停超过稳定窗口，完成信号尚未出现时不能返回 |
| early-complete | 完成信号先出现，最终正文和引用随后更新 |
| no-citations / unknown-metadata | 显式无引用；未知产品/模型/版本/搜索保持null |
| authenticated / expired-login | 内存导入虚构Cookie；匿名/过期需人工登录，跨Context不继承 |
| selector-changed | 提交前输入selector漂移，零发送失败 |
| answer-selector-changed / duplicate-answer | 结果selector漂移/多答案歧义，不能成功提取 |
| challenge / challenge-after-send | 提交前后挑战页，停止自动化，不绕过 |
| login-after-send | 提交后会话失效，保守UNKNOWN，不自动重发 |
| timeout / empty-answer | 永不完成/空白最终答案，明确失败 |
| sensitive-ui | 可见虚构账号菜单、支付、Cookie调试及localStorage；不得进入结果 |
| external-resource | 恶意外部请求被CSP与网络边界拒绝 |

金标正文和原始引用由人工指定，保留重复URL的三个真实位置；不由提取实现生成预期值。
链接使用 `.invalid` 虚构域名，仅作为文本证据，不抓取、不点击。

## 可复用合同

`browser-collector/tests/support/adapter-contract.mjs` 的
`registerBrowserAdapterContract(name, factory)` 接收隔离Context的Adapter工厂。
Adapter提供 `collect(request, {before_send})`，测试私有请求包含原问题、UUID、本地URL、
登录态、超时与字节上限。它不是新的公开API或生产CollectionRequest。
返回结果和failure使用既有 `CollectedAnswer` / `CollectorFailure` 字段；Python入口逐项
以权威Pydantic值对象校验，不维护第二套公共schema。后续804需另行建立生产跨语言边界，
真实Adapter适配测试入口并复用本套件。

参考Adapter只在 `tests/support/reference-adapter.mjs`，不进入Docker生产src或Registry。
它要求临时聊天、完成信号、loading消失，以及正文/引用/元数据持续稳定，带有最大超时；
使用DOM轮询而非固定sleep。`before_send`早于唯一POST；失败/结果关闭页面，套件finally关闭Context。
套件以真实计数检测重复发送；故意返回部分答案、丢引用、重发、吞selector错误或泄漏canary的
驱动必须被断言拒绝。

| 触发 | 既有错误 / 阶段 / 外发状态 |
|---|---|
| 登录过期 | PROFILE_NEEDS_REAUTH / CONFIGURATION / NOT_STARTED |
| 提交前selector变化 | PROVIDER_RESPONSE_INVALID / CONFIGURATION / NOT_STARTED |
| 提交前挑战 | PROVIDER_AUTH_FAILED / CONFIGURATION / NOT_STARTED |
| 结果selector歧义、空答案 | PROVIDER_RESPONSE_INVALID / PARSE / COMPLETED |
| 提交后挑战/失效登录 | PROVIDER_AUTH_FAILED或PROFILE_NEEDS_REAUTH / RECEIVE / UNKNOWN |
| 流式超时 | COLLECTOR_UNKNOWN_OUTCOME / RECEIVE / UNKNOWN |
| 正文超限 | PROVIDER_RESPONSE_TOO_LARGE / PARSE / COMPLETED |

COMPLETED仅表示模拟站完成输出，不等于业务Run成功；没有HTTP状态/Retry-After时保持null。
这里不写业务SENT/lease/revision/答案，不能证明生产发送隔离、真实平台健康或持久化幂等。

## 敏感资料与生命周期

每轮生成三个随机虚构canary；HTTP/WS路由拒绝非fixture网络，service worker关闭。
账号/支付/Cookie UI确实可见，但参考Adapter仅提取答案区域和引用；不保存全页DOM、截图、
视频、trace、storage_state或账号资料。产物仅为通过断言的结果/failure，Python先扫描日志及
全部临时产物再输出，扫描失败不回显内容；错误断言不展开DOM值。临时目录结束即删除。
正常路径显式关闭context/browser/server；外层120秒超时先TERM再限时结束本轮进程组。
容器使用本轮随机owner标签，正常/异常结束只清理匹配该owner的精确容器ID，清理失败非零。

此任务模拟敏感UI并验证提取隔离，不实现GEO-805的生产截图裁剪、证据捕获或存储。
真实平台、合规批准、生产网络/会话/发送接线及试点分别由804–807验收。
