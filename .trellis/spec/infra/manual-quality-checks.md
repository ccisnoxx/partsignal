# 手工分层质量验证契约

## 权威入口与选择

根 `Makefile` 拥有命令与测试选集；[项目测试策略](../../../docs/testing.md#手工分层命令) 拥有使用方法、前置条件与证据边界。小任务选择快速检查，功能切片显式选择领域检查，准备部署指定 commit 时使用完整 `verify-release`。GitHub 只用于备份与服务器拉取，不设置自动或手动 Actions 工作流、required checks 或分支保护。

## 命令合同

- `check-backend-fast`：Ruff、全 backend/app mypy、全部后端 unit。
- `check-frontend-fast`：canonical frontend 的 lint、typecheck、Vitest；`check-fast` 只组合两个快速目标，不依赖 Docker/integration/build/Playwright。
- `check-ai` / `check-geo`：选集直接引用已有测试与权威脚本，不分析 Git diff，不创建重复测试脚本。必须显式设置 `PARTSIGNAL_TEST_DATABASE_URL`；缺失非零，不能把 PostgreSQL fixture 的 skip 表述为领域集成通过。只使用专用测试库、本地 HTTP fake provider 与虚构凭据，不调用真实平台。
- GEO 人工文件流还要求显式 `OBJECT_STORAGE_ENDPOINT` 与已启动的本地开发对象存储；集成命令固定 development 适配器，不用假成功替代 PUT/HEAD。依赖容器 `/contracts` 挂载的合同文件留在发布全 integration，宿主机领域选集不临时修改测试或系统根目录来绕过该边界。
- GEO 宿主机集成通过连接级 `PGTZ=UTC` 保持容器 UTC 表达，避免本地数据库时区使首次提交与 JSON 重放的等值断言失真；不改数据库全局配置或业务序列化。
- GEO Collector HTTP 套件由 `test-geo-collector-contract` 执行并扫描秘密；领域命令保留该包装器，不直接替代其失败语义。Browser 专属包、运行合同、会话材料与 overlay 不进入快速/领域/发布默认入口；快速层后端 unit 中的历史安全边界断言不等于启动 Browser，GEO 领域选集排除 Browser 专属文件。
- `verify-release` 原样持有完整合同、双语言静态/unit、全部 PostgreSQL integration、GEO performance、镜像、真实栈/Playwright、部署脚本及 Dev/Prod Compose 配置检查。`verify` 直接依赖它，且展开内容相同。
- 各步骤非零必须向 Make 传播。dry-run、缺环境、skip、未执行都不能记为实际 suite 通过；定向通过不能记为完整发布通过。
- 修改选集时检查实际文件存在与领域边界；新增或重命名测试需要更新显式 integration 选集，不能用兜底全 integration 掩盖遗漏。完整发布入口执行另按当前交付要求，入口治理任务不自动重跑整套。

## 验证与恢复

修改命令后核对依赖图、`make -n`、实际受影响目标和失败传播。变更发布别名时比较新旧完整展开，不能删掉 build、integration、E2E、性能、部署或配置检查。任务记录实际环境与限制；本地 PostgreSQL 版本证据不能代替发布的 PG16 容器/恢复证据。回滚入口治理只还原相应 Make/文档，不改变业务数据或部署状态。
