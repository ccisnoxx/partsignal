# Research: 线上现有 contentVersionId 的只读发现路径

- Query: 怎样在不写业务数据的前提下找到线上现有 `contentVersionId`；优先现有 API，若无则定位 Hostdzire PostgreSQL 只读查询方式。
- Scope: internal
- Date: 2026-07-25

## Findings

### 首选：现有认证 GET API

契约已经提供两段式只读枚举，无需直接查库：

1. `GET /api/v1/content-tasks` 枚举内容任务：`contracts/openapi.yaml:1294-1313`。
2. 对每个任务调用 `GET /api/v1/content-tasks/{content_task_id}/content-versions`：`contracts/openapi.yaml:1417-1427`。
3. 返回的 `ContentVersionList.items[].id` 就是路由所需 `contentVersionId`：`contracts/openapi.yaml:3274-3295`、`contracts/openapi.yaml:3306-3311`。
4. 取得 ID 后可用 `GET /api/v1/content-versions/{content_version_id}` 验证它仍存在：`contracts/openapi.yaml:1473-1483`。

实际后端实现与契约一致：

- 任务列表要求已有会话 `CurrentUser`，按 `created_at DESC` 返回全部任务：`backend/app/routers/planning.py:363-379`。
- 任务内容版本列表同样只要求 `CurrentUser`，按 `version DESC` 返回；首项是该任务最新版本：`backend/app/routers/production.py:250-267`。
- 独立详情 GET 只要求 `CurrentUser`：`backend/app/routers/production.py:270-281`。
- GET 不需要 CSRF；登录成功后服务端设置 HttpOnly 会话 Cookie 和 CSRF Cookie：`backend/app/routers/identity.py:84-105`。

仓库已有可直接复用的 Playwright 查找模式：

```ts
const tasks = await body<{ items: Array<{ id: string }> }>(
  await page.request.get('/api/v1/content-tasks'),
);
for (const task of tasks.items) {
  const versions = await body<{ items: Array<{ id: string; title: string }> }>(
    await page.request.get(`/api/v1/content-tasks/${task.id}/content-versions`),
  );
  if (versions.items[0]) {
    content = versions.items[0];
    break;
  }
}
```

见 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:31-52` 和 `frontend/tests/e2e/editor-workspace-convergence.spec.ts:30-49`。应在已认证 Playwright 会话内执行，密码只保留在自动化进程内存中；不要把 Cookie 或密码写到临时文件。

仓库没有独立的 `GET /api/v1/content-versions` 全局列表 endpoint。应先走上述任务枚举，不要猜 ID。

### API 返回空时：Hostdzire PostgreSQL 强制只读查询

PostgreSQL 是业务状态唯一来源，且 staging 的 PostgreSQL 不暴露宿主机端口：`docs/operations.md:12-17`、`deploy/compose.staging.yaml:24-39`。只能在获得 SSH 只读诊断授权后，通过 `hostdzire` 当前 release 的固定 Compose 项目执行查询。

只输出一个最新内容版本 UUID、并用 PostgreSQL `default_transaction_read_only=on` 强制当前连接只读的命令：

```sh
ssh -F /Users/sc/.ssh/config hostdzire 'set -eu
release_dir=$(readlink -f /root/partsignal/current)
release_id=${release_dir##*/}
cd "$release_dir/deploy"
PARTSIGNAL_VERSION="$release_id" \
  docker compose --env-file ../.env.staging -f compose.staging.yaml \
  exec -T postgres \
  env PGOPTIONS="-c default_transaction_read_only=on" \
  psql -U partsignal -d partsignal -v ON_ERROR_STOP=1 -Atc \
  "SELECT id FROM content_versions ORDER BY created_at DESC, version DESC LIMIT 1;"
'
```

依据：

- 当前 release 的只读定位命令：`docs/Hostdzire部署附录.md:436-447`。
- Compose 使用固定项目名、`postgres` 服务和 `.env.staging`：`deploy/compose.staging.yaml:1-8`、`deploy/compose.staging.yaml:24-39`。
- Runbook 已使用同一 `docker compose ... exec -T postgres psql -U partsignal -d partsignal` 模式做只读迁移版本查询：`docs/Hostdzire部署附录.md:275-284`。
- 表名、主键、任务外键、版本号和时间列由 ORM 明确定义：`backend/app/models/content.py:100-145`。

若命令无输出，权威 PostgreSQL 中没有内容版本；不得创建、补零或猜测一个 ID。若需要确认数量，可继续使用同一强制只读连接执行 `SELECT count(*) FROM content_versions;`。

### 已知历史状态

- 上一次 2026-07-25 线上验收时，`GET /api/v1/content-tasks?page=1&page_size=100` 返回空 `items`，因此未能只读解析内容版本：`.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:90-96`。
- 这只是当时状态，不代表本次部署后仍为空；应重新调用权威 GET API。

### 主 Agent 必须完整阅读

1. `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
2. `docs/Hostdzire部署附录.md`（若 API 无结果且准备走数据库只读查询）
3. `deploy/compose.staging.yaml`（若准备直接查询 PostgreSQL）

定向阅读即可：

- `contracts/openapi.yaml:1294-1313`
- `contracts/openapi.yaml:1417-1483`
- `contracts/openapi.yaml:3274-3311`
- `backend/app/routers/planning.py:363-379`
- `backend/app/routers/production.py:250-281`
- `backend/app/models/content.py:100-145`

## External References

- 无；API 和数据库形状均来自项目契约与实现。

## Related Specs

- `.trellis/spec/backend/database-guidelines.md`：PostgreSQL 是权威业务状态，历史与不可变内容不得通过兼容或猜测逻辑补造。
- 当前任务 PRD 明确不创建或伪造内容任务/内容版本：`.trellis/tasks/07-25-staging-visual-defect-fixes/prd.md:59-64`。

## Caveats / Not Found

- 本次研究未登录公网、调用 API、SSH 或查询 PostgreSQL，因此没有取得当前真实 `contentVersionId`。
- API 登录会创建服务端会话记录，但不会写业务数据；仍应按 Runbook 在验收结束后退出登录并销毁本地认证状态。
- PostgreSQL fallback 是最后手段。API 已能枚举现有内容版本时，不应绕过权限边界直接查库。
- 直接数据库查询需要单独的 Hostdzire SSH 只读诊断授权；当前调研请求只授权定位命令，不授权执行。

## 2026-07-25 线上执行结果

- 已认证调用 `GET /api/v1/content-tasks` 返回 `200`，`items` 数量为 `0`。
- 随后按用户授权通过 `hostdzire` 对运行中的 PostgreSQL 设置 `PGOPTIONS="-c default_transaction_read_only=on"`；确认 `content_versions` 的任务外键列为 `task_id` 后，查询最新一条记录无输出。
- 结论：当前预发布 PostgreSQL 的 `content_versions` 表为空，不存在可提供或访问的线上 `contentVersionId`。不得猜测 ID 或为验收创建业务数据。
- 要完成内容审核页验收，需要先由正常业务流程产生一个仍存在的内容版本，或由用户提供一个经当前线上 API 验证有效的 `contentVersionId`。
