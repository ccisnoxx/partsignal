# P2 兼容性、SEO 与 Agentic

## Goal

处理当前报告的全部 Baseline Newly Available、生产 source map、SEO、
Agentic Browsing、十项无障碍人工检查和结构化数据人工检查。公开索引、
`llms.txt` 和 source map 必须按已批准设计先展示风险并取得明确确认。

## Confirmed Evidence

- Baseline：React DOM 的 `scrollend`；项目和 Ant 的 `:has()`；Ant Form 的
  `text-wrap: balance`；项目的 `backdrop-filter` 与 `mask-image`。
- 生产构建没有 source map。
- SEO 因 `noindex,nofollow`、robots `Disallow: /` 和缺 meta description
  得分 54。
- `llms.txt` 缺 H1 和有效链接，Agentic Browsing 2/3。
- Lighthouse 列出十项 accessibility manual 和 structured data manual。
- 当前仓库没有 JSON-LD、microdata 或 RDFa。
- 2026-07-28 本地实施后：项目代码中的 `:has()` 为零，Chromium、Firefox、
  WebKit 兼容用例各 3/3 通过；十项无障碍人工审核全部 Closed，发现的三个
  Drawer/Dropdown 焦点与名称问题均已修复并回归。
- Firefox 关闭 `layout.css.backdrop-filter.enabled` 的独立降级用例 1/1 通过；
  mask 改为默认隐藏、支持时增强；长中英文 Ant Form 标签在三浏览器实际换行且
  不溢出。
- 结构化数据经源码、渲染 DOM 和 Schema.org Validator 检查为 0 个实体、
  0 个无效实体；Google Rich Results Test 匿名入口要求登录，未借用用户账号。

## Requirements

### R1. Baseline

- 项目自己的 `:has()` 全部改为显式类或组件 `rootClassName`；不得 patch 项目
  逻辑为模糊 fallback。
- 复用已有 backdrop-filter fallback；mask 不支持时隐藏纯装饰点阵。
- `scrollend` 和 text-wrap 明确依赖来源、项目使用情况和跨浏览器 fallback。
- Chromium/Firefox/WebKit 必须覆盖滚动、表单长标签、焦点、打印和登录视觉。

### R2. Source map

- Vite 生成外部 production source map，并保留完整 `sourcesContent` 和
  `sourceMappingURL`，使 PageSpeed 能匿名抓取并无缺项警告。
- 发布前扫描凭据、`.env`、私钥、绝对本机路径和其他不应公开内容。
- 不以 access control、Google IP 白名单或短期 URL 伪装通过；公开风险必须先确认。

### R3. SEO 与 Agentic

- 经确认后将 robots meta 改为 `index,follow`，robots 改为 `Allow: /`。
- 增加准确、不泄露内部事实的 meta description。
- `llms.txt` 只包含一个 H1、授权登录说明和公开根/登录链接。
- 认证和服务端权限继续作为数据安全边界。

### R4. 人工审核

- 十项 accessibility manual 每项记录测试人、日期、浏览器、视口、步骤、证据。
- 发现缺陷必须修改所属组件并增加回归测试，然后重跑全部十项。
- 结构化数据使用 Rich Results Test、Schema.org validator 和源码检查；没有
  结构化实体时记录 0 个实体/0 个错误，不虚构业务事实。

## Acceptance Criteria

- [x] AC1：项目 CSS 零个 `:has()`，所有 Baseline 项有来源、fallback 和三浏览器证据。
- [ ] AC2：production map 可匿名获取、解析成功、sources 与 sourcesContent
  完整，PageSpeed valid-source-maps 无警告。
- [ ] AC3：SEO=100，crawlable、robots 和 meta description 通过。
- [ ] AC4：`llms.txt` 返回 200，含一个 H1 和两个有效公开链接；Agentic=3/3。
- [ ] AC5：十项 accessibility manual 全部 Closed，Accessibility 保持 100。
- [x] AC6：结构化数据人工审核完成且零无效实体。
- [x] AC7：公开索引、llms 和 source map 修改前存在用户授权记录。
- [x] AC8：README、测试和当前产品契约同步，不保留“不维护这些资产”的现行约束。
