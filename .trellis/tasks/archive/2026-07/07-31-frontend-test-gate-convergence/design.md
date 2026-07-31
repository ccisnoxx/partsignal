# 前端测试门禁收敛：技术设计

## 1. 设计原则与边界

本任务采用“先测量、后最小修复”：复用现有 Vitest、Playwright 和 E2E 隔离脚本，不增加依赖、运行器或第二套门禁。默认修改范围仅限前端测试、测试配置和公共测试设置；未确认根因前不改生产组件。

## 2. PS-QA-109：Prompt E2E 过期断言

`mvp-flow.spec.ts` 已创建复用 Prompt 和绑定该 Prompt 的平台，现有数据足够完成验证，无需新增夹具：

1. 将页面参数从 `platform_profile_id=${profile.id}` 改为 `platform_prompt_id=${platformPrompt.id}`。
2. 通过当前可访问界面验证 Prompt 名称或编辑器内容，证明选中了测试创建的 Prompt。
3. 在 `aria-label="Prompt 使用平台"` 区域验证 `E2E 论坛 ${suffix}` 和绑定数量。
4. 保留内容任务、模型选择和“生成平台预览”断言，继续覆盖完整业务链路。

不恢复“当前平台”文案，也不增加旧参数兼容逻辑。

## 3. PS-QA-110：Vitest 异常耗时

### 3.1 建立可比较基线

- 仅使用正确入口：仓库根目录运行 `npm --prefix frontend run test`，或在 `frontend/` 内运行 `npm exec -- vitest run`。
- 记录总耗时、文件数、测试数和慢用例，不把错误工作目录产生的 jsdom 错误计入基线。

### 3.2 根因隔离

使用 Vitest 已有的文件筛选、原生 reporter 和分片能力进行两轮比较：

1. 分文件运行并按耗时排序，定位单独运行也慢的文件。
2. 将慢文件与快文件组合或分片运行，对比单独耗时与累计耗时，判断是否存在共享状态、清理或并发累积。
3. 对确认路径读取完整测试、`frontend/src/test/setup.ts`、`frontend/vite.config.ts` 及相关调用方，确定唯一共同所有者。

诊断脚本不是交付物；现有命令能回答问题时不新增永久脚本。

### 3.3 最小修复

- 共同设置导致累积时，在 `setup.ts` 或 Vitest 配置的权威所有者处修一次。
- 单个测试存在不必要等待、定时器泄漏或未清理资源时，只修改该测试及其直接公共夹具。
- CSS 解析告警、导航告警或弃用提示只有在测量证明其造成主要耗时后才进入修复范围。
- 不提高 `testTimeout`、不盲目提高 `maxWorkers`，不关闭必要 cleanup，也不降低断言强度。

## 4. 预计文件

- 必改：`frontend/tests/e2e/mvp-flow.spec.ts`
- 按证据选改：`frontend/src/test/setup.ts`、`frontend/vite.config.ts`、确认的慢测试文件
- 任务记录：本任务 `prd.md`、`design.md`、`implement.md`，实施完成后新增 `report.md`

`frontend/src/features/configuration/PlatformPromptsPage.tsx` 只作为当前合同核对依据，不是默认修改目标。

## 5. 风险与回退

- 性能修复可能改变测试隔离：必须先运行受影响测试，再连续运行两次完整门禁。
- 单机耗时受负载影响：300 秒标准以空闲当前工作站的连续两次结果判断，并同时保留原始耗时。
- E2E 参数修正可能只解决导航而未验证业务：必须保留 Prompt 身份、绑定平台和预览三层断言。
- 本任务应为测试侧行为保持变更；可通过回退对应测试/配置文件恢复，不需要业务数据迁移。
