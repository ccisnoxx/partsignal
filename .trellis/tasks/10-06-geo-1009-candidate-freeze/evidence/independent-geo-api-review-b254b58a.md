# 固定 GEO API 历史尝试错误断言独立复核

审查来源：fresh `critical_reviewer` / `/root/geo_selected_error_fixed_review`，只读返回结论，由主代理保存。固定目标 `b254b58a60ce7696533abd18b0a2bdb30b851d7e`，基线 `0475a776056b7689721a42af90766fb94c13c6ed`。以下为审查者完整返回；不是主代理自审或整 PR 接受记录。

本次未确认可行动的 P0/P1/P2/P3 Finding。历史尝试错误详情 locator 问题判定 **RESOLVED**；最终结论为 **APPROVE，仅适用于 `0475a776..b254b58a` 这一增量**。第五次 CI 仍是 **FAILURE**，本次批准不解除整 PR 的远端准入条件。

已确认存在实际候选 diff，且该断言直接影响发布门禁能否真实观察历史详情，符合高风险独立审查范围。我重新读取了固定提交的完整 spec、`run-detail.tsx`、必要的详情选择与 query 路径、测试 helper，以及第五次任务记录和原始证据；没有沿用旧 `0b6` 三 spec 审查作为本次结论。

[geo-api-real-stack.spec.ts:104](/Users/sc/PycharmProjects/partsignal/frontend/tests/e2e/geo-api-real-stack.spec.ts:104) 的新断言限定在“运行详情”region 内的 `alert`，精确匹配完整 `错误阶段：COLLECTION · ${code}`。该段落由当前 `detail.run` 渲染，见 [run-detail.tsx:154](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-runs/run-detail.tsx:154)；历史尝试链的错误码位于另一个 span，见同文件第 277 行。点击“尝试 1”通过 URL 中的 `run_id` 选择详情，query key 也包含该 ID。因而重试成功详情尚未切换、只有历史 span 存在时，新断言无法通过；详情切换后，历史 span 不再造成双匹配。`RATE_LIMIT` 与 `UNKNOWN` 共用该断言，完整阶段和错误码均被保留。

独立字节比较确认：spec 行数未变，只有第 104 行改变，其余字节完全一致。没有新增 `.first()`、skip、错误过滤或测试集合缩减；原 provider 调用次数、显式 retry POST、旧 attempt 字段不可变、新 attempt 输入快照、已知/未知费用统计、历史尝试无重试入口、fake credential 不进入 DOM/storage 及 `pageerror` 断言均保留。未发现本增量引入新的误通过路径。

| 核对证据 | 实际结果 | 证据边界 |
| --- | --- | --- |
| 第五次远端原始日志与最终回执 | 固定 `0475a776`；build/all deploy-scripts 通过；32 canonical 真实栈全部通过；随后 GEO enabled 在原第 104 行 strict 双匹配失败 | 整个 run 是 FAILURE |
| 定向 enabled 原始日志与 Python 驱动 | 外层 57.8 秒、exit 0；1 passed（42.5 秒）、1 按模式 skipped；两种错误及各自 retry 均实际执行 | 执行身份为 `0475a776 + dirty` |
| Chromium 边界驱动与原始日志 | 从真实旧/新 spec 提取 locator；两种 code × 两种 DOM 状态共四例：历史 span 单独存在时旧误通过、新拒绝；alert 与 span 同现时旧 strict、新唯一通过 | 只证明 locator 边界，不能替代应用 E2E |
| 单文件 ESLint 记录 | exit 0，空日志哈希一致 | 本审查未重跑 ESLint 或测试 |

已独立重算并匹配 source-proof 中的 **3 个源码哈希、2 个驱动哈希，以及 3 个定向日志、完整 CI 日志和 watch 日志哈希**。固定 `b254b58a` 的 spec 哈希为 `9a5c702cc6a4988633abbb33f8eb6dd4ce7cecf7d75164f78a2e8924d541b6ba`，与 dirty 执行记录一致；详情组件和 helper 同时与基线一致。这支持源码等价复用，不构成“clean 新 SHA 已执行测试”的证明。

原始定向日志包含真实 PostgreSQL 迁移、production build/preview、API/Celery 请求、两次 retry 的 201 回执和 secret scan clean。既有入口保留独占 Redis preflight、进程停止并等待后的精确键清理；日志确认 DB12 一枚键删除、五个固定端口释放、随机数据库和临时存储删除。只读 Docker inspect 确认驱动使用的相同容器 ID 分别为 PG16/Redis，当前均已停止；日志末尾也记录了两者的恢复停止。

剩余范围明确如下：

- 没有 `b254b58a` 的远端成功证据；第六次 CI 未获授权。
- 第五次 run 的 `api-disabled`、`monitoring-disabled`、fixture E2E 和末端两项 Compose 因前序失败未执行，不能记为本次通过。delivery 跳过的单元、PG 等前序也不能记为新远端通过。
- 本次批准不包含整 PR 接受、Ready、main 合并、clean main 完整门禁、RC 冻结或现场/生产验收；这些准入仍未闭合。
- 候选 diff 没有修改恢复后的 1008 接受记录。本审查未修改任何文件、任务状态、Git 历史/索引或 Docker 资源，也未重跑测试。

主代理审计补充：bundle `20261007T085023Z-delivery-geo-selected-error-fixed-review-518b459f` 已 closed / audit-verify passed，1 次独立只读交付验收，无异常。复核前后 12842 个 tracked/非忽略 untracked 文件、HEAD 和工作区状态字节一致；具体观察见 `fifth-review-observed-writes.json`。此计数是复核交付验收，不是 GEO-1009 或整 PR 接受。
