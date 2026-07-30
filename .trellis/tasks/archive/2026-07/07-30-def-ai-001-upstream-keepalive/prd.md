# 修复 DEF-AI-001 API upstream keep-alive 竞态

## Goal

协调 Nginx 与 Uvicorn 空闲连接寿命，消除偶发 upstream premature close 502。

## Requirements

- staging 与 production 的 Nginx API upstream 空闲寿命显式设为 30 秒。
- staging 与 production 的 Uvicorn API 空闲连接寿命显式设为 35 秒。
- 必须保持 `Nginx 30s < Uvicorn 35s`，使代理先淘汰连接并保留 5 秒安全余量。
- 只修改 API upstream；不得改变前端或对象存储 upstream。
- 不增加 `proxy_next_upstream`、客户端静默重试或业务 fallback。
- 不修改 Prompt 查询、AI 业务逻辑、数据库或 API 合同。
- 运维文档必须记录连接寿命不变量、故障特征和只读诊断方法。

## Acceptance Criteria

- [ ] 两份 Nginx 模板均显式包含 API upstream `keepalive_timeout 30s`。
- [ ] staging/prod 两份 Compose 的 API 命令均包含 `--timeout-keep-alive 35`。
- [ ] 部署自检同时检查两侧精确值，任一漂移都会失败。
- [ ] Compose 配置、Nginx 项目检查和部署脚本自检通过。
- [ ] 不存在新增的代理重试、业务重试或 AI/Prompt 代码修改。
- [ ] 运维附录包含根因、验证和回滚边界。

## Evidence

- `2026-07-30 02:38:22 CST`，Nginx：
  `upstream prematurely closed connection while reading response header from upstream`。
- 同一时间窗 API 容器无重启、无 OOM，前后 `/api/v1/platform-prompts` 均返回 200。
- 现网 Uvicorn `timeout_keep_alive` 默认值为 5 秒；故障发生在上一次成功请求约 5 秒后。
- 完整证据见
  `artifacts/deployed-acceptance/20260730-020822/acceptance-report.md`。
