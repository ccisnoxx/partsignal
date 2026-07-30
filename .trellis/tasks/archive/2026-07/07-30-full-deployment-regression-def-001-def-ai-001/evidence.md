# 完整发布执行记录

## 第一次执行结果

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

## 第二次完整发布（最终通过）

最终结论：**完整发布与上线回归通过，已更新 `current`**。

- 目标提交：`4e4672f3e6f48c50083c683582863d527be15cb2`
- 候选 release：`mvp-20260730-150823-4e4672f3e6f4`
- 迁移前备份：`partsignal-20260730T070944Z.sql.gz`，77,941 bytes，权限 `0600`
- Nginx 备份：
  `/root/partsignal/backups/nginx-mvp-20260730-150823-4e4672f3e6f4`
- 最终 `current`：
  `releases/mvp-20260730-150823-4e4672f3e6f4`

### 已通过

- 本地 `main` 干净、与 `origin/main` 一致；Nginx 安全检查和部署脚本自检通过。
- Hostdzire 身份、共享环境 `0600`、资源、容器基线和初始 `nginx -t` 通过。
- 新 release 归档安全检查、SHA-256 校验、不可覆盖目录和共享环境链接通过。
- 新备份非空；完整模式构建、`preflight-integrity=[]`、Alembic head、种子账号和
  全部容器健康检查通过。
- 同 release 的 Nginx 模板与安全 snippet 已备份后安装；活动站点恢复为 symlink，
  `nginx -t` 与 reload 通过，生效值为 `30s < 35s`。
- 公网 DNS、live、ready、首页、SPA fallback、哈希资产缓存、六项安全头和对象
  存储代理通过；当前构建不包含 WOFF2。
- 6 次间隔 6 秒 API 探针均为 200；窗口新增 Nginx 错误 0、premature close 0；
  API 重启 0、无 OOM、健康。
- 管理员工作台、审计日志、AI 渠道、Prompt 管理均正常；浏览器控制台无
  application error/warning。
- 回归缺陷路径已恢复：
  `/api/v1/content-tasks`、平台筛选列表、`/api/v1/platform-prompts` 均为 200。

### 工程师权限补充回归

种子工程师 `content_editor` 登录后被强制路由到 `/change-password`，无法在只读
验收边界内进入权限页面。经用户明确授权后，通过正常 UI 创建隔离工程师测试账号，
只用于首次改密和权限回归：

- 账号：`E2E-ACCEPT-DEPLOY-20260730-152350`
- 用户 ID：`0aa73959-c5dc-4407-ab54-dffe4ea3490a`
- 创建后：`revision=0`、`must_change_password=true`
- 首次改密后：`revision=1`、`must_change_password=false`
- 停用后：`revision=2`、`is_active=false`
- 删除：`DELETE /api/v1/users/0aa73959-c5dc-4407-ab54-dffe4ea3490a`
  返回 204；随后同名筛选结果为 0，用户总数恢复为 5

该账号没有业务历史。审计页保留了创建、修改密码、停用和删除四条成功记录；账号
删除后，修改密码记录的操作者显示为“已删除用户”，符合删除账号后保留审计并置空
用户引用的约束。

工程师首次改密后逐一直接访问：

| URL | 实际结果 | 请求边界 |
| --- | --- | --- |
| `/users` | URL 保留，显示“无权访问”；`SECTION[role=alert]` 自动获得焦点 | 未请求 `/api/v1/users` |
| `/audit` | URL 保留，显示“无权访问”；`SECTION[role=alert]` 自动获得焦点 | 未请求 `/api/v1/audit-logs` |
| `/configuration/ai` | URL 保留，显示“无权访问”；`SECTION[role=alert]` 自动获得焦点 | 未请求 AI 渠道或模型配置接口 |

三次导航仅产生认证、工作台摘要、GEO 指标和产品列表等普通工程师可访问请求；
控制台为 0 error、0 warning。首次改密页出现一条 Chrome verbose 可访问性提示：
密码表单未关联可选的隐藏用户名字段；不影响功能与本次发布结论，留作后续 UI
可访问性改进线索。

### 上线与清理

- 全部验收通过后，原子更新 `/root/partsignal/current`，最终指向
  `releases/mvp-20260730-150823-4e4672f3e6f4`。
- 最终公网 `/api/health/live`、`/api/health/ready` 和首页标题通过。
- 最终 `nginx -t` 通过；Compose 中 7 个服务均运行，API 容器健康，
  `restart=0`、`oom=false`，镜像为
  `partsignal-backend:mvp-20260730-150823-4e4672f3e6f4`。
- 迁移前备份仍为 77,941 bytes、权限 `0600`。
- 管理员与工程师均通过 UI 正常退出；命名浏览器会话
  `deploy-20260730-4e4672f` 的 Cookie、localStorage、sessionStorage 和 profile
  已删除，内存中的管理员与测试账号密码引用已释放。
- 测试账号已停用并删除；其不可变审计记录按业务规则保留。未删除候选 release、
  数据库备份、Nginx 备份和发布日志，以支持审计与回滚。
