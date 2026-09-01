# V2 线上只读 UI/UX 与冒烟验收报告

## 结论

本轮 `20260830-175056-v2-readonly` 对 `https://geo.962850.xyz` 完成波次 0–1 匿名 Chromium 只读验收。整体结论为 **FAIL（P2）**：公开环境、匿名认证边界、路由和键盘检查达到本轮通过标准，但登录页在 320/375px 下四个关键控件高度均为 32px，低于项目视觉合同要求的移动端至少 44×44 CSS px（`P2-001`）。部分运行时事件清单仍受工具能力限制，已按 `NOT_RUN` 处理，未据此宣称完整运行时检查通过。该问题不阻断匿名键盘流程，但需要前端修复后复验。

本报告将目标称为“公网 V2 Staging/预发布运行态”。现有证据没有新的 Production Cutover/Observation，因此不代表 Production 已通过。

## 运行信息

- run-id：`20260830-175056-v2-readonly`
- 执行时间：2026-08-30 17:50:56–17:56:24（Asia/Shanghai）
- 目标 URL：`https://geo.962850.xyz`
- 浏览器：Chromium，playwright-cli 临时匿名 context
- 会话：主执行 `v2-live-readonly-175056`；AC3 证据复核 `v2-live-readonly-recheck-20260830-ac3`
- 约束：无登录、无 storage state、无 cookie/localStorage 写入、无 `page.route`/mock、无业务 mutation、无 SSH、无部署或服务器修改
- 工作区保护：启动前已有 5 项归档文件变化及任务目录变化；本轮未修改、删除、回退或提交既有变化

## 环境身份与健康

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| 首页 | PASS | HTTP 200，`text/html`，最终 URL保持 `https://geo.962850.xyz/` |
| `/login` | PASS | HTTP 200，`text/html`，最终 URL保持 `/login` |
| 页面标题 | PASS | `PartSignal Frontend V2` |
| live | PASS | `{"status":"ok","checks":null}` |
| ready | PASS | `{"status":"ok","checks":{"postgresql":"ok","redis":"ok"}}` |
| 当前可证实 release | PASS | `mvp-20260830-133651-a663bcce`（来自最新部署执行材料） |
| 环境语义 | PASS | `.env.staging`、`partsignal-staging`、fake OSS；无 Production Cutover/Observation 证据 |
| 维护/发布状态 | PASS | 本轮未见维护页、连续健康失败或环境身份漂移 |

## 验收状态汇总

| 验收标准 | 状态 | 说明 |
| --- | --- | --- |
| AC1 环境身份 | PASS | 时间、目标、health、标题、V2 marker 和预发布语义已记录 |
| AC2 独立匿名只读 | PASS | 唯一命名 Chromium；未登录、未 mock、未写入 |
| AC3 canonical/legacy/unknown 路由 | PASS | 独立 AC3 复核等待页面离开登录校验过渡态后，补齐 canonical/legacy/unknown direct/refresh 与代表 Back/Forward 最终稳定状态 |
| AC4 响应式与 200% | FAIL | 五档视口无页面级溢出，但 320/375 控件高度不满足 44px（P2-001）；真实 200% 缩放因工具限制为 `NOT_RUN` |
| AC5 键盘/焦点/标签 | NOT_RUN | Tab、Shift+Tab、空提交、密码切换、焦点可见性和错误关联通过；reduced-motion 变体为 `NOT_RUN`，因此本 AC 不宣称完整通过 |
| AC6 运行时/网络 | NOT_RUN | console 0 errors；静态资源 200；CSP/TT 头存在；pageerror/requestfailed 独立事件列表为 `NOT_RUN`，因此本 AC 不宣称完整通过 |
| AC7 缺陷和截图 | PASS | `P2-001` 含复现、预期/实际、视口和截图；关键截图已人工检查 |
| AC8 登录后边界 | PASS | 明确列出无凭据未覆盖内容，不继承历史结论 |
| AC9 会话收口 | PASS | 主执行与 AC3 复核会话均已精确关闭；`playwright-cli list --all --json` 显示 `browsers` 与 `servers` 均为空 |
| AC10 未修改产品/合同/部署 | PASS | 仅写入本任务 artifacts 与 research 摘要 |

## 发现与证据

已保存的用例、路由最终 URL、运行时摘要和缺陷详见 [wave-0-1-results.md](case-results/wave-0-1-results.md)。首轮过渡帧证据没有被当作通过依据；补测后的最终稳定 URL 和页面标识单独保存在 [ac3-recheck-20260830.yml](case-results/ac3-recheck-20260830.yml)。

关键截图：

- [1440×900 登录页](screenshots/01-login-1440.png)
- [320×800 登录页](screenshots/02-login-320.png)
- [375×900 登录页](screenshots/03-login-375.png)
- [未知路径 404](screenshots/04-unknown-404.png)

截图只证明本轮可见布局和状态，不单独证明完整 WCAG 合规。

## 未覆盖与限制

未提供安全凭据，因此未覆盖登录后 App Shell、角色权限、产品/内容/发布/GEO/设置/审计业务页面；也未执行真实移动设备、Firefox/WebKit、屏幕阅读器或任何业务写入。200% 缩放尝试未改变 CSS viewport、DPR 或 visual viewport scale，按计划记为 `NOT_RUN`；没有用页面样式伪造缩放。

playwright-cli 每次调用显示本地 skill 与工具版本不匹配提示，但命令本身执行成功；这属于工具提示，不是线上页面错误。

## 收口结果

已关闭 `v2-live-readonly-175056` 和 `v2-live-readonly-recheck-20260830-ac3`；`playwright-cli list --all --json` 返回 `browsers: []`、`servers: []`，未发现该任务的 open 会话。`git diff --check` 通过。本轮不执行修复、部署、回滚或 Git 提交。
