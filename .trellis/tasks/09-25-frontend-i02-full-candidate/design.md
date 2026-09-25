# I02 验收边界

- `make verify` 是本项唯一顶层执行入口；各子命令的输出、退出码和清理状态是实际证据。
- fixture Playwright 证明页面矩阵与 production build；real-stack 证明跨 API、数据库、Worker、对象存储和浏览器的连续业务结果，二者分开记录。
- 合同生成一致性、Python/TypeScript 静态检查、单元/PostgreSQL integration、容器镜像与部署脚本各自保留 owner，不用单一浏览器结果替代。
- 只处理当前候选造成或暴露的可重现失败；环境和既有非阻断警告准确记录。

## 收敛决定

- 顶层门禁只导出本次所需的 `DATABASE_URL` 与独占 `REDIS_URL`，避免开发 `.env` 的 `AI_ALLOW_LOCAL_HTTP=true` 改变 production Settings 单元测试语义。
- 秘密产物检查由公共 `npm run e2e` 的 post-run wrapper 持有；等待 Playwright 完全退出后全局扫描固定 output root，并组合浏览器与扫描退出码。测试内 helper 保持严格，允许不存在的仅是单测试尚未创建的叶子目录。
- fixture 与 real-stack 的运行期凭据在首次使用前经 NUL 分隔 stdin 登记到 0600 AES-GCM manifest；最终扫描仍严格处理目录错误、损坏 marker 与缺失密钥。
- real-stack 进程、数据库与 Redis 生命周期由共享脚本持有，收到失败或信号仍等待子进程并执行清理。
- 依赖修复只更新 lockfile 中满足现有 semver 的传递版本，不扩大 `package.json` 依赖范围。

## I02-3 最终收敛

- 在 I02-1/I02-2 输入未变化时复用其定向证据，只执行一次当前完整 `make verify`；门禁前后以非 Trellis 代码内容哈希确认候选实现未变化。
- 顶层门禁实际经过两个 lifecycle harness、secret artifact、frontend container、部署脚本与 Compose 配置，不把历史 V2 Gate 或旧日志计入本轮结论。
- fresh `critical_reviewer` 复核全部 tracked/untracked 候选与门禁日志，结论为 `NO BLOCKER`。
- 远端手动 CI 尚未覆盖四类新增本地 harness，以及 21 个非任务未跟踪源码/脚本/测试文件必须在后续集成中原子纳入，均记录为非阻断 I03 风险；本轮不创建或实施 I03。
