# 上线前最终发布候选验收（复验）：实施计划

## 0. 启动门禁

- [x] 用户评审并批准 `prd.md`、`design.md`、`implement.md`。
- [x] 批准后运行：

```bash
python3 ./.trellis/scripts/task.py start 08-03-pre-release-final-candidate-acceptance-rerun
```

- [x] 启动后运行 `trellis-before-dev`，完整读取任务文档、前端质量/视觉/组件/Hook 规范、E2E 隔离规范、Makefile 与隔离脚本。
- [x] 只测试、取证和报告；不修改产品、测试、合同、配置、依赖或视觉资产，失败另行立项。

## 1. 前置证据与冻结

- [x] 核对视觉恢复报告与发布取消回焦报告，确认 `e3dbe81`、`a778393` 均包含于冻结 HEAD。
- [x] 冻结 `main` 提交 `a568f9503aa181a29aa5dc740cf6d200bcf88998`；若启动时 HEAD 不同，停止并重新评审，不自动替换候选。
- [x] 记录北京时间、HEAD、`origin/main`、分支、工作区、提交祖先关系；允许差异仅为当前任务目录。
- [x] 记录 Python、Node、npm、uv、Docker、Compose、PostgreSQL、Redis 版本及依赖锁、合同、视觉源码和 11 张基线 SHA-256。
- [x] 记录 Alembic current/head、Compose 解析指纹、服务状态、同源 `/api` 探针、E2E 数据库/临时存储、浏览器会话和工具产物清单。

## 2. 七项必需门禁

运行前按 `design.md` 记录并控制开发 `frontend`、`worker`、`scheduler`，确认 Redis `celery` 队列为空。严格按以下顺序执行，每项记录开始/结束时间、耗时、退出码、数量和首个失败：

- [x] E2E 前保护第 1 节登记的 4 个执行前 `frontend/test-results` 文件；本轮产物清理后恢复并逐项复核原路径与 SHA-256。

```bash
make contract-check
make test-unit
make test-integration
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 make e2e
make lint
make typecheck
make build
```

- [x] `make contract-check` 完成并记录。
- [x] `make test-unit` 完成并记录。
- [x] `make test-integration` 完成并记录。
- [x] `make e2e` 在独立数据库和临时对象存储中完成；确认清理输出及资源不存在。
- [x] `make lint` 完成并记录。
- [x] `make typecheck` 完成并记录。
- [x] `make build` 完成并记录。
- [x] 恢复执行前开发服务边界，验证 Frontend、同源 `/api`、Worker 与 Scheduler；不因单项失败跳过其他安全独立门禁。

## 3. 关键页面 smoke

使用项目 `playwright-cli`、命名内存会话 `rc-final-rerun-20260803` 和真实同源 `/api`：

- [x] S0：匿名登录页、受保护入口和管理员真实登录。
- [x] S1～S3：桌面工作台、产品/事实、内容任务及首个可用详情。
- [x] S4：发布列表、候选/记录 Drawer 直接关闭回焦；“更多操作 → 标记已移除 → 取消”回到原更多按钮且未发送发布命令请求。
- [x] S5～S7：GEO 观测/洞察、AI、Prompt、用户和审计；审计详情关闭后回焦。
- [x] S8：`390×844` 登录、工作台、发布和 GEO；主操作可达且无页面级横向溢出。
- [x] 每页记录页面身份、主要 region/真实空态、console error/warning、失败请求、4xx/5xx 归因和关键焦点；不 mock、不保存 storage state、不写共享业务数据。

## 4. 清理与冻结复核

- [x] 确认本轮 E2E 数据库、临时对象存储和隔离端口已精确清理；不删除执行前既有资源。
- [x] 关闭并删除本轮命名浏览器会话，确认无活动 route；不触碰其他会话。
- [x] 精确清理本轮 `frontend/test-results`、`frontend/playwright-report` 和根 `.playwright-cli/` 新产物；保留 `frontend/.playwright-cli/` 已跟踪资产。
- [x] 恢复执行前开发服务，复核同源健康、Redis 队列、异常日志和服务状态。
- [x] 再次核对 HEAD、`origin/main`、工作区、合同、依赖锁、迁移头、Compose 指纹、视觉源码和基线均无漂移。
- [x] 运行 `git diff --check`；最终差异只允许当前任务目录。

## 5. 最终报告

- [x] 新增 `report.md`，记录冻结信息、环境指纹、七项门禁矩阵、S0～S8、失败归因、清理、未覆盖项和残余风险。
- [x] 按 `design.md` 机械输出唯一 `GO` / `NO-GO`；必需项的 `FAIL`、`BLOCKED`、`NOT_RUN` 均不得写成部分通过。
- [x] 明确结论只适用于报告中的本地冻结提交，不代表 `origin/main` 已同步、已部署或生产环境通过。
- [x] 若为 `NO-GO`，只给出最小独立后续任务建议，不在本任务修复；若为 `GO`，给出后续提交、归档和发布交接边界。

## 6. 质量与提交边界

- [x] 运行 `trellis-check`，复核冻结值、门禁数字、浏览器证据、清理和二元判定一致。
- [x] 判断是否存在需要写入稳定规范的新知识；没有新稳定合同则不运行 `trellis-update-spec`。
- [x] 提交前向用户展示结论、精确文件范围和验证结果并取得批准；不自动 push。

## 7. 可选项与明确排除

- 不运行 `make verify`：它会重复七项必需门禁；Compose 配置采用单独只读检查。
- 不重复第二轮全项目人工功能回归，不新增测试用例、脚本或证据框架。
- 不调用真实第三方 AI、生产 OSS 或发布渠道；不执行部署、性能、容量、渗透、灾难恢复或生产迁移。
- 不更新视觉基线、阈值或快照，不提交 Playwright CLI、测试报告或其他可再生产物。
