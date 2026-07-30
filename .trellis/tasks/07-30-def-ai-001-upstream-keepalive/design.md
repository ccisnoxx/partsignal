# DEF-AI-001 技术设计

## 根因

Nginx 维护 API upstream 连接池，但 Uvicorn 默认在空闲 5 秒后关闭连接。Nginx 在该边界复用正被服务端关闭的连接时收到 EOF，向客户端返回 502。该故障发生在通用代理层，与 Prompt 查询或模型调用无关。

## 设计

1. 在 production/staging Nginx 模板的 API upstream 块设置
   `keepalive_timeout 30s`。
2. 在 production/staging Compose 的 API 命令设置
   `--timeout-keep-alive 35`。
3. 不改变 upstream 连接池大小；Nginx 在服务端前 5 秒淘汰空闲连接。
4. 在既有 `test-deploy-staging.sh` 增加静态契约检查，同时覆盖两份 Nginx 模板和两份 Compose 文件。
5. 更新 Hostdzire 部署附录，记录该配置不变量、Nginx 错误特征和无重启/OOM时的日志核对方法。

## 失败与回滚

- 不使用代理重试掩盖连接寿命不匹配。
- 部署涉及 Nginx 模板和 staging Compose 门禁路径，必须走完整部署并在 reload 前执行 `nginx -t`。
- 若部署后健康检查失败，按现有 Runbook 恢复上一已验证 release；不改写业务数据。

## 合同影响

无 OpenAPI、数据库、业务状态或公开类型变化。
