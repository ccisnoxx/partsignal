# PageSpeed 与 `962850.xyz` 全域诊断闭环

## Goal

以 2026-07-27 Lighthouse 13.4.0 的 PageSpeed 桌面报告
`ibm9s8ga5b` 为唯一当前基线，完成报告中全部失败项、性能诊断、
Baseline Newly Available、SEO、Agentic Browsing、十项无障碍人工审核和
结构化数据人工审核的“报告证据 → 根因 → 修改 → 验证”闭环。

安全范围扩展到整个 `962850.xyz`：证明域名控制权，形成公开与内部 DNS
清单，补齐根域和全部保留子域 HTTPS，按官方阶段启用
`includeSubDomains`，并在最终确认后正式提交 HSTS preload。

本任务取代仍在进行的
`07-27-pagespeed-performance-security-hardening` 的现行产品决策。旧任务保留为
历史证据，但其中“不允许索引、不提供 llms.txt、不发布生产 source map、不扩散
HSTS”的约束不再作为当前实现基线。

## Source Evidence

- 当前报告：
  `https://pagespeed.web.dev/analysis/https-geo-962850-xyz/ibm9s8ga5b?form_factor=desktop`
- 报告采集时间：`2026-07-27T14:18:47.385Z`。
- 分数：Performance 99、Accessibility 100、Best Practices 100、SEO 54、
  Agentic Browsing 2/3。
- 指标：FCP 0.5s、LCP 0.5s、TBT 90ms、CLS 0、Speed Index 1.2s。
- 未使用 JavaScript 137,660 B，未使用 CSS 17,320 B。
- 长任务：181ms 无法归因，以及入口脚本 110ms、90ms、75ms、61ms。
- 完整证据清单见 `research/current-baseline.md`。

## Requirements

### R1. 任务边界

- P0、P1、P2 分别由三个子任务拥有并独立验收；父任务拥有报告快照、公开面
  授权、跨子任务回归和最终 PageSpeed 复测。
- 不因审计不计分、收益低、来自依赖、内部系统或人工审核而跳过。
- 每个条目必须记录原始证据、权威根因位置、最小安全实现、行为/公开面/
  兼容性变化、验证、阈值、部署/回滚和额外授权。

### R2. 安全不变量

- 不向 `script-src` 增加 `unsafe-inline` 或 `unsafe-eval`，不扩大第三方脚本源。
- Trusted Types 不允许宽松、无清洗的 default policy；Markdown 仍以
  DOMPurify 为唯一 HTML 清洗边界。
- 认证、权限、数据来源和服务端权威不变；不得为分数删除会话探测或隐藏失败。
- 无法在不降低安全性或破坏核心业务的情况下关闭的条目必须停下来请求用户决策。

### R3. 公开面和外部状态门禁

以下行为在实现或执行前必须取得用户明确确认：

- 将 `noindex,nofollow` 和 robots 全站屏蔽改为允许索引。
- 公开 meta description、`llms.txt` 和含 `sourcesContent` 的生产 source map。
- 新增根域 DNS/HTTPS、临时 DNS TXT 控制权证明，删除或修改 `relay` 等现有
  记录，或修改其他公开/内部子域配置。
- 启用 `includeSubDomains`、添加 `preload`、提交 preload 表单。
- 部署、提交或任何其他线上/外部状态变化。

### R4. 工作区与 Git

- 保留现有 `.playwright-cli/console-2026-07-25T03-18-34-565Z.log`，不得修改或纳入提交。
- 只在现有 `main` 工作目录工作，不创建分支、不推送。
- 提交前提供完整 commit plan 并等待确认。

## Acceptance Criteria

- [ ] AC1：P0/P1/P2 子任务的全部验收项完成，父任务关闭矩阵没有 Pending、
  无证据的 N/A 或“低收益跳过”。
- [ ] AC2：三次新的 PageSpeed 桌面复测均为 Performance ≥99，
  Accessibility/Best Practices/SEO=100，Agentic Browsing=3/3。
- [ ] AC3：FCP/LCP ≤0.8s、TBT 中位数≤50ms且单次≤100ms、CLS=0、
  Speed Index≤1.2s。
- [ ] AC4：未使用 JS≤100 KiB、未使用 CSS≤12 KiB；页面自有任务无
  超过 50ms 的 long task。
- [ ] AC5：CSP 不含 script `unsafe-inline/unsafe-eval`；Trusted Types
  enforcing 下零违规；生产 source map 完整有效。
- [ ] AC6：十项无障碍人工审核和结构化数据人工审核均有浏览器、步骤、证据和结论。
- [ ] AC7：Cloudflare 全量 Zone、公开/内部/嵌套名称与配置保留名无未知项；
  所有保留 Web 名称 HTTPS 正常，HSTS preload 最终状态为 `preloaded`。
- [ ] AC8：所有公开面、不可逆和部署动作均有用户授权记录及可执行回滚说明。
- [ ] AC9：认证、权限、业务数据与 API 契约未因优化改变。
