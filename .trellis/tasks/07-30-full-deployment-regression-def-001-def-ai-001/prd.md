# 完整发布与上线回归 DEF-001 / DEF-AI-001

## Goal

将已推送的 DEF-001 与 DEF-AI-001 通过 Hostdzire 完整 Runbook 发布到 https://geo.962850.xyz，并完成 Nginx、健康探针和真实浏览器回归。

## Requirements

- 发布来源必须是干净、已推送且与 `origin/main` 一致的本地 `main`。
- 必须按 `docs/Hostdzire部署上线流程.md` 第 5 节和部署附录第 4 节执行完整发布，不设置 `PARTSIGNAL_DEPLOY_MODE=fast`。
- 只向 SSH 配置中的 `hostdzire` 写入 release、Compose、Nginx 和 `current`；`dmit` 仅在公网入口异常时只读诊断。
- 复用既有 `/root/partsignal/shared/.env.staging`，不得输出、下载或改写凭据。
- 已有数据必须在迁移前生成非空备份；迁移、`preflight-integrity`、Compose、容器健康或 `nginx -t` 失败时停止。
- staging Nginx 模板必须与同一 release 一起安装，确认 API upstream 为 `keepalive_timeout 30s`，API 进程参数为 `--timeout-keep-alive 35`。
- 公网必须通过 live、ready、首页、缓存头、安全头、对象存储代理和连续 API 探针。
- 使用真实浏览器只读回归登录、管理员页面、工程师 403、控制台和失败请求；不得创建业务数据、调用模型或修改配置。
- 只有全部验收通过后才能原子更新 `/root/partsignal/current`；失败时保留现场并按旧 release 回滚，不删除数据或历史 release。
- 所有记录必须脱敏，不保存密码、Cookie、Token、环境文件或完整认证状态。

## Acceptance Criteria

- [ ] 新 release ID 唯一且包含目标 commit `2e34281` 的 12 位短哈希。
- [ ] 已有数据库备份非空，完整部署、迁移与所有容器健康检查通过。
- [ ] 生效 Nginx 配置通过 `nginx -t`，API upstream 为 30 秒，API 进程为 35 秒。
- [ ] 公网 live、ready、首页、缓存头、安全头和对象存储代理符合 Runbook。
- [ ] 至少连续 6 次、间隔 6 秒的只读 API 请求均为 200，时间窗无新的 upstream premature close。
- [ ] 管理员可访问 `/audit` 和 `/configuration/ai`，相关请求成功且控制台无应用级错误。
- [ ] 工程师直达 `/users`、`/audit`、`/configuration/ai` 均保留 URL、显示可聚焦 403，且无受限业务请求。
- [ ] 验收完成后 `current` 指向新 release，API 容器无重启、无 OOM。
- [ ] 浏览器会话退出并清理，本地工作树除本任务记录外无意外变更。

## Notes

- 目标环境：`https://geo.962850.xyz`。
- 工作提交：`78e79cd`、`87edd78`；发布目标 HEAD：`2e34281`。
