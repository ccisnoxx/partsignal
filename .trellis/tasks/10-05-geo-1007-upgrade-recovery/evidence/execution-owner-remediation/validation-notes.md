# 执行所有权修复验证边界

这些预提交日志明确记录 HEAD=137a9fc6 与 dirty=true，不能当作 137a9fc6 源码通过。本轮行为源码摘要见 tested-source-hashes.json；新提交固定 SHA 后的验证和独立复审另存，不沿用旧结论。

- targeted-recovery / targeted-recovery-final：50 项恢复、失败事实、运行时闭包/缓存/registry 定向用例及实际 recovery 信号反例通过；新增部署 SIGTERM source 用例单独运行 deployment-signal-source，4项通过。
- backend/tests/unit/test_integrity.py 与 test_cli.py：backend debugger 报告修改前 6 fail/2 pass，修改后20 pass，Ruff/format pass；不补造缺失的执行时间。PG16 的真实缺表边界由主代理另行验证。
- compose-recovery：真实 PG16 保留正确0066 head，published_articles 改名保留行/OID，实际 recover 后 deploy 拒绝 PREPARED、退出1并生成 owner 失败事实；还原后正常 deploy→activate，69表行摘要一致。本次资源清零。
- 迁移运行时闭包方案保持；同 Alembic 下 app/依赖/Python/base/mtime/cache 等真实镜像反例通过。
- 生产 harness 中间失败未删除：第一次/V1错误提示顺序（1901）由 parent 提前认证 candidate 导致，改由私有 worker 完成认证；第二次missing image原validation exit2变为1（1946），恢复入场验证错误语义；第三次 upgrade 时序断言把新增 post-integrity 当成 pre-integrity，改为分别检验迁移前默认/迁移后严格检查。最终结果由 production-regression-final 日志裁决。
- macOS 仅有 zombie 的进程组 killpg(SIGKILL) 返回 EPERM，初次信号测试因此失败；修复为继续读取 OS 执行状态，未知仍持锁。嵌套 run-locked 子孙组另有真实恢复阻塞反例。

AI/OSS MET 为合成夹具。未验证真实服务器/maintenance503/备份/registry/AI/OSS/丰富不可变业务行/远端CI/clean main候选；未声称实际Engine操作进行中的取消能回滚服务端操作。只运行直接受影响部署与cleanup harness，没有重复无关 frontend/GEO/E2E 全集合。
