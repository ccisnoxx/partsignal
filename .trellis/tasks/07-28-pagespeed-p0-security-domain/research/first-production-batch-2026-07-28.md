# 第一批生产整改执行证据（2026-07-28）

## 范围与授权

本批按用户明确授权执行并提交到 `main`，覆盖应用发布、Hostdzire/DMIT
精确 Nginx 变更、根域 A 新增、`relay` A 删除及一次生产 PageSpeed 复测。
本批不含 ACME 受控续期、`includeSubDomains`、HSTS 阶段递增或 preload
提交；既有 Playwright 产物和 `.trellis/config.yaml` 始终未纳入提交。

## 发布与数据库

- 最终 release：`mvp-20260728-160657-dd5d9824cff8`；
  `/root/partsignal/current` 已指向该 release。
- 最终 Git commit：`dd5d9824cff8b9fef48b07f9d1a4d380838d69b3`。
- 正式数据库 revision：`0030_publication_record_delete`。
- 正式迁移前备份：
  `/root/partsignal/backups/partsignal-20260728T075904Z.sql.gz`，
  `root:root 0600`，SHA-256
  `f21ee85db3ab832d44c563a6c5e3ad2ccc5fa4737391a29de924746033cd5192`；
  `gzip -t` 和 PostgreSQL 16 tmpfs 隔离恢复、`0028 -> 0030` 迁移均通过。
- API、frontend、worker、scheduler 健康，generation 队列为 0；未清理旧
  release、镜像、备份或持久数据。

Trusted Types 首次生产构建暴露 `frontend/Dockerfile` 在 `npm ci` 后才复制
`patches/`，导致三份依赖补丁没有进入镜像，enforcing 下 Ant CSS-in-JS
触发四个 `innerHTML` 违规并出现白屏。现场先恢复旧安全/site 配置保持服务，
再以 commit `dd5d982` 将 `patches/` 提前复制；本地和生产构建均明确显示
三份补丁应用成功。最终重新启用 enforcing 后，匿名登录、认证工作台和
`/configuration/ai` 只读 smoke 均通过，console 零 error/warning，退出登录
并删除浏览器会话。

## Hostdzire、DMIT 与 DNS

- Hostdzire 回滚包：
  `/root/nginx-rollback-20260728T081402Z.aKruAm`，目录 `0700`、文件 `0600`。
- 首个 Nginx 候选因重复 `backlog=8192` 未通过 `nginx -t`，已自动恢复且没有
  reload。最终候选仅从 default catchall 移除重复参数，随后 `nginx -t`、
  reload 和服务状态检查通过。
- 新增根域 HTTPS 和明确的 443 default catchall；根域 HTTP 先
  `308 https://962850.xyz/...`，根域 HTTPS 再
  `308 https://geo.962850.xyz/`。根域 HSTS 为 `max-age=300`，不含
  `includeSubDomains/preload`；精确保留主机保持一年 HSTS。
- 对含 location 级 `add_header` 的既有站点使用 Nginx 1.29 原生
  `add_header_inherit merge`，避免 HSTS 被继承规则遮蔽；未复制第二套 header
  配置。
- Hostdzire `brutal` 的 8443 TLS 入口移除 `mux` 活动别名；DMIT 回滚包
  `/root/partsignal-ops/pagespeed-p0-20260728/dmit-probe-retire-20260728T081647Z`
  为 `0700/0600`，已删除 `probe.962850.xyz` SNI map。两端均先
  `nginx -t` 再 reload；未修改 sing-box、30090 或防火墙。
- 未知、`mux`、`probe` 的合成 SNI 均 fail-closed；`brutal` 仍为 200，
  其余保留业务的既有 200/302/307 行为未改变。
- Cloudflare 变更证据目录
  `/root/partsignal-ops/pagespeed-p0-20260728/dns-change-20260728T081807Z`
  为 `0700/0600`。新增 DNS-only 根域 A `154.21.86.86`，删除唯一精确
  `relay` record ID；除 SOA serial 和这两项预期变化外，记录不变。
- 根域 A 最终由两权威 NS、`1.1.1.1` 和 `8.8.8.8` 返回
  `154.21.86.86`；`relay`、`mux`、`probe` 在同四端均为 NXDOMAIN。
- 根域证书覆盖 `962850.xyz`/`*.962850.xyz`，有效期至 2026-09-30。

## PageSpeed 复测

当前唯一生产复测报告：
<https://pagespeed.web.dev/analysis/https-geo-962850-xyz/awwtb4ueds?form_factor=desktop>
（2026-07-28T08:22:03.006Z，Lighthouse 13.4.0）。

- Performance 90，Accessibility 100，Best Practices 100，SEO 100，
  Agentic Browsing 3/3。
- FCP 0.4s，LCP 0.5s，TBT 250ms，CLS 0，Speed Index 1.3s。
- production source map、robots、`llms.txt` 与 Baseline 审核均通过；
  Lighthouse 将 Trusted Types 列为 notApplicable，生产 enforcing 浏览器
  smoke 是实际零违规证据。
- 未使用 JavaScript 为 87,786 bytes，较原 134.4 KiB 下降但仍未关闭；
  未使用 CSS 为 17,320 bytes，仍未关闭。
- 旧报告的 110/90/75/61ms 任务全部消失，按用户批准的“入口边界整体消除”
  规则关闭；新报告仍有 285/88/68/67/66/63ms 六项，必须以新 trace 继续逐项
  归因，不能把 P1 标为完成。
- render-blocking 仍包含 `theme-init.js`（约 121ms）和入口 CSS；最长网络链为
  document → entry JS → `/api/v1/auth/me`。DOM 为 120 个元素、最大深度 17，
  Lighthouse 通过；LCP 元素为登录页底部安全说明，审核通过但仍记录了约
  1624ms element render delay。

## 未关闭项

1. 盘点其余 WireGuard/mesh/办公网 resolver、hosts 和嵌套名称。
2. 验证生产证书续期与 deploy/reload 端到端路径；完成前不进入
   `includeSubDomains` 阶段 1。
3. P1 对 87,786 bytes 未使用 JS、17,320 bytes 未使用 CSS、新六项长任务及
   render-blocking/网络链继续定向处理。
4. `includeSubDomains` 300s → 7d → 30d → 1y 的每个观察期，以及独立的
   preload 风险确认和正式提交，均未执行。
