# 部署 Runbook 收敛实施计划

## 1. 实施顺序

1. 重写 `docs/Hostdzire部署上线流程.md`：
   - 在顶部建立部署决策表；
   - 把快速重部署提升为主流程；
   - 只保留完整发布入口、验收矩阵和回滚摘要；
   - 控制在约 100–150 行；
   - 删除未提交部署与历史时效性描述。
2. 新增 `docs/Hostdzire部署附录.md`：
   - 承接首次环境、基础设施初始化和环境文件生成；
   - 承接完整手工打包、备份恢复、Nginx 更新和详细排障；
   - 保持原有 SSH、凭据、持久数据和 E2E 安全边界。
3. 收敛 `docs/operations.md`：
   - 保留通用生产运维约束；
   - Hostdzire 章节只保留稳定边界与 Runbook/附录链接；
   - 删除所有 shell 命令块和可执行部署步骤；
   - 删除本地 `.env.staging`、旧 revision 清单和错误软链接回滚描述。
4. 对照 `deploy/scripts/redeploy-staging-fast.sh`、`deploy/scripts/deploy-staging.sh`、`backup.sh`、`restore-verify.sh`、`smoke.sh` 与 `compose.staging.yaml` 做逐项事实复核。
5. 检查所有 SSH 示例只使用 `/Users/sc/.ssh/config` 中的 `hostdzire` 与 `dmit`，并确认写操作只指向 `hostdzire`。
6. 更新 README 的附录入口并检查仓库内相关链接。

## 2. 定向验证

```sh
make test-deploy-scripts
git diff --check
rg -n '未提交验收版本|在仓库根目录创建.*\\.env\\.staging|前端通过软链接切换' \
  docs/Hostdzire部署上线流程.md docs/operations.md
rg -n 'staging-redeploy-fast|backend/alembic/versions|deploy/compose.staging.yaml|partsignal.staging.conf.template|deploy/scripts/deploy-staging.sh' \
  docs/Hostdzire部署上线流程.md deploy/scripts/redeploy-staging-fast.sh
test "$(wc -l < docs/Hostdzire部署上线流程.md | tr -d ' ')" -ge 100
test "$(wc -l < docs/Hostdzire部署上线流程.md | tr -d ' ')" -le 150
! rg -n '^```sh$|^```shell$|^```bash$' docs/operations.md
```

使用仓库脚本检查 Markdown 相对链接；若没有现成检查器，使用标准库脚本只验证本次三份文档和 README 中的本地相对路径，不新增依赖。

## 3. 审查重点

- 快速流程是否仍要求任何已经由脚本自动完成的手工步骤。
- 完整流程是否遗漏备份、迁移、Nginx 更新或登录后浏览器验收。
- 是否错误暗示 `current` 可以独立回滚运行容器。
- 是否在任何示例中输出、复制或本地保存真实凭据。
- 是否把生产环境、Hostdzire 预发布和本地/CI E2E 的边界混在一起。
- 是否仍出现无关 SSH alias，或把任何上传/配置写操作发送到 `dmit`。

## 4. 回滚

本任务只改文档。发现删减导致关键安全边界丢失时，在提交前补回；提交后需要回退时只回退本任务文档提交，不触碰部署脚本或服务器。

## 5. 验证结果

- `make lint`、`make typecheck`、`make test-deploy-scripts`、`git diff --check` 和 Trellis context 校验通过。
- 主 Runbook 为 122 行；快速部署 5 个资格门禁与脚本逐项一致，README 与三份部署文档的本地 Markdown 链接和锚点均有效。
- `operations.md` 已无命令围栏；旧部署表述与 `aaitr` 已从三份部署文档删除，所有 SSH 写操作只指向 `hostdzire`，`dmit` 仅保留只读探测。
- 未连接服务器、未执行部署、备份、迁移或回滚；本任务不需要更新 `.trellis/spec/`，因为部署行为继续由现有脚本与 Runbook 共同约束，未新增开发规范。
