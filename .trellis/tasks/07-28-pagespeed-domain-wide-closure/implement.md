# 实施计划：PageSpeed 与全域安全闭环

## 1. 规划和证据门禁

- [x] 创建父任务与 P0/P1/P2 子任务。
- [x] 保存当前 PageSpeed 和只读域名/Nginx/证书证据。
- [x] 将旧 PageSpeed 任务标记为历史来源而非当前权威。
- [x] 完成每个子任务的 PRD、设计和实施计划并通过 `task.py validate`。

## 2. 本地实施顺序

1. 启动 P0 子任务，先完成不触发外部状态的 CSP 外置、Trusted Types、
   依赖兼容补丁和本地 Nginx 检查。
2. 启动 P1 子任务，完成 coverage/trace、初始包和 CSS 优化及长任务归因。
3. 启动 P2 子任务，先完成 Baseline fallback 和人工审核设施。
4. 在修改索引、llms、source map 前，展示公开面风险并取得一次明确确认。

已有本地证据不重复执行。后续每次只检查本次变化；父任务不再额外重跑与子任务
相同的全量套件。

## 3. 外部状态闸门

- [x] 获得搜索索引、llms、完整公开 source map的工作区实现确认；该项不包含
  应用发布授权。
- [x] 获得根域行为、`relay` 删除、`mux/probe` 退役的产品选择，以及
  TXT 写证明和 Aaitr 只读检查授权；该项不包含 DNS/Nginx 执行授权。
- [x] 按用户授权把 Cloudflare BIND 原文保存到 Hostdzire root 专用 `0700`
  运维目录的 `0600` 文件；仓库仅记录路径、大小、时间和 SHA-256。
- [x] 完成 Aaitr 本机只读检查，并展示根域/`relay`/default 443/`brutal`/
  HSTS 的精确生产提案、部署顺序和独立回滚。
- [ ] 用户审阅 P0
  `research/domain-remediation-proposed-diff-2026-07-28.md` 后，明确授权应用
  发布、Hostdzire reload 和根域/`relay` DNS。
- [ ] 获线上配置授权后，按“Hostdzire default catchall → 移除 Hostdzire
  `mux` 别名 → 移除 DMIT `probe` map”顺序完成退役；同时补齐其余内部
  resolver 清单。完成全域 HTTPS 和 ACME 续期验收后，按
  300s → 7d → 30d → 1y 观察，每阶段等待完整 `max-age`。
- [ ] 每个 `includeSubDomains` 阶段开始前确认上一阶段证据；添加 `preload`
  和提交表单前，再取得独立不可逆操作确认。

## 4. 分阶段最小验证

- 规划/文档变化：只运行 `task.py validate`、结构化文件解析和
  `git diff --check`；不运行前端套件。
- 前端代码再次变化：只运行受影响的定向测试；TypeScript 变化补一次
  `typecheck`。不重复已通过的三浏览器、全量 Vitest 或五样本性能矩阵。
- 唯一发布候选形成时：运行一次 `build`、安全头/production assets 门禁和受影响
  浏览器 smoke；只有失败并修复后才重跑失败项。
- Nginx/DNS 批次：只运行变更前快照、两台 `nginx -t`、reload 后逐名
  DNS/TLS/HTTP 和 default fail-closed 探针；不运行本地前端套件。
- 部署后先执行一次 source-map-enabled PageSpeed desktop。全部阈值通过即关闭；
  未通过时只针对仍失败的 audit 处理并复测，不预先安排三次重复运行。
- HSTS 每阶段仍执行必要的 DNS、证书、响应头和业务探针；这是不可逆安全门禁，
  不与前端测试重复。
- 最后只更新一次关闭矩阵和文档一致性记录。

## 5. 提交边界

- [ ] 保留并排除用户已有 Playwright 日志修改。
- [x] 新增稳定 infra spec，覆盖 DNS/原文/Nginx/HSTS/preload 的执行契约。
- [ ] 更新相关 README、operations 和部署方案。
- [ ] 展示按 P0/P1/P2 分组的 commit plan；未确认不得提交。
- [ ] 不推送、不创建分支。
