# P0 安全与 `962850.xyz` 全域 HTTPS

## Goal

在不降低现有 CSP 强度、不增加 script `unsafe-inline/unsafe-eval` 的前提下，
关闭 CSP 兼容性和 Trusted Types 诊断；形成 `962850.xyz` 完整域名台账，
补齐根域和全部保留子域 HTTPS，并按官方流程完成 HSTS
`includeSubDomains` 观察与正式 preload。

## Confirmed Evidence

- `frontend/index.html` 含同步内联主题启动脚本；仓库安全头用精确 SHA-256 放行，
  触发 Lighthouse 的旧浏览器兼容提示。
- 项目六处 Markdown 预览重复执行 `marked → DOMPurify →
  dangerouslySetInnerHTML`。
- React 19.2.7 支持 `TrustedHTML`；当前 Ant Design 6.5.0 的
  `@rc-component/util` 和 `@ant-design/icons` 仍用 `style.innerHTML`。
- Cloudflare credentialed Zone GET 已确认 Zone 为 `active/full`，共有 14 条
  记录；8 个公开 Web A 为 `api/brutal/cpa/geo/leak/md2word/relay/vault`。
- 根域只有 MX/TXT、没有 Web 地址；`brutal` 和 `relay` HTTP 不可用；
  `relay` HTTPS 错误落到 `api` 默认 vhost；配置保留的 `probe` 目标不可达，
  `mux` 没有公共 DNS；当前仅 `geo`/`vault` 返回不带子域的 HSTS。
- 完整只读拓扑、逐名矩阵和脱敏控制权证据见
  `research/domain-inventory-2026-07-28.md`。
- 2026-07-28 已完成一次随机 TXT 写控制证明：两权威 NS 和两个公共 resolver
  均先返回唯一正确内容，删除后 Cloudflare API 为零记录且四端均为 NXDOMAIN；
  证据只保存名称与哈希。
- Aaitr 只读盘点确认本机没有 split-horizon resolver、hosts 名称、TLS 证书或
  443 监听；唯一业务入站是 WireGuard 上的 Shadowsocks `18443`。该运行态与
  DMIT 旧 `probe:443` 目标不一致。后续 DMIT 历史日志和白名单配置已确认
  `mux` 曾是有真实流量的 VLESS/Reality + multiplex 服务，但当前路径已移除。
  用户据当前 sing-box 与流量事实确认 `mux`、`probe` 退役；历史证据保留，不再
  恢复旧入口或猜测新服务契约。
- Hostdzire 原先没有 443 `default_server`，未知名称会落入首个 `api`
  vhost；第一批生产整改已按
  `research/domain-remediation-proposed-diff-2026-07-28.md` 部署 default
  catchall、根域、`brutal` 和 HSTS 准备值，执行及回滚证据见
  `research/first-production-batch-2026-07-28.md`。
- Hostdzire 根用户 crontab 已复核存在活动的每日 `acme.sh --cron`；证书续期、
  部署路径和 reload 仍须一次受控端到端验收，不能以“存在调度”直接关闭。

## Requirements

### R1. CSP

- 将主题启动脚本外置为同源、同步、无 defer/async 的静态脚本，保持首帧主题。
- `script-src` 最终只需 `'self'`；移除哈希维护，不允许宽松 fallback。
- 脚本新增的关键请求不得造成主题闪烁或明显性能回退。

### R2. Trusted Types

- 只允许 DOMPurify 内部、不可被业务代码直接调用的 `dompurify` 命名策略；
  所有项目 Markdown sink 统一消费其清洗后的 `TrustedHTML`。
- 不创建宽松 default policy。
- 用可复现依赖补丁将 Ant/rc-util 仅用于 `<style>` 的 `innerHTML` 改为
  `textContent`；补丁冲突必须使安装失败。
- 最终 CSP 包含
  `trusted-types dompurify; require-trusted-types-for 'script'`。

### R3. 域名控制权和清单

- 技术控制权证据包括 Cloudflare credentialed Zone GET、完整 Zone 导出和经
  授权的随机临时 TXT 挑战。挑战必须在两个权威 NS 和两个公共 resolver 可见，
  删除后再次验证不存在；不得保存 token、Cookie、私钥或 ACME 凭据。
- 公开 RDAP 用于记录注册商、到期日和 transfer lock。注册商登录截图不是
  Lighthouse、HSTS 或 preload 的正式要求，也不再作为技术整改硬门槛；残余风险
  是注册商账户登录、自动续费和 nameserver 恢复能力未被独立验证。
- 清单覆盖公开、内部、通配和嵌套子域，并交叉检查 DNS、Nginx/SNI、
  证书、内部 resolver、hosts 和访问日志。
- DMIT/Hostdzire/Aaitr 当前未发现本地域或 hosts 记录，但必须继续检查其余
  WireGuard/mesh 客户端和其他 split-horizon resolver；未检查不等于不存在。
- 用户已确认删除 `relay` DNS，并退役 `probe`/`mux`。`relay` 删除、DMIT
  `probe` 活动映射移除和 Hostdzire `mux` 活动别名移除仍需线上执行授权；
  `mux` 历史配置、日志和审计证据必须保留。

### R4. 全域 HTTPS

- 新增根域公开 DNS 和 HTTPS；HTTP 先同主机升级，根域 HTTPS 再跳转到 `geo`。
- 不主动创建 `www`；若 Zone 中存在记录则必须支持 HTTPS。
- 所有保留 Web 名称必须有有效证书、同主机 HTTP→HTTPS 和可用 HTTPS；
  纯 MX/TXT 标签保持非 Web，不为审核虚构地址。
- 一级通配证书不覆盖嵌套名称；任何内部或未来嵌套名称必须有显式 SAN、
  对应深度的通配证书，或在启用 `includeSubDomains` 前退役/迁出。
- 根域 `includeSubDomains` 继承策略由单一版本化 root snippet 拥有；现有
  精确主机一年 HSTS 统一为独立 host-only snippet，分阶段时不得把现有安全
  强度降到 300 秒。

### R5. HSTS 和 preload

- 阶段固定为 300s → 7d → 30d → 1y includeSubDomains；每阶段完成完整观察。
- 添加 `preload` 和提交表单前取得最终不可逆操作确认。
- HTTPS 异常优先恢复服务，不以降级 HTTP 作为主要回滚。
- 官方当前不普遍推荐 preload，且移除可能需 6–12 周或更久；该风险不能用
  `max-age=0` 消除，必须写入最终确认。

## Acceptance Criteria

- [x] AC1：HTML 零内联脚本，`script-src` 无 `unsafe-inline/unsafe-eval`，
  PageSpeed CSP 兼容诊断关闭，主题无闪烁。
- [x] AC2：Trusted Types enforcing 下项目、React、Ant、DOMPurify、
  Markdown 和测试零违规、零 TT TypeError。
- [x] AC3：全部项目 HTML sink 由命名策略拥有，恶意 Markdown 用例均被清洗。
- [ ] AC4：Cloudflare 14 条记录、内部/嵌套名称和历史配置均有已登记用途/
  负责人，或有证据支持的退役结论；DNS、入口、证书和结论完整，无“未检查即
  不存在”的名称。
- [x] AC5：根域 HTTPS、证书和同主机跳转通过；8 个公开 A 均得到处理；
  `brutal` 已修复，`relay`、`probe`、`mux` 已退役；后二者权威/公共 DNS 均为
  NXDOMAIN、活动 Nginx/sing-box/防火墙无服务引用，未知 SNI 被 default
  catchall 拒绝。
- [ ] AC6：各 HSTS 观察阶段均有时间、监控和结果记录。
- [ ] AC7：正式 preload 提交成功并最终验证状态为 `preloaded`。
- [ ] AC8：所有 DNS/Nginx/部署和不可逆动作都有明确授权与回滚记录。
