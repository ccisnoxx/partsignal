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

## 3. 本地验证（已完成，不重复）

除非 P0 代码再次变化，否则直接复用下列 2026-07-28 证据，不再重复 `npm ci`、
全量 Vitest、三浏览器 E2E、构建或 staging 自检。若有新修改，只运行对应定向
测试；唯一发布候选形成时再各运行一次构建、安全头/资产门禁和受影响 smoke。

2026-07-28 已完成的本地证据：

- `npm ci` 成功并严格应用三份版本化补丁；
- Markdown 与五个相关页面测试文件共 52 项通过；
- `typecheck`、`lint`、生产构建、安全头检查和预发布部署自检通过；
- 主题 Chromium 用例 10 项通过；
- Trusted Types 用例分别在现有 `e2e`（全局 `Desktop Chrome`）、
  `trusted-types-firefox` 和 `trusted-types-webkit` 项目通过；
- 用例从权威 Nginx snippet 读取完整生产 CSP，注入生产构建 preview 的 document
  响应后分别通过 Chromium、Firefox、WebKit 各 2 项；它证明构建产物在该策略下
  可运行，不证明 Nginx 已实发响应头。Chromium enforcing 下恶意 Markdown、
  React、Ant 下拉和主题交互均无 `securitypolicyviolation` 或 `pageerror`；
  Vite 开发服务器因内联 React Refresh preamble 被同一 CSP 正确拒绝，不作为
  生产 CSP 测试服务器。
- `check-nginx-security.mjs` 使用 TypeScript AST 遍历浏览器生产源码
  `frontend/src`（排除测试）和 `frontend/public`，确认六处
  `dangerouslySetInnerHTML` 全部由 `renderSanitizedMarkdown` 持有；负向自检覆盖
  重赋值、格式变化、常量计算成员名、`document`/危险方法别名和直接 DOM HTML
  API。任意动态运行时路径仍由 Trusted Types enforcing 与生产 report-only
  验证关闭。

## 4. 外部 HTTPS 门禁

- [x] 使用 credentialed GET 脱敏读取 `active/full` Cloudflare Zone，确认
  14 条记录和遗漏的 `relay`；权威 NS 查询结果一致。
- [x] 只读检查 DMIT stream/Unbound/sing-box、Hostdzire Nginx/证书/ACME，
  建立当前逐名矩阵，未读取凭据或私钥。
- [x] 将完整 BIND Zone export 保存到 Hostdzire root 专用 `0700` 运维目录的
  `0600` 文件；仓库只保存脱敏派生清单、路径、时间、大小和 SHA-256。当前导出
  含 14 条用户记录和 2 条 provider NS。
- [x] 复核注册商证据边界：公开 RDAP 已记录 Spaceship、到期日与 transfer
  lock；登录截图不是 Lighthouse/HSTS/preload 正式要求，不再作为技术硬门槛，
  未验证的账户恢复和自动续费能力作为残余风险记录。
- [x] 展示临时随机 TXT 的新增、双权威/双公共验证、删除、NXDOMAIN 验证命令；
  获授权后完成一次性写控制证明。
- [x] 获得授权并完成 Aaitr 本机 resolver/hosts、监听和名称的只读检查。
- [ ] 盘点其余 WireGuard/mesh/办公网 resolver/hosts，关闭所有内部/嵌套
  名称清单；当前开发工作站已完成本机配置和私网 DNS 上游运行时探测，只剩
  上游设备配置所有权及其他客户端/网络。
- [x] 由用户确认 `relay` 删除，`mux` 与 `probe` 退役；历史备份、日志和审计
  证据保留。
- [x] 展示根域 A、`relay` 删除、Hostdzire 根域/80/443/default catchall、
  `brutal` 80、source map header 和 HSTS snippet 的精确提案与逐项回滚。
- [x] 用户审阅
  `research/domain-remediation-proposed-diff-2026-07-28.md` 后，明确授权应用
  发布、Hostdzire/DMIT Nginx、根域/`relay` DNS 第一批执行；该授权不含
  commit/push、ACME、`includeSubDomains` 或 preload。
- [x] 获得 scoped commit/push 授权：排除既有 Playwright 日志和
  `.trellis/config.yaml`，只提交已展示的前端/发布门禁与 Trellis 文档范围；
  push 后从干净 `main` clone 制作 release，不 stash、回退或覆盖用户改动。
- [ ] 获线上配置写授权后，先部署 Hostdzire 443 default catchall，再从
  Hostdzire 8443 vhost 移除 `mux` 别名、从 DMIT SNI map 移除 `probe`；不恢复
  sing-box inbound、30090、防火墙或 DNS。每台先备份并分别通过 `nginx -t`，
  reload 后验证两名双权威/双公共 NXDOMAIN、活动配置零引用、未知 SNI 被拒绝。
- [ ] 获授权后先保存 Zone、`nginx -T`、证书、sing-box 路由和响应快照；
  修改后运行所有宿主的配置检查，再按一次一层的顺序 reload。
- [ ] 在不启用 `includeSubDomains` 的准备阶段，确认根域和全部保留 Web 名称：
  证书有效、80 同主机升级、443 业务探测正确、无未知 Host 落入业务 vhost。
- [ ] 部署 host-only 与 root HSTS snippet 前运行 `nginx -t`、Reality 回归和
  完整响应矩阵；准备阶段不得含 `includeSubDomains`。

## 5. HSTS 观察与 preload

- [ ] 阶段 0：现有精确主机保持一年 HSTS；根域使用 300 秒且不含
  `includeSubDomains`。完成全域 HTTPS/监控，并验证活动的每日
  `acme.sh --cron` 至少成功续期部署一次，或经另行授权完成受控 staging
  renew；未完成不得进入阶段 1。
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

- [x] 新增 `.trellis/spec/infra/domain-security-operations.md`，固化 DNS 精确写入、
  受控原文、Nginx 检查/回滚、服务退役和 HSTS/preload 授权契约。
- [ ] 更新 operations、Hostdzire runbook、部署方案和稳定安全规范。
- [x] 执行 Trellis check；文档一致性、JSON、受控文件权限/哈希、任务结构和
  稳定 spec 检查通过，高、中问题为零。
- [ ] 形成逐项证据和回滚记录，不自动提交、推送或部署。

2026-07-28 新增证据：

- `research/cloudflare-zone-sanitized-2026-07-28.json` 保存 14 条记录的脱敏
  派生清单；Cloudflare BIND export 原文已于 `2026-07-28T07:27:53Z` 保存到
  Hostdzire `/root/partsignal-ops/pagespeed-p0-20260728/` 的 `0600` 文件，
  目录 `0700`，SHA-256 为
  `1ba08f457da1d5469c9eac0ea65cdab358c31e4e3d10ddc91ebaff164714daba`。
- `research/domain-control-proof-evidence-20260728T055825Z.jsonl` 证明随机 TXT
  在两权威 NS 与 `1.1.1.1`、`8.8.8.8` 同时可见，随后按 record ID 删除；
  API absence、四端 NXDOMAIN 与最终 `proof_complete` 全部通过。
- `research/aaitr-inventory-2026-07-28.md` 关闭 Aaitr 本机 resolver/hosts/名称
  范围，并证明 Aaitr 非 TLS `18443` 不是 DMIT 旧 `probe:443` 的安全替代。
  用户已据此确认 `mux/probe` 退役，不再等待猜测的服务契约。
- `research/workstation-resolver-inventory-2026-07-28.md` 关闭当前开发工作站的
  hosts、域专用 resolver 和活动常见 mesh 客户端范围；其私网 DNS 上游会为
  公共 NXDOMAIN 合成短 TTL A，但 `mux/probe/plain/www` 和随机嵌套名称经该
  路径均无可达 HTTP/TLS 服务。上游设备配置所有权及其他网络/设备仍为 Open。
- `research/mux-probe-traffic-contract-2026-07-28.md` 证明 `mux` 在 7 月仍有
  成功长连接，并恢复其历史 VLESS/Reality + multiplex 路径；用户随后确认
  `mux/probe` 退役。历史证据保留，恢复候选作废，线上活动引用删除仍待授权。
- `research/domain-remediation-proposed-diff-2026-07-28.md` 保存根域、
  `relay`、default 443、`brutal`、HSTS、部署顺序和独立回滚提案；线上执行、
  `includeSubDomains` 与 preload 均未授权、未执行。
- 主 Agent 复核 Hostdzire 根 crontab，确认每日 `23:49` 的活动
  `acme.sh --cron`；续期和证书部署仍须端到端验收。
