# 实施计划：P0 安全与全域 HTTPS

## 1. 本地 CSP

- [x] 外置主题启动脚本并保持同步首帧主题。
- [x] 更新 CSP、安全头检查、部署自检和相关文档。
- [x] 增加 light/dark/system、无 localStorage、异常 storage 的单元和浏览器测试。
- [x] 验证不含 script `unsafe-inline/unsafe-eval`，且无主题闪烁。

## 2. Trusted Types

- [x] 建立共享 Markdown 安全边界，迁移全部六处 sink。
- [x] 增加恶意 HTML/SVG/URL 清洗测试。
- [x] 添加最小可复现依赖补丁，将 style `innerHTML` 改为 `textContent`。
- [x] 增加静态 DOM sink 所有权门禁，拒绝未登记 sink 和直接 HTML DOM API。
- [x] 在本地 Chromium enforcing 下验证代表性 Markdown、React、Ant 和主题交互。
- [x] Firefox/WebKit 验证无 TT 支持时仍执行相同清洗。
- [ ] 生产部署前先用 report-only 覆盖全部路由，零未处理 sink 后切换 enforcing。

## 3. 本地验证

```bash
cd frontend
npm ci
npm exec -- vitest run
npm run typecheck
npm run lint
npm run build
PLAYWRIGHT_HTML_OPEN=never npm exec -- playwright test --project=e2e
cd ..
node deploy/scripts/check-nginx-security.mjs
sh deploy/scripts/test-deploy-staging.sh
git diff --check
```

2026-07-28 已完成的本地证据：

- `npm ci` 成功并严格应用三份版本化补丁；
- Markdown 与五个相关页面测试文件共 52 项通过；
- `typecheck`、`lint`、生产构建、安全头检查和预发布部署自检通过；
- 主题 Chromium 用例 10 项通过；
- Trusted Types 用例分别在现有 `e2e`（全局 `Desktop Chrome`）、
  `trusted-types-firefox` 和 `trusted-types-webkit` 项目通过；
- Chromium enforcing 下恶意 Markdown、React、Ant 下拉和主题交互均无
  `securitypolicyviolation` 或 `pageerror`。
- `check-nginx-security.mjs` 已遍历 `frontend/src`，确认六处
  `dangerouslySetInnerHTML` 全部由 `renderSanitizedMarkdown` 持有，且无直接
  `innerHTML`/`outerHTML`/`insertAdjacentHTML` 等旁路。

## 4. 外部 HTTPS 门禁

- [x] 使用 credentialed GET 脱敏读取 `active/full` Cloudflare Zone，确认
  14 条记录和遗漏的 `relay`；权威 NS 查询结果一致。
- [x] 只读检查 DMIT stream/Unbound/sing-box、Hostdzire Nginx/证书/ACME，
  建立当前逐名矩阵，未读取凭据或私钥。
- [ ] 获得脱敏注册商账户证据，并将完整 BIND Zone export 保存到受控运维位置；
  仓库只保存脱敏派生清单。
- [ ] 展示临时随机 TXT 的新增、双权威/双公共验证、删除、NXDOMAIN 验证命令；
  获授权后完成一次性写控制证明。
- [ ] 获得 Aaitr 及其他内部 resolver/hosts 的只读检查授权，关闭 `probe` 和
  所有内部/嵌套名称清单。
- [ ] 由用户确认 `relay` 保留/删除、`mux` 与 `probe` 修复/退役；未知用途不得
  由实现者猜测。
- [ ] 展示并确认根域 A、`relay` 决策、Hostdzire 根域/80/443/default catchall、
  `brutal` 80/8443、Aaitr 和共享 HSTS snippet 的精确 diff 与逐项回滚。
- [ ] 获授权后先保存 Zone、`nginx -T`、证书、sing-box 路由和响应快照；
  修改后运行所有宿主的配置检查，再按一次一层的顺序 reload。
- [ ] 在不启用 `includeSubDomains` 的准备阶段，确认根域和全部保留 Web 名称：
  证书有效、80 同主机升级、443 业务探测正确、无未知 Host 落入业务 vhost。
- [ ] 部署共享域级 HSTS snippet 前运行 `nginx -t`、Reality 回归和完整响应矩阵。

## 5. HSTS 观察与 preload

- [ ] 阶段 0：保持现有 HSTS，完成全域 HTTPS/监控并验证至少一次 ACME 自动续期
  或受控 staging renew；未完成不得进入阶段 1。
- [ ] 阶段 1：根域和全部 TLS vhost 使用
  `max-age=300; includeSubDomains`，双外网 + 内网验证并等待完整 5 分钟。
- [ ] 阶段 2：使用 `max-age=604800; includeSubDomains`，持续观察并等待 7 天。
- [ ] 阶段 3：使用 `max-age=2592000; includeSubDomains`，持续观察并等待 30 天。
- [ ] 阶段 4：使用 `max-age=31536000; includeSubDomains`，额外观察至少 30 天；
  期间任何新增名称都先完成 HTTPS。
- [ ] 最终门禁：展示官方“不普遍推荐 preload”、全子域强制 HTTPS和移除
  6–12 周或更久的风险；重新取得不可逆确认。
- [ ] 最终配置：
  `max-age=63072000; includeSubDomains; preload`；确认根域重定向响应也带 header，
  preloadable API 零 error/warning 后再人工提交正式表单。
- [ ] 保存 submission 时间和响应，持续验证 `pending`、Chromium 源列表和最终
  `preloaded`；传播期间保持全部要求，不以提交成功代替最终关闭。

## 6. 文档和检查

- [ ] 更新 operations、Hostdzire runbook、部署方案和稳定安全规范。
- [ ] 执行 Trellis check；所有高、中问题清零。
- [ ] 形成逐项证据和回滚记录，不自动提交、推送或部署。
