# Research: 预发布部署权威入口

- Query: 当前项目部署到 `https://geo.962850.xyz` 的权威文档、脚本、SSH alias 与精确命令是什么；当前视觉缺陷修复应走快速还是完整发布。
- Scope: internal
- Date: 2026-07-25

## Findings

### 权威来源与所有权

- `docs/Hostdzire部署上线流程.md`：预发布主 Runbook，明确日常决策、停止条件、快速入口、完整发布入口、验收和回滚边界。
- `docs/Hostdzire部署附录.md`：首次初始化、完整手工发布、公网/浏览器验收、`current` 更新和只读排障的唯一低频事实源。
- `docs/operations.md`：跨环境稳定原则；明确可执行行为以当前 `deploy/` 为事实源。
- `Makefile`：`staging-redeploy-fast` 仅转发到现有快速脚本。
- `deploy/scripts/redeploy-staging-fast.sh`：日常快速发布的单入口实现。
- `deploy/scripts/deploy-staging.sh`：远端完整/快速两种模式共享的 Compose 部署事实源；缺省是 `full`。

代码/文档模式：

- 主 Runbook 自称该域名的主入口，并把普通前后端代码路由到快速发布，把认证、权限、路由、全局壳层等高风险 UI 变化路由到“完整发布 + 登录后浏览器验收”：`docs/Hostdzire部署上线流程.md:3`、`docs/Hostdzire部署上线流程.md:7-14`。
- 当前任务明确修改共享移动顶栏和默认 Drawer 关闭按钮的全局壳层样式：`.trellis/tasks/07-25-staging-visual-defect-fixes/design.md:28-36`。因此本任务命中 Runbook 的“全局壳层”条件，应走完整发布，而不是默认快速发布。
- 日常快速入口的精确本地命令是：

  ```sh
  git pull --ff-only origin main
  make staging-redeploy-fast
  ```

  见 `docs/Hostdzire部署上线流程.md:59-68`；Make 目标只调用 `deploy/scripts/redeploy-staging-fast.sh`，见 `Makefile:65-66`。

- 快速脚本固定使用 `/Users/sc/.ssh/config`、`hostdzire` 和 `https://geo.962850.xyz`，见 `deploy/scripts/redeploy-staging-fast.sh:53-57`；它要求干净且与 `origin/main` 一致的 `main`，见 `deploy/scripts/redeploy-staging-fast.sh:58-77`。
- 快速脚本只比较 5 个门禁路径，见 `deploy/scripts/redeploy-staging-fast.sh:167-180`；当前 CSS 变化不会被这 5 个路径自动拒绝，但这不覆盖 Runbook 对“全局壳层”的人工发布决策。

### 当前任务的完整发布入口

完整发布不是另一个本地一键脚本。必须按 `docs/Hostdzire部署附录.md` 第 4 节从头执行：

1. 本地主工作目录校验 `main`、干净状态和 `origin/main`，从目标提交生成不可覆盖 release 包：`docs/Hostdzire部署附录.md:151-191`。
2. 只上传到 `hostdzire`，新建 release 并链接既有共享环境文件：`docs/Hostdzire部署附录.md:193-234`。
3. 已有数据先备份；有损迁移才做隔离恢复验证：`docs/Hostdzire部署附录.md:236-263`。
4. 在 Hostdzire 的 `"$RELEASE_DIR/deploy"` 执行精确部署命令：

   ```sh
   PARTSIGNAL_VERSION="$RELEASE_ID" ./scripts/deploy-staging.sh
   ```

   见 `docs/Hostdzire部署附录.md:265-273`。脚本缺省 `PARTSIGNAL_DEPLOY_MODE=full`，完整模式执行迁移和幂等种子：`deploy/scripts/deploy-staging.sh:4-16`、`deploy/scripts/deploy-staging.sh:23-43`。

5. Nginx 模板未变化时不更新站点；只有首次安装或模板变化时才执行附录 4.5：`docs/Hostdzire部署附录.md:286-301`。
6. 从本机做公网探针：

   ```sh
   dig +short @8.8.8.8 geo.962850.xyz A
   deploy/scripts/smoke.sh https://geo.962850.xyz
   curl --fail --silent --show-error https://geo.962850.xyz/ |
     grep -o '<title>[^<]*'
   ```

   见 `docs/Hostdzire部署附录.md:303-315`。

7. 完成登录后真实公网浏览器只读验收和 Hostdzire 最后只读复核，再按附录原子更新 `current`：`docs/Hostdzire部署附录.md:334-376`。

### SSH alias

- 唯一部署、上传、配置、Compose、Nginx 和 `current` 写入目标：`hostdzire`。
- `dmit` 只允许在 Hostdzire 本机正常但公网入口异常时做只读诊断，不得上传、修改或重启。
- 依据：`docs/Hostdzire部署上线流程.md:38-40`、`docs/Hostdzire部署附录.md:35-47`、`docs/Hostdzire部署附录.md:453-462`。
- 首次只读身份确认的精确命令：

  ```sh
  ssh -F /Users/sc/.ssh/config hostdzire 'hostname; id; pwd'
  ```

  见 `docs/Hostdzire部署附录.md:39-45`。

### 主 Agent 必须完整阅读

在执行任何部署前：

1. `docs/Hostdzire部署上线流程.md`
2. `docs/Hostdzire部署附录.md`
3. `deploy/scripts/deploy-staging.sh`
4. `deploy/scripts/redeploy-staging-fast.sh`（即使最终走完整发布，也需理解为什么不能误用快速入口）
5. `.trellis/tasks/07-25-staging-visual-defect-fixes/prd.md`
6. `.trellis/tasks/07-25-staging-visual-defect-fixes/design.md`
7. `.trellis/tasks/07-25-staging-visual-defect-fixes/implement.md`

## External References

- 无外部引用；本结论仅依据仓库内当前 Runbook、部署脚本和任务规划。

## Related Specs

- `.trellis/spec/frontend/visual-system.md`：共享壳层、响应式、移动 44×44 CSS px 目标和真实浏览器验收。
- `.trellis/spec/frontend/quality-guidelines.md`：浅/深/system、响应式、200% 缩放和真实浏览器门禁。
- `docs/operations.md:47-51`：健康探针不能替代真实浏览器，公网不得运行依赖本地 Mock Provider 的纵向 E2E。

## Caveats / Not Found

- 本次研究未执行 Git、部署、SSH、浏览器或网络请求，未核对此刻主工作目录是否干净、是否位于 `main`、是否已推送、远端主机身份或线上运行状态。
- 快速脚本在自动公网探针通过后会更新 `current`，但当前任务因共享壳层变化应走完整流程；不要用快速路径的 5 个文件门禁替代 Runbook 决策。
- `current` 只是最后验收记录，不是流量开关；容器在更新它之前已替换，见 `docs/Hostdzire部署上线流程.md:114-120`。

## 2026-07-25 线上执行结果

- 已从干净的 `origin/main@ad46f5e9201af1d046c702b71e09c4e924660910` 临时工作树生成安全归档并上传至 `hostdzire`。
- 已创建 release `mvp-20260725-160540-ad46f5e9201a`，部署前生成非空备份 `/root/partsignal/backups/partsignal-20260725T080559Z.sql.gz`。
- `deploy-staging.sh` 以默认 full 模式完成构建、迁移、幂等种子和容器健康检查；Nginx 模板未变化，未修改 Nginx 站点。
- 公网 DNS、live/ready、首页标题、缓存头、SPA fallback、对象存储代理与主机资源检查通过。
