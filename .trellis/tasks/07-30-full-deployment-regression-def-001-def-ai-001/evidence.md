# 完整发布执行记录

## 执行结果

结论：**验收失败，已回滚，未上线**。

- 目标提交：`2e342810fe0a78b510eeb502b24786a663cfe56c`
- 候选 release：`mvp-20260730-141724-2e342810fe0a`
- 回滚 release：`mvp-20260729-174057-9ed447becff1`
- 数据库备份：`partsignal-20260730T061755Z.sql.gz`，已确认非空
- Nginx 配置备份：
  `/root/partsignal/backups/nginx-mvp-20260730-141724-2e342810fe0a`
- 最终 `current`：
  `releases/mvp-20260729-174057-9ed447becff1`

## 已通过阶段

- 本地 `main` 干净且与 `origin/main` 一致，Nginx 安全检查和部署脚本自检通过。
- Hostdzire 身份、共享环境 `0600`、旧 `current`、资源、容器和初始 `nginx -t`
  通过。
- 发布包安全检查、唯一 release 创建和共享环境链接通过。
- 数据库备份、`preflight-integrity`、迁移 `0031 → 0032`、完整 Compose 部署及
  所有容器健康检查通过。
- API 进程参数为 `--timeout-keep-alive 35`。
- 修复 Hostdzire 遗留的 `sites-enabled` 普通文件后，生效 Nginx API upstream
  为 `keepalive_timeout 30s`，`nginx -t` 和 reload 通过。
- 公网 live、ready、首页、缓存头、安全头和对象存储代理通过。
- 6 次间隔 6 秒的 live 探针全部为 200；时间窗无新增
  `upstream prematurely closed connection`；API 无重启、无 OOM。
- 管理员浏览器访问 `/audit`、`/configuration/ai` 和
  `/api/v1/platform-prompts` 成功。

## 阻断缺陷

Prompt 管理触发以下请求并持续返回 500：

```text
GET /api/v1/content-tasks
GET /api/v1/content-tasks?platform_profile_id=<测试环境既有 ID>
```

API 异常：

```text
ContentTaskListItem.idempotency_key
Extra inputs are not permitted
```

根因位于 `backend/app/services/projections.py::content_tasks_out`：迁移 0032
为 ORM 模型增加内部字段 `idempotency_key`，列表投影把该字段传入禁止额外字段的
`ContentTaskListItem`。单条投影已排除该字段，列表投影未同步排除。

该错误产生 3 条浏览器控制台资源加载错误，违反完整发布停止条件。工程师 403
回归未继续执行，因为候选 release 已判定失败并应立即回滚。

## 回滚与最终状态

- 数据库迁移 0032 只增加 nullable 列和唯一约束，没有改写历史数据；旧应用与该
  增量结构兼容，因此未执行 downgrade 或数据库恢复。
- 已从同一旧 release 恢复 Nginx 活动配置、安全 snippet 和全部应用容器。
- 回滚后所有容器健康，公网 smoke 通过。
- 回滚后浏览器重新访问 Prompt 管理：
  `/api/v1/content-tasks`、带平台筛选的内容任务请求及
  `/api/v1/platform-prompts` 均恢复 200。
- 管理员已退出；专用浏览器会话、profile、临时截图和快照已清理。
- 候选 release、数据库备份和 Nginx 备份按故障现场保留，未删除。

## 后续条件

必须先独立修复并验证 `content_tasks_out` 的内部字段泄漏回归，形成新的已推送
提交；然后本任务才能基于新 HEAD 重新执行完整发布。不得直接重试当前 release，
也不得绕过浏览器验收更新 `current`。
