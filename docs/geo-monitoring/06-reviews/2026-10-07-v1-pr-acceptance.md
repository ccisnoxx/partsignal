# 整 PR 代码接受与候选边界

接受时间 UTC：2026-10-07T09:41:01.437699+00:00。远端验证固定源码 `8d2e528cce0f804b224bf9b78e02bb2651f6ac62`；最后的实现增量为 `b254b58a60ce7696533abd18b0a2bdb30b851d7e`，其后只保存独立复审与任务记录，受审源码 hash 保持一致。按用户条件授权“新 SHA 远端验证通过后，继续整 PR 接受与 main 收口”，组合审查与验证条件已满足：**整 PR 代码准入 APPROVE**，可转 Ready 并合并。此接受不代表 clean main 完整门禁、RC 或生产验收已通过。

## 独立审查与输入复用

复用旧整分支审查、aa7f3db8 六项阻断独立复审、d43695e5 CI 入口复审及0b232f2c整PR复核；随后14dd7594治理、28e92111 GNU/分组、00b4eca2 staging环境归属、bd6abde1 Production环境绑定、0b6e5aa0三份E2E时序及b254b58a GEO API历史详情断言均有固定源码fresh只读APPROVE。8fd84347首轮CHANGES_REQUESTED保留，图片空集合/旧URL两项P2在0b6复核RESOLVED；b254仅对最新一行断言APPROVE，不能单独作为整PR审查。各报告及closed/verify审计见任务evidence，主代理整理不另称独立复审。

原0b232f2c报告要求原run成功的条件未成立，原记录保留。28e92111独立复核允许用输入不变的成功前序、新固定delivery成功和增量复审组合关闭代码准入。evidence/sixth-delivery-source-reuse.json确认backend、frontend/src、合同、Browser Collector、Makefile、依赖/锁文件及相关配置未变；实际部署/恢复/迁移运行路径未变。三份E2E时序修复匹配0b6，最后一行GEO API修复匹配b254，b254→8d仅治理。因此旧成功单元/PG/本地完整验证继续复用，不重跑分支全套。

## CI 与验证事实

| Run / 固定 SHA | 最终结果 | 事实及边界 |
|---|---|---|
| [37572374117 / 0b232f2c](https://github.com/ccisnoxx/partsignal/actions/runs/37572374117) | FAILURE | 合同/lint/type、3865后端单元、1308前端单元、591/717两路shard、1253PG+6真实PG16恢复通过；GNU缓存头自检失败，后序未执行。 |
| [37581493190 / c6b310f5](https://github.com/ccisnoxx/partsignal/actions/runs/37581493190) | FAILURE | GNU修复通过；staging自检缺私有env失败，后序跳过。 |
| [37584298170 / d0f61aaa](https://github.com/ccisnoxx/partsignal/actions/runs/37584298170) | FAILURE | staging和Production cleanup通过；Production自检依赖JSON env_file形态失败，后序跳过。 |
| [37587914372 / 135d801e](https://github.com/ccisnoxx/partsignal/actions/runs/37587914372) | FAILURE | build/all deploy-scripts通过；canonical真实栈29pass/3fail，后序未执行。 |
| [37594203220 / 0475a776](https://github.com/ccisnoxx/partsignal/actions/runs/37594203220) | FAILURE | build/all deploy-scripts及32canonical真实栈通过；GEO enabled历史尝试错误码locator双匹配失败，后续两个关闭模式/fixture/末端Compose跳过。 |
| [37598569164 / 8d2e528c](https://github.com/ccisnoxx/partsignal/actions/runs/37598569164) | SUCCESS | bootstrap/迁移、build/deploy-scripts、完整根E2E和两项Compose通过；实际各阶段计数、时间、退出码及日志hash见sixth-delivery-ci-*。六项前序及frontend shard按delivery跳过，不称单次完整CI。 |

五次失败保持原事实，预备接受写入器未执行的invalidated记录保留，不改写成成功。第六次为用户明确批准的一次delivery，不能自动扩展第七次。旧clean aa一次约38分钟完整本地门禁exit0及输入不变的旧成功前序继续支持适用范围；它们不能代替合并后同一clean main commit的完整门禁。GEO API局部修复的真实enabled一次57.8秒、真实Chromium四例locator反例和单文件ESLint均通过，hash绑定0475+dirty执行，不伪称clean新SHA重跑。

## 接受范围

| 任务 | 已接受范围 | 未接受 / 覆盖限制 |
|---|---|---|
| GEO-1002 | ADR-007、首发范围及统一能力矩阵文档治理；不把政策值作为现场事实 | 生产事实未接受 |
| GEO-1003 | production Settings/预检/部署/profile硬禁止与本地正负例 | 目标三进程实际配置、全部Profile/会话/材料清点由1010核实 |
| GEO-1004 | Catalog当前User/Session锁序、权限重验、拒绝原子性及真实PG | manifest原planned为治理漂移，实际Trellis入场review；不补造原transition |
| GEO-1005 | CRON全部写/新窗口拒绝，历史原值只读，MANUAL正常 | 既存ACTIVE不原地停用/删除，现场披露属1010 |
| GEO-1006 | ADMIN/CSRF实际API、幂等冻结回执/审计原子性/PG；无自动调度 | 未知提交结果故障注入未覆盖；无生产真实评估验收 |
| GEO-1007 | 原delivery页面/API能力真实性；两页说明、Reports三类CSV/空态/501、Action/Retest公共API组合和明确无公共重分析入口 | geo-loop evaluator前置隔离seed；实际管理员入口由1006单独HTTP/PG证据支持；不把组合证据表述为正式生产全程；内部分析能力及历史摘要不授予公开重新分析操作，FAILED/指标资格与不可变历史不更改 |

严格失败恢复保留用户GEO-1007 / deliveryGEO-1008映射，baea420fb8a479d66d578d3f4fd91d38086b8c29原接受和任务状态原样保留；原delivery1007页面任务不重编号。1004原manifest planned属于治理漂移，真实Trellis入场review；本次记录实际接受，不补造历史转换。R0—R8、1008、1010原记录保持。

## main、RC 与现场

GEO-1009尚未完成。合并后确认工作区干净且HEAD=origin/main，对该固定main commit执行一次run-verify.py完整门禁。archive、四角色真实镜像/非空RepoDigest、manifest及v1.0.0-rc1 tag必须绑定同一main commit；不能先提交新治理SHA再沿用旧门禁。真实发布repository和可执行、已验证previous V2仍为必要输入，缺少时停止冻结，不补造身份或历史。

1010目标配置、Browser零服务/会话/材料、CRON现场披露、真实AI/OSS、正式MANUAL闭环、备份恢复、容量/监控和具名签署仍NOT_VERIFIED，生产NOT_STARTED/NO-GO。此接受不授权生产写入或开放流量，不把隔离seed、合成Gate或模板当现场证据。
