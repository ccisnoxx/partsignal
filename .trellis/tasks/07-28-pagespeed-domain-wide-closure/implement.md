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

每个子任务实施后执行独立 Trellis check；父任务最后再做一次全范围检查。

## 3. 外部状态闸门

- [ ] 获得搜索索引、llms、完整公开 source map、根域 DNS/HTTPS、`relay`
  DNS/路由决策和 TXT 控制权证明的集中确认。
- [ ] 展示精确生产变更和回滚命令，获得 DNS/Nginx/部署授权。
- [ ] 获权检查 Aaitr 和其他内部 resolver；完成全域 HTTPS 后，按
  300s → 7d → 30d → 1y 观察，每阶段等待完整 `max-age`。
- [ ] 添加 `preload` 和提交表单前，再取得不可逆操作确认。

## 4. 总验证

```bash
cd frontend
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
PARTSIGNAL_PERF_SAMPLES=5 npm run perf:production
PLAYWRIGHT_HTML_OPEN=never npm exec -- playwright test --project=e2e
cd ..
node deploy/scripts/check-nginx-security.mjs
sh deploy/scripts/test-deploy-staging.sh
git diff --check
```

另行执行：

- Chromium/Firefox/WebKit 人工与自动浏览器矩阵。
- 全部域名 DNS、证书、HTTP 同主机跳转、HTTPS、HSTS 检查。
- 三次新 PageSpeed 桌面复测。
- 最终关闭矩阵和文档一致性审查。

## 5. 提交边界

- [ ] 保留并排除用户已有 Playwright 日志修改。
- [ ] 更新相关 README、operations、部署方案和稳定 spec。
- [ ] 展示按 P0/P1/P2 分组的 commit plan；未确认不得提交。
- [ ] 不推送、不创建分支。
