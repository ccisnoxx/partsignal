# Browser Collector：GEO-801 骨架

独立 Node/Playwright 包与镜像；版本锁定为 1.61.1，浏览器由同版本官方镜像提供。
普通 backend 镜像不安装本包。服务只探测内存中的离线 DOM，不打开外部 URL。
运行方式、资源隔离、开关和安全停止以
[部署文档](../docs/geo-monitoring/03-technical/08-deployment-and-operations.md#当前-r7geo-801-独立-browser-骨架)为准。

`node src/main.mjs claim <run-uuid>` 是内部边界验证入口：只接受稳定 UUID，
不连接 PostgreSQL/Redis、不创建 lease、不消费或确认消息。
关闭或 STOP 存在时退出 1 / `COLLECTOR_DISABLED`；其他情况退出 1 /
`BROWSER_ADAPTER_NOT_IMPLEMENTED`；非法输入退出 1 / `BROWSER_TASK_INVALID`。
这两个拒绝结果不是业务 Run 的 error code，也不写入业务状态。
后续 adapter 必须通过现有 Application Service 建立领取、发送授权和结果事务，
不能在这里新增独立业务状态来源。

回环 `GET /health` 要求 Chromium 完成实际 DOM 探测；运行时失败返回固定 503，
采集被停用不影响容器健康。`session_probe=NOT_IMPLEMENTED` 明确区分运行时与会话健康。
不提供 HTTP 领取、调试、登录或导航入口；不保存浏览器会话、截图、视频或 trace。

本地 `npm ci` 后运行 `npm run lint`、`npm run typecheck` 和 `npm test`。
`make test-geo-browser` 验证三个环境配置及独立真实容器，自动清理本轮随机项目/tag。
该检查只使用本地内存页，不实现 GEO-803 的模拟 AI 站或 adapter 合同套件。

## GEO-803 本地合同套件

`make test-geo-browser-contract` 使用真实 Chromium 与回环虚构AI站，覆盖streaming、
引用、登录、selector漂移、挑战页、敏感UI和超时。参考Adapter全部位于tests，生产镜像只COPY src，
不登记真实Adapter或启用采集。协议、CI网络隔离、后续Adapter接入方法与范围见
[模拟站说明](../tests/browser-fixture/README.md)。
根 `make e2e` 先运行本套件；CI设置 `GEO_BROWSER_CONTRACT_CONTAINER=1`，使用同版官方
浏览器镜像的network none与既有sandbox隔离。输出结果由后端权威类型检查并在打印前扫描canary。
