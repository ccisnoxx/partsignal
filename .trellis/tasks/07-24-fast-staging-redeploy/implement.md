# 开发期快速重部署流程实施计划

## 1. 实施顺序

1. 修改 `deploy/scripts/deploy-staging.sh`：
   - 增加取值仅为 `full|fast` 的 `PARTSIGNAL_DEPLOY_MODE`，默认 `full`；
   - 两种模式均执行 Compose 校验、镜像构建、基础服务启动、只读 `preflight-integrity`、应用服务健康等待和本机 HTTP 探针；
   - 仅 `full` 执行迁移和 `seed-demo`；
   - 复用 API 后端镜像，不重复显式构建同镜像的 `fake-oss` 服务。
2. 新增 `deploy/scripts/redeploy-staging-fast.sh`：
   - 校验本地分支、工作树、远端提交一致性和 SSH 配置；
   - 创建唯一 release archive 并检查敏感文件；
   - 上传、解压、链接共享环境文件；
   - 在远端构建前比较关键路径并阻断不合格 release；
   - 调用快速模式，执行 Nginx/容器/公网冒烟，最后切换 `current`；
   - 输出 release ID 和总耗时，不自动清理旧 release。
3. 在 `Makefile` 增加唯一的快速入口 `staging-redeploy-fast`。
4. 更新 `docs/Hostdzire部署上线流程.md`：
   - 区分频繁代码重部署与完整发布；
   - 明确首次启用、关键文件变化、迁移和高风险 UI 变更必须走完整流程；
   - 记录快速路径验证边界与 `current` 的真实语义。
5. 更新 `docs/operations.md` 的 Hostdzire 预发布摘要，避免维护第二套冲突事实。

## 2. 定向验证

```sh
sh -n deploy/scripts/deploy-staging.sh
sh -n deploy/scripts/redeploy-staging-fast.sh
deploy/scripts/redeploy-staging-fast.sh --help
make test-deploy-scripts
make -n staging-redeploy-fast
PARTSIGNAL_VERSION=test docker compose \
  --env-file .env.example -f deploy/compose.staging.yaml \
  config --no-env-resolution --quiet
git diff --check
```

使用 `deploy/scripts/test-deploy-staging.sh` 在临时目录注入 `docker` 与 `curl` 记录器，分别运行 `deploy-staging.sh` 的 `full` 和 `fast` 模式，断言：

- `fast` 包含 `preflight-integrity`、`up -d --wait` 和 HTTP 探针；
- `fast` 不包含 `run --rm migrate` 与 `seed-demo`；
- `full` 仍包含迁移与 `seed-demo`；
- 非法模式在调用 Docker 前失败。

对本地编排脚本执行只读/模拟验证，覆盖：

- 非 `main`、脏工作树或未同步远端时提前失败；
- `--help` 不产生远端写入；
- 关键路径比较失败时远端命令在构建前退出；
- 公网探针位于 `current` 切换之前。

## 3. 质量与文档检查

- 运行 `trellis-check` 检查需求、设计、实现和文档一致性。
- 本次不改前后端运行时代码、API 或数据库契约，因此不重复运行耗时的前后端完整单测；以 Shell 分支验证、Compose 配置和差异审计替代。
- 检查新增脚本没有输出环境文件、密码、私钥或完整 SSH 配置。

## 4. 回滚点

- 修改提交尚未用于部署：直接回退本次脚本、Makefile 和文档提交。
- 快速部署在资格门禁前失败：服务器运行栈未变化。
- 镜像构建或容器启动后失败：`current` 保持旧 release；按 Runbook 选择数据库契约兼容的旧 release 重启应用，不自动 downgrade。
- 首次上线本功能使用原完整流程；验证完成后后续普通代码提交才使用快速入口。

## 5. 验证结果

- `make test-deploy-scripts`：通过，覆盖默认 `full`、显式 `fast`、非法模式、调用顺序与快速资格门禁/公网探针/指针切换顺序。
- `sh -n`、`dash -n` 与 Dash 直接执行自检：通过。
- `docker compose config --no-env-resolution --quiet`：通过，未读取真实预发布凭据。
- `make lint`、`make typecheck`：通过。
- `git diff --check HEAD` 与 Trellis context 校验：通过。
- `.trellis/spec/` 保持不变：本次新增的是 Hostdzire 运维命令与发布边界，权威事实已写入 `docs/Hostdzire部署上线流程.md` 和 `docs/operations.md`；再复制到前端或后端代码规范会形成第二来源。
- 未执行真实 Hostdzire 部署，因此 AC7 的 5–8 分钟目标留待首次完整上线后的下一次普通代码快速重部署验证。
