# T6-C 修复、T6-G 当前验收与 AC11 处置（2026-10-24）

## 结果

T6-C 共享内容任务删除恢复已修复，T6-G 现有实现经错误码矩阵核对与定向验证完成本地前端验收。本轮不部署、不提交、不推送，不访问生产服务。原有治理修改保留，原 T5-I6 转入 review，历史 AC11 不勾选；只剩历史证据例外接受事项，而非再次实施前端功能。

## 实际修改与边界

- `content-task-lifecycle.tsx` 继续统一拥有 List/Detail 命令。普通 DELETE 的 `GEO_OBSERVATION_CONTEXT_INCOMPLETE` / `GEO_OBSERVATION_CHAIN_CHANGED` 按任务冻结；关闭提示或后台刷新不能解冻。显式读取 Detail 与刷新相关列表成功后关闭恢复弹窗，用户须重新打开确认；从不重放删除。
- 永久删除弹窗独立为 `content-task-deletion-dialogs.tsx`。POST 失败关闭旧确认；重开重新 GET，失败后旧预览不可提交。读取失败历史以 Query errorUpdateCount 为依据，后台成功不解冻，只有显式读取成功才恢复。确认文本随任务 ID、读取版本与错误次数撤销，同值刷新也须重输；在途请求禁用，发送前复核精确缓存状态，阻止未重绘窗口发送旧确认。
- 保留主体 continuation 和挂载检查；重复同步提交由 lifecycle pending ref 阻断。未修改服务端权限、事务、数据库、API 或生成类型。
- 浏览器暴露并修复两个恢复细节：详情成功/失败/loading 分支固定 dialogs 在同一位置，失败后不会丢失恢复错误或重挂会话；RowActions 普通确认通过已有可选参数传回真实按钮，让恢复弹窗关闭后正确还原焦点。
- 列表 resolveTask 用任务数据依赖的 useCallback 保持稳定，避免新增动作复核导致表格 cells/menu 重建；数据改变仍更新动作资格。

## T6-G / T6-C 验收矩阵

| 合同 | 当前证据 | 结论 |
| --- | --- | --- |
| T6-C preview GET 失败撤销旧预览/确认，后台成功不解冻 | 新删除弹窗组件测试；List/Detail 浏览器重开缓存预览→GET 409→显式重读失败/成功→重输 | 通过 |
| T6-C 普通 DELETE 两个 GEO code blocked/no replay | List/Detail 参数化组件测试、两视口浏览器；失败重读保留 request ID，成功只恢复重新确认入口 | 通过 |
| T6-C permanent-delete POST 两个 GEO code 使旧确认失效 | List 组件测试及 List/Detail 两视口浏览器；新 preview revision=100 与精确文本，第二次 POST 只能人工触发 | 通过 |
| T6-C 缓存更新、任务/主体切换与提交竞态 | 同值/变值刷新、在途禁用、任务切换、同步缓存失败早于重绘、主体切换的组件测试 | 通过 |
| T6-G context blocked、cached Detail 动作冻结 | Detail 参数化 exact 409 组件测试；G03 strict fixture 读取损坏 context、错误/重试及后台资格撤销 | 通过 |
| T6-G chain changed 重读/重开/重新确认、no replay | Detail 两个实际 GEO code 组件测试、chain conflict strict fixture | 通过 |
| T6-G Correction context blocked、stale successor/publications、显式恢复 | 现有 Correction/API 组件测试与 G04 strict fixture 三类实际 code、失败重载、草稿/证据合并、canonical handoff | 通过，复用既有实现 |

测试中原泛化 REVISION_CONFLICT / 409 fixture 已在本轮所需场景改为实际 GEO code；没有按 message 判断，也没有新增错误码注册表。

## 实际验证与失败处置

详细命令、退出码、输出摘要与最终文件 hash 见 `evidence/validation.json`、`evidence/scope-check.json`。

- 7 个相关 Vitest 文件成功结果组成最终证据。初轮 6 文件 65 例中 4 文件通过、2 文件 10 例失败：2 个预览断言早于 Query 异步通知，改 waitFor 后 7/7；列表 8 例失败定位为回调身份变化重挂菜单，修复后 12/12。随后新增 exact cached context 场景，GEO Detail 16/16；详情挂载与焦点修复后 Content List/Detail 22/22；RowActions 参数断言更新后 table-kit 12/12。未改的 GEO Correction/API 成功结果复用。没有把初轮混合失败命令写成整体通过。
- `npm --prefix frontend run typecheck` 通过；最终 Playwright 自建 production artifact 的 `npm run build` 再执行 tsc -b 与 Vite，exit 0。只有既有大 chunk 提示。
- 12 份实际修改的前端源码/测试文件定向 ESLint，exit 0；不声称全仓 lint。
- 首次 Playwright 缺少 headless Chromium v1228，82 例未启动，非业务通过。通过本地 Playwright CLI 安装指定浏览器后恢复。
- 第二次 production artifact 5 spec：74/82 通过、8 例普通恢复失败；38 个 GEO 用例全通过。失败揭示上面的详情重挂和焦点问题。修复后重建 artifact，仅重跑 3 个内容 spec：44/44 通过，375 与 1440 两项目，既有 spec 另覆盖 768/1024；secret scan clean。合计 82 个不同浏览器用例有有效成功证据，38 个 GEO 结果来自修复前同轮构建，其输入未变，RowActions 修改仅走普通确认，GEO 采用 custom 路径。
- 高风险独立只读复核与两次新证据后的定点复核无剩余 material finding，详见 `review.md`。复核不替代执行证据。
- `task.py validate` 两条 JSONL 通过；最终范围指纹、Git diff 和暂存检查另见 scope-check。

## AC11 的明确收尾方式

原始记录位于 `../09-16-geo-observation-context-code-reconciliation/research/implementation-validation.md`。2026-09-21 的 protected-owner preflight fingerprint 未采集，结果永久记为 **NOT_CAPTURED**。本轮基线不可能证明当时 dirty worktree 的修改归属，也不追认当时完整后端 suite 通过。

本轮先保存 `evidence/baseline.json`（HEAD、起始状态、13,119 个文件 hash），然后按实际允许范围比较；它只证明本轮改动边界。当前前端验收、历史后端目标验证和独立 review 分别记录，不将三者拼成历史 AC11 通过。

T5-I6 转入 **review**，完成条件为负责人明确接受并记录历史证据例外，以本轮当前验收替代不可补造的历史归属证明；随后可以按治理权限关闭 T5-I6 及逐项核对父任务。用户本次只要求明确收尾方式，不能推定已接受历史例外，因此 AC11 保留未勾选、原任务未标 completed。若坚持取得历史无越界原始证明，只能找到当时可靠外部快照/备份；重跑当前测试不能补齐，不继续无效重跑。

T6-G/T6-C 本地前端合同条件已有证据，但 release-atomic 仍要求对应前后端作为同一候选交付。该结论不授予部署许可，不替代正式候选/真实栈和现场验证。

## 未执行与剩余工作

- 没有重跑全量 make verify、backend suite、PostgreSQL/Redis/Celery、Linux 镜像或生产 smoke；本轮没有变更相关输入/合同，不因任务收尾扩大测试。上述真实栈/发布范围不能由 strict fixture 替代，正式发布按输入差异及发布合同选证据。
- T6-G/T6-C 当前修复范围无剩余实际编码或定向验收项。T5-I6 剩余为历史证据例外接受；OSS 完整浏览器链路、1010 部署/业务 smoke/UAT、Browser 延期均保持原任务边界。
- 清理本轮测试结果、trace、临时日志及 preview 进程；恢复本轮开始前的 frontend/dist。Playwright Chromium/FFmpeg 属可复用依赖缓存，保留。正式交付证据仅保存在本 task 目录。

## 2026-10-24 后续用户接受（最新）

用户在本轮交付后明确接受 AC11 历史证据缺口，保留 NOT_CAPTURED，以本轮当前验收作为收尾依据。T5-I6 已 completed，之前“等待接受”现已解决。进一步父任务核对发现此前剩余清单漏列 T5-G/T6-P，两个父项继续 planning；本任务 T6-C/T6-G 验收结论不受影响。详见 [T5-I6 收尾及父任务核对](../09-16-geo-observation-context-code-reconciliation/closeout.md)。
