# 发布记录删除边界与页面取证

## 删除资格

- 发布记录绑定内容版本、平台账号和创建者；状态事件、附件、关注事项、GEO 引用均使用 `RESTRICT`：`backend/app/models/publication.py:66-170`、`backend/app/models/geo_files.py:59-90`。
- `PUBLISHED` 与 `VERIFIED` 的历史资格必须读取追加式 `publication_status_events`，不能只看当前状态：`backend/app/services/publication.py:347-390`。
- `REMOVED` 与 `VERIFICATION_FAILED` 会创建唯一关注事项；关注事项及修复来源不可删除或改绑：`backend/app/services/publication.py:438-623`、`contracts/database.md:97-105`。
- 物理删除仅适用于从未出现 `PUBLISHED/VERIFIED` 事件且没有 GEO、关注事项或修复引用的记录。状态事件和附件关系是聚合内部子项，可在事务级 UUID 门禁下显式删除；审计日志保留。

## 操作投影

- 当前 `publication_actions(status)` 只按状态返回动作，详情与列表共同消费：`backend/app/services/publication_queries.py:55-72,145-220,251-350`。
- 删除资格需要批量投影，列表不得逐行查询；详情与删除服务仍需重新校验。
- 前端当前只把 `available_actions[0]` 渲染为一个按钮，其他服务端动作不可发现：`frontend/src/features/publications/PublicationWorkspace.tsx:403-452`。
- 推荐交互是一个高频主入口加“更多操作”菜单；删除、标记已移除和验证失败均经过确认，不新增前端状态机。

## “发布需关注”

- OPEN 关注事项只由 `REMOVED` 或 `VERIFICATION_FAILED` 触发：`.trellis/spec/backend/publication-workbench-guidelines.md:24-35`。
- 工作台已有关注 Tab 和处理入口，但总览链接仍指向默认 `/publications`：`frontend/src/features/dashboard/DashboardPage.tsx:35-48`、`frontend/src/features/publications/PublicationWorkspace.tsx:223-230,459-503`。
- 总览应直达 `/publications?tab=attentions`；工作台说明触发条件，并保留查看、创建修复任务和显式解决动作。

## Playwright 取证

- Playwright CLI 实际打开 `http://127.0.0.1:5173/` 后进入 `/login`。
- Vite 代理请求 `/api/v1/auth/me` 与 `/api/v1/auth/login` 返回 500；同一登录请求直连 `127.0.0.1:18000` 返回 200。
- `frontend/vite.config.ts:8-14` 默认代理到 `localhost:8000`，当前后端实际运行于 18000。验收启动时显式设置 `VITE_API_PROXY_TARGET=http://127.0.0.1:18000`，不修改产品默认端口来适配一次本地进程。
