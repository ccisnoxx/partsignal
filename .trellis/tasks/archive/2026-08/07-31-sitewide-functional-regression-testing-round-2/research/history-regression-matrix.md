# 第二轮历史缺陷回归矩阵

## 1. 判定口径

- 本矩阵只使用冻结提交 `84f9dc222ff01a68ff38e6407d96acb65e926eeb`、run-id `E2E-FULL-20260731-R2-01` 的本轮证据；归档任务仅用于恢复原复现步骤和期望。
- 同一轮已经执行且直接覆盖原步骤的门禁、隔离 E2E、真实浏览器和专项探针不重复运行。2026-08-01 仅为 `PS-QA-110` 补跑第二次完整前端门禁。
- “原缺陷 PASS”只说明原问题未回归，不覆盖本轮发现的其他缺陷。内容任务取消焦点 `PS-QA-003` 与 Dropdown 打开静态确认框的 `PS-QA-201` 是不同交互链。

## 2. `PS-QA-001`～`PS-QA-004`

| ID | 原问题与最短原步骤 | 本轮独立证据 | 结果 |
| --- | --- | --- | --- |
| `PS-QA-001` | GEO 打印切换 print media 后读取已失效节点，误报 `.app-content` 宽度为 0 | 本轮 `make e2e` 52/52；`compatibility.spec.ts` 在媒体切换后从当前 document 重新查询 `.app-content`，Chromium、Firefox、WebKit 均验证宽度大于 0 且文档不溢出；第 8 节打印路由双视口通过 | PASS |
| `PS-QA-002` | `/tasks` 在 375px 与真实 200% tab zoom 下产品复合文本越过单元格 | 本轮 `cross-page-visual-convergence.spec.ts` 随 52/52 E2E 通过；五类业务表真实 200% 缩放、24 表双视口和 58 个长文本槽均无页面溢出或单元格越界 | PASS |
| `PS-QA-003` | 内容任务列表与详情的取消确认缺少可见次操作，关闭后需恢复触发器焦点且不得发请求 | 两次完整前端门禁均覆盖 `ContentTasksPage.test.tsx`：列表“暂不取消”和详情次按钮、关闭图标、Escape 均不提交并恢复焦点；第 6 节同轮真实浏览器操作列检查确认原取消任务链可用 | PASS |
| `PS-QA-004` | 隔离库未配置全局自然化 Prompt 时创建自然化作业曾返回 500 | 本轮隔离 `make e2e` 的 fresh database 未预置全局自然化 Prompt；`mvp-flow.spec.ts` 先确认 204，再断言创建自然化作业返回 409 `HUMANIZATION_PROMPT_MISSING`；52/52 通过并精确清理 | PASS |

结论：4/4 个已修复项按原步骤未回归。`PS-QA-201` 仍失败不改变 `PS-QA-003` 的结论，因为它只发生在 Dropdown → 静态 `modal.confirm` 接力链。

## 3. `PS-QA-101`～`PS-QA-110`

| ID | 原门禁问题 | 本轮独立证据 | 结果 |
| --- | --- | --- | --- |
| `PS-QA-101` | 生成可靠性测试仍使用旧 Prompt 夹具 | `make test-integration` 68/68；当前夹具通过 `platform_prompts` 与 `platform_profiles.platform_prompt_id` 建立绑定 | PASS |
| `PS-QA-102` | 迁移目标/head 断言漂移 | `make test-integration` 68/68；冻结时 current=head=`0033_task_owned_history_delete` | PASS |
| `PS-QA-103` | 24 表 E2E 未等待特殊 Modal 关闭，后续被遮挡 | `make e2e` 52/52；24 表用例在 GEO 观测和模型发现弹窗关闭后等待隐藏，并完成 1440/375 两个视口；第 6 节另完成 24/24 真实浏览器核验 | PASS |
| `PS-QA-104` | Trusted Types 把生产 CSP 注入 Vite preamble，应用无法挂载 | `make e2e` 52/52；生产预览壳层中的 `trusted-types.spec.ts` 在 Chromium、Firefox、WebKit 完成命名策略、Ant 交互、Markdown 清洗和 CSP 断言 | PASS |
| `PS-QA-105` | Prompt DELETE 仍调用已移除的旧平台路径 | `mvp-flow.spec.ts` 使用 `/api/v1/platform-prompts/{id}?expected_revision=...`，本轮 52/52 E2E 通过 | PASS |
| `PS-QA-106` | 工程师直达管理员路由的预期仍是重定向而非可访问 403 | 两次完整前端门禁覆盖 `AdminRoute.test.tsx` 的保留 URL、403 提示、焦点和返回入口；本轮 E2E 同时验证工程师管理员 API 为 403 | PASS |
| `PS-QA-107` | 可复用 Prompt 页面视觉基线过期 | 本轮跨页视觉 E2E 的 11 张批准基线全部在 `0.02` 阈值内，Prompt 页面无基线失败 | PASS |
| `PS-QA-108` | 正式 E2E 使用共享开发数据且清理不精确 | 本轮完整 E2E 使用独立数据库 `partsignal_e2e_20260731_39166` 与临时存储；数据库删除后计数为 0、存储路径不存在，开发服务恢复 | PASS |
| `PS-QA-109` | Prompt E2E 使用旧 `platform_profile_id` 和“当前平台”断言 | `mvp-flow.spec.ts` 使用 `platform_prompt_id`，验证 Prompt 身份、“Prompt 使用平台”绑定和预览链；本轮 52/52 E2E 通过 | PASS |
| `PS-QA-110` | 完整 Vitest 曾被误判为挂起，验收要求连续两次零失败且每次不超过 300 秒 | 第 1 次由 `make test-unit` 完整执行：Vitest 175/175、视觉合同 23/23，整个命令 236.93 秒；第 2 次 `npm --prefix frontend run test`：Vitest 175/175、视觉合同 23/23，`real 241.37s`；均零失败且低于 300 秒 | PASS |

结论：10/10 个历史门禁问题均取得本轮通过证据；没有引用旧任务结果替代本轮执行。

## 4. 其他历史专项

| 历史专项 | 本轮证据 | 结果 |
| --- | --- | --- |
| 24 表、58 个长文本槽、桌面/移动、真实 200% 缩放 | 第 6 节 24/24 表与 58/58 槽完成；几何、局部滚动、固定列、Tooltip/键盘和五类表真实缩放通过 | PASS |
| 内容任务删除术语 | 当前列表与详情均显示“删除任务/确认删除”，两次前端门禁断言不出现“物理删除” | PASS |
| 待发布候选与发布记录操作 | 当前候选按服务端动作提供“取消待发布”，发布记录只在可删除时显示“删除记录”；同轮单测、W3 和 E2E 通过。静态确认取消后的焦点缺陷另计 `PS-QA-201` | PASS |
| 开发环境 Vite `/api` 代理 | 第 2 节重启前后 health=200、匿名会话=204、登录/会话=200，重启后 `ECONNREFUSED` 为 0；隔离 E2E 不受影响 | PASS |
| `PS-QA-201` | 候选、产品、AI Header 三条 Dropdown → 静态确认取消链均把焦点落到 `BODY` | FAIL（仍存在） |
| `PS-QA-202` | 产品、事实版本、GEO 人工观测链、平台、发布账号仍显示“物理删除” | FAIL（仍存在） |
| `PS-QA-203` | AI Header 删除确认仍未说明渠道和模型测试状态会失效 | FAIL（仍存在） |
| 第一轮删除并发缺口 | 13/13 接口完成同目标并发；AI 渠道和 Header 双 204、双成功审计 | FAIL（覆盖已完成，见 `PS-QA2-DELETE-001`） |
| 确认期间状态变化、迟到响应/缓存 | 第 7 节逐 DELETE 状态/引用变化和最终缓存完成；W6 覆盖迟到结果、刷新、重登及最终状态 | PASS（覆盖完成） |
| 全部操作列键盘链 | 13 组普通 Dropdown 键盘开闭通过；Dropdown → 静态确认和详情抽屉/侧栏焦点恢复失败 | FAIL（覆盖已完成，见 `PS-QA-201`、`PS-QA2-UI-002`） |

## 5. 本节结论

- 历史已修复项：`PS-QA-001`～`004`、`PS-QA-101`～`110` 共 14/14 `PASS`，未发现回归。
- 历史待确认项：`PS-QA-201`～`203` 共 3/3 `FAIL`，确认仍存在。
- 第一轮缺口均已实际覆盖；结果包含 1 个删除并发缺陷和 2 个焦点恢复共因，不能将“覆盖完成”写成“功能通过”。
- 本节未修改产品代码、现有测试、合同、部署配置或权威产品文档。
