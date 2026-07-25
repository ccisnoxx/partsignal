# Research: 线上 Playwright 验收入口、认证与报告

- Query: 现有线上 Playwright 验收脚本、认证方式和报告路径是什么；哪些现有测试可在不写业务数据的边界内复用。
- Scope: internal
- Date: 2026-07-25

## Findings

### 没有专用 staging Playwright 脚本

仓库没有发现独立的 `staging` / `online` Playwright 脚本或专用配置。现有事实是：

- `frontend/playwright.config.ts:1` 明确称配置“只连接本地/CI PartSignal 栈，不启动或访问生产服务”。
- 配置允许用 `PARTSIGNAL_E2E_BASE_URL` 覆盖默认本地地址：`frontend/playwright.config.ts:15-18`。
- npm 入口只是通用 `playwright test`：`frontend/package.json:6-18`。
- 上一次线上验收的人类可读报告保存在 `.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md`；仓库没有与之对应的可重复线上 `.spec.ts`。

因此不能把整个 `npm --prefix frontend run e2e` 指向预发布。必须按用例逐个审计并只运行明确只读的标题，或使用项目 `playwright-cli` 做受控人工/半自动验收。

### 现有用例的线上安全分级

可复用但需定向运行：

- `frontend/tests/e2e/list-workbench-convergence.spec.ts`
  - 登录后只发 GET，设置浏览器 localStorage，打开但不提交“新增用户”对话框和更多菜单：`frontend/tests/e2e/list-workbench-convergence.spec.ts:20-40`、`frontend/tests/e2e/list-workbench-convergence.spec.ts:115-192`。
  - 375/320 指标图标与标题/数值不相交的真实几何断言在 `frontend/tests/e2e/list-workbench-convergence.spec.ts:51-73`、`frontend/tests/e2e/list-workbench-convergence.spec.ts:119-130`。
  - 第一条测试会把登录后页面截图写入 Playwright output，见 `frontend/tests/e2e/list-workbench-convergence.spec.ts:75-113`；若页面含敏感正文，不应在线上运行该标题。

- `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
  - 登录和只读目标解析在 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:22-52`。
  - 移动导航、主题、默认 Drawer 44×44、280px Drawer、Escape 焦点恢复断言在 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:125-145`。
  - 可定向复用窄屏和 200% 标题：`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:312-333`、`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:437-472`。
  - “九张代表页基线...”标题使用 `toHaveScreenshot`，不得对动态公网环境运行：`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:335-387`，并受 `.trellis/spec/frontend/visual-system.md` 的本地/CI 基线约束。
  - 所有标题都会先解析产品、任务、内容版本和平台；缺少 `contentVersionId` 时会在进入代表页面前失败，见 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts:31-71`。

- `frontend/tests/e2e/dashboard-geo-convergence.spec.ts`
  - 只读 GET 与 UI 几何为主：`frontend/tests/e2e/dashboard-geo-convergence.spec.ts:19-60`。
  - 多个标题会向 `testInfo.outputPath()` 写截图/PDF：`frontend/tests/e2e/dashboard-geo-convergence.spec.ts:62-99`、`frontend/tests/e2e/dashboard-geo-convergence.spec.ts:101-133`、`frontend/tests/e2e/dashboard-geo-convergence.spec.ts:198-237`。线上使用前必须确认不会持久化敏感正文。

禁止对预发布运行：

- `frontend/tests/e2e/ai-channel-management.spec.ts`
  - 文件自述依赖本地协议替身：`frontend/tests/e2e/ai-channel-management.spec.ts:1-8`。
  - 创建渠道/Header/模型、测试连接、启用并在 afterEach 删除：`frontend/tests/e2e/ai-channel-management.spec.ts:10-21`、`frontend/tests/e2e/ai-channel-management.spec.ts:65-128`。
  - 当前 AI 表格 1440/375 几何断言嵌在这个破坏性闭环测试内部：`frontend/tests/e2e/ai-channel-management.spec.ts:131-180`、`frontend/tests/e2e/ai-channel-management.spec.ts:408-443`。
  - 因此不能仅用 `--grep` 抽出 AI 几何段；线上 AI 渠道详情必须通过 Playwright CLI 打开既有渠道并复现同样的 `boundingBox`/滚动断言，不能创建测试渠道。

- `frontend/tests/e2e/mvp-flow.spec.ts`
  - 是完整写入型纵向闭环，创建/修改用户、产品、任务、生成、审核、发布和观测，不得对公网运行；Runbook 也禁止公网运行依赖回环 Mock Provider 的纵向 E2E：`docs/Hostdzire部署上线流程.md:110-112`。

### 可复用的定向命令形状

在已经安全注入管理员密码、并确认存在内容版本后，只读定向执行形状为：

```sh
PARTSIGNAL_E2E_BASE_URL=https://geo.962850.xyz \
PARTSIGNAL_SEED_ADMIN_PASSWORD="$STAGING_ADMIN_PASSWORD" \
npm --prefix frontend exec -- playwright test \
  tests/e2e/list-workbench-convergence.spec.ts \
  --grep '窄屏只允许 TableRegion 内横向滚动'
```

```sh
PARTSIGNAL_E2E_BASE_URL=https://geo.962850.xyz \
PARTSIGNAL_SEED_ADMIN_PASSWORD="$STAGING_ADMIN_PASSWORD" \
npm --prefix frontend exec -- playwright test \
  tests/e2e/cross-page-visual-convergence.spec.ts \
  --grep '三个页面类型在代表窄屏|三类页面在真实浏览器 200%'
```

这些只是现有本地/CI spec 的定向复用，不是仓库定义的线上发布命令。运行前主 Agent必须完整阅读目标 spec，确认所选标题没有新增写操作。

### 认证方式

- 现有视觉 spec 从 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 读取密码；若缺失会回退到本地开发密码 `partsignal-admin-dev`：`frontend/tests/e2e/list-workbench-convergence.spec.ts:4-5`、`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:8-10`。预发布必须显式注入真实密码，不能依赖 fallback。
- 登录通过真实 `/login` UI，账号 `admin`，提交后以 `GET /api/v1/auth/me` 验证会话：`frontend/tests/e2e/list-workbench-convergence.spec.ts:20-27`、`frontend/tests/e2e/cross-page-visual-convergence.spec.ts:22-29`。
- 后端通过 Secure、HttpOnly、SameSite=Lax 会话 Cookie 和 Strict CSRF Cookie认证：`backend/app/routers/identity.py:84-105`。
- `frontend/playwright.config.ts` 没有配置 `storageState`；现有 spec 每个测试重新登录，也没有统一 logout。
- Runbook 要求优先复用已认证会话；必须登录时，只读取共享环境文件中的单个 `PARTSIGNAL_SEED_ADMIN_PASSWORD` 到自动化内存，不读取整个文件、不输出、不记录、不写临时文件，完成后登出并清除引用：`docs/Hostdzire部署附录.md:334-342`。

只在获得 Hostdzire 只读授权后，密码可按以下形状进入当前 shell 变量而不回显：

```sh
set +x
STAGING_ADMIN_PASSWORD=$(
  ssh -F /Users/sc/.ssh/config hostdzire \
    "sed -n 's/^PARTSIGNAL_SEED_ADMIN_PASSWORD=//p' /root/partsignal/shared/.env.staging"
)
test -n "$STAGING_ADMIN_PASSWORD"
# 在同一 shell 中运行定向 Playwright；不要输出变量。
unset STAGING_ADMIN_PASSWORD
```

现有 spec 不执行 logout；如果直接复用，会在服务端留下会话直到过期。严格线上验收应优先使用可控的 Playwright CLI 持久会话，验收后显式退出登录并销毁本地 profile；上次报告也记录了该风险：`.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md:98-104`。

### 报告与产物路径

- 本地默认 reporter 是 `list`，只在 CI 自动启用 `html + list`：`frontend/playwright.config.ts:8-10`。
- trace 仅在失败时保留：`frontend/playwright.config.ts:15-18`。
- Playwright 默认测试输出目录是 `frontend/test-results/`；CI HTML 报告目录是 `frontend/playwright-report/`。两者均被忽略：`.gitignore:19-25`。
- `testInfo.outputPath(...)` 的截图/PDF进入当前测试的 `frontend/test-results/...` 子目录。
- 已持久化的上一次线上人类验收报告：`.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md`。
- 当前任务重新部署后的验收结论应写入当前任务自己的 `research/`，不要把临时 Playwright HTML、trace 或含业务正文的截图提交为权威报告。

### 主 Agent 必须完整阅读

1. `docs/Hostdzire部署上线流程.md`
2. `docs/Hostdzire部署附录.md`
3. `frontend/playwright.config.ts`
4. `frontend/tests/e2e/list-workbench-convergence.spec.ts`
5. `frontend/tests/e2e/cross-page-visual-convergence.spec.ts`
6. `frontend/tests/e2e/ai-channel-management.spec.ts`（为了确认其不可在线上运行，并复用其中几何断言）
7. `.trellis/tasks/07-25-post-deployment-visual-acceptance/research/online-acceptance-report.md`

## External References

- 项目锁定 `@playwright/test` `^1.61.1`：`frontend/package.json:32-35`。
- 未浏览外部 Playwright 文档；当前问题可由项目配置与测试实现完整回答。

## Related Specs

- `.trellis/spec/frontend/quality-guidelines.md`：真实浏览器、响应式、主题、200% 缩放和宽表局部滚动。
- `.trellis/spec/frontend/visual-system.md`：移动 44×44 CSS px、真实 tab zoom、本地/CI 视觉基线边界。
- `.trellis/tasks/07-25-staging-visual-defect-fixes/prd.md:38-67`：几何断言、主题/尺寸覆盖、不写业务数据和不更新未批准 snapshot。

## Caveats / Not Found

- 没有找到可直接“一键线上验收”的安全脚本；现有 spec 混合了只读、截图和写入型用例，必须定向选择。
- AI 渠道缺陷的现成几何断言与写业务数据的测试不可分割；线上只能用既有渠道做受控 Playwright CLI 复核，不能运行该 spec。
- 本次研究未运行浏览器、Playwright、SSH 或公网请求，未生成报告或产物。
- 线上动态页面截图可能包含用户、审计、Prompt 或正文信息；除非已确认无敏感内容，不应持久化截图、trace 或 HTML 报告。

## 2026-07-25 线上执行结果

- 使用本机 `playwright-cli` 的临时命名会话登录真实公网域名，`GET /api/v1/auth/me` 返回 `200`；密码未回显、截图或写入文件。
- AI 渠道使用现有渠道 `5f664cef-d1f3-4a97-ae96-af0179191ced` 只读复验。1440×1000 下测试状态右边界为 `953`、操作区左边界为 `987`，表格和文档宽度分别为 `631/631`、`1440/1440`；375×844 下文档宽度为 `375/375`，横向滚动仅位于表格内部 `630/323`，更多操作可见。
- 用户和平台各 5 张指标卡在 375px、320px 下均无图标与标题/数值相交，四个场景的文档宽度均等于视口宽度。
- 总览和用户管理在 375px、768px 下的导航按钮、主题按钮和默认 Drawer 关闭按钮均至少 `44×44`；Drawer 宽度保持 `280px`，Escape 关闭后焦点恢复到导航触发器，文档无横向溢出。
- 上述稳定巡检的 console `error/warning=0`、`pageerror=0`、`requestfailed=0`。未运行写入型公网 E2E、未创建业务数据、未修改线上配置、未保存截图或 trace。
- 内容审核页未执行：权威 API 与 PostgreSQL 均确认当前没有内容版本，详见 `online-content-version-id.md`。
