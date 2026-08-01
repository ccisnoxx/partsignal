# 24 表门禁目标收敛设计

## 1. 设计目标

把 24 表门禁的“扫描当前页面有什么表”改为“逐项证明清单指定的表存在并通过原有边界检查”。权威对象仍是现有 `sitewideTableInventory`；不修改生产表格，只让测试清单同时承担静态登记和运行时定位职责。

## 2. 权威实现位置

| 职责 | 权威位置 | 变更 |
| --- | --- | --- |
| 24 表静态与运行时清单 | `frontend/tests/e2e/cross-page-visual-convergence.spec.ts` | 为每项增加 `regionLabel`；仅弹窗项增加 `dialogName` |
| 目标几何和长文本检查 | 同一文件现有表格辅助函数 | 接受精确 `Locator`，所有后代查询限定在该 region |
| surface 打开与逐项验真 | 同一文件 24 表主用例 | 按 surface 打开一次，按清单项逐个断言唯一、可见并检查 |
| 条件表最小数据图 | `frontend/tests/e2e/shared-data.setup.ts` | 强化就绪判定并补齐真实关联数据 |
| 可访问根节点 | `frontend/src/shared/components/TableRegion.tsx` | 已有实现，保持不变 |

## 3. 清单合同

`TableInventoryItem` 在现有四个字段上增加最少的运行时身份：

```ts
type TableInventoryItem = {
  label: string;
  source: string;
  marker: string;
  surface: string;
  regionLabel: string;
  dialogName?: string;
};
```

- `label`：报告与失败消息使用的清单名称。
- `marker`：继续证明生产源码保留已登记表面。
- `regionLabel`：直接对应 `TableRegion` 的现有 `aria-label`。
- `dialogName`：只用于“登记人工观测”和“获取模型”；页面表不填，不引入通用 scope DSL。
- GEO 内容排行的现有清单只占一项，运行时固定检查“表现最佳内容 Top 5”；该名称已经由 `ContentRankingCard` 传给 `TableRegion`，不修改产品代码。

## 4. 精确定位与检查链

```text
打开 surface
  -> 完成该 surface 必需的现有交互（切 Tab / 选产品 / 打开弹窗）
  -> 取出此 surface 的全部 inventory item
  -> 若有 dialogName，先精确定位可见 dialog
  -> 在作用域内按 regionLabel 精确定位 role=region
  -> 断言 count=1 且 visible
  -> 对该 Locator 执行边界、长文本、固定列和首行悬停检查
  -> 关闭弹窗并确认无残留
```

辅助函数只接受已经解析的目标 region，不再自行决定扫描哪个表。文档宽度仍由 `page` 检查；以下读取改为目标相对查询：

- region 自身边界；
- `.table-cell-ellipsis:visible` 及其所属单元格；
- 固定列及其 hover 背景；
- 目标 region 的第一条真实数据行。

零匹配由显式存在性断言失败，多匹配由唯一性断言失败；删除 `inspectCurrentTableSurface` 的“没有可见表就跳过”分支。五类 200% zoom 用例若仍需要扫描代表页面的全部可见表，可保留独立的现有全页辅助路径，不能反向让 24 表用例恢复全局选择。

## 5. 条件表数据图

### 5.1 就绪判定

现有 `hasSharedData` 的“四类列表非空”不足以证明 24 表可验收。实现时把它收敛为一套带 `VISUAL-` 标识的完整关联图，至少验证：

- 产品、批准事实版本、平台与内容任务关联一致；
- 内容任务同时有内容版本和生成作业；
- 同一 AI 渠道有请求 Header、模型及操作日志，并能调用本地假服务发现模型；
- 同一内容版本有发布账号和带公开 URL 的已发布记录；
- 同一产品有问题主题，且同一发布记录至少关联 3 条完整 GEO 观测，使洞察返回平台表现、最佳内容排行和覆盖矩阵。

发现完整图时复用；只有部分旧数据时新建一套完整图，不补写或猜测操作者已有对象。

### 5.2 最小创建顺序

复用 `mvp-flow.spec.ts` 已经验证的 API 顺序，只保留呈现目标表所需步骤：

1. 现有产品 → PUBLIC 事实 → 提交并批准；平台类型 → Prompt → 平台 → 内容任务 → 人工内容版本。
2. AI 渠道 → `X-E2E-Region` / `X-E2E-Secret` Header → 模型 → 测试并启用 → 创建一条生成作业；这些操作同时产生 Header、模型、作业和渠道日志表数据。
3. 人工内容版本提交并批准 → 发布账号 → 人工发布记录 → 标记平台审核 → 标记已发布；只创建 GEO 候选所需的公开 URL 和最小证据。
4. 创建问题主题和 3 条共享同一已发布文章的 GEO 观测，复用项目上传意图与本地对象存储完成最小截图证据，使平台表现、最佳内容排行和覆盖矩阵均非空。就绪判定使用该发布记录的 `publication_record_id` 精确查询洞察，不让其他产品的全局数据替代当前图。

准备阶段每一步沿用 `body` / `post` 的非 2xx 显式错误；不使用 `page.route` 固定成功响应，不等待或依赖其他 spec 生成数据。Playwright 当前 `workers: 1` 且 setup project 是 E2E 前置，数据在目标 spec 执行前稳定可用。

### 5.3 目标解析与弹窗交互

- `resolveTargets` 应从完整 `VISUAL-` 图解析产品、任务、平台和渠道，不再使用任意列表第一项拼接可能不相关的路由。
- 打开人工观测弹窗后，先选择该图中的产品并等待文章候选加载，再定位“产品文章观测结果”。不提交第二条观测。
- 打开模型发现弹窗时使用同一已配置 Header 的渠道，让本地假 AI 服务返回 `e2e-model`，再定位“远端模型列表”。不点击“添加”。

## 6. 失败信息与防回归证明

- 每个运行时断言的 message 包含 `label`、`surface`、`regionLabel` 和当前视口，便于直接定位缺失项。
- 代码结构本身证明背景表不能替代：弹窗项的 Locator 从 dialog 开始，页面项从精确 region 名称开始。
- 实施验证时应临时确认一次负向能力：将一个目标名称改为不存在值后，定向用例在该项明确失败；恢复后再运行正式命令。该临时改动不提交，也不需要新增专门测试文件。

## 7. 兼容性、文档与回滚

- 无产品行为、可访问名称、API、数据库、权限、依赖或构建产物变化。
- 任务只改变 E2E 数据和断言精度；既有 24 表视觉口径、两个视口和 200% zoom 代表用例保持不变。
- 当前前端组件规范和质量规范已覆盖 `TableRegion`、长文本压力与 Playwright 工作目录；若实施没有发现新的稳定项目约束，不更新 `.trellis/spec/`。
- 回滚点是两个 E2E 文件；不涉及持久化迁移。隔离脚本继续删除一次性数据库和临时对象存储。
