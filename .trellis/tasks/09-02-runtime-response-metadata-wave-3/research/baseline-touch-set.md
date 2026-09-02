# Wave 3 Baseline Touch Set

- 采集时间：2026-09-02（Asia/Shanghai）
- branch：`main`
- HEAD：`415ebbdea5b25fdfd5af934b3c981f2183c619b6`
- 创建本 Task 前 `git status --porcelain=v1`：545 项
- 创建本 Task 前完整 porcelain SHA-256：`c7329edd1e977e7006ca577e38239254bbe388e6204e0f281a6c8e543312ef79`

## Implementation Activation Baseline

- 启动时间：2026-09-02（Asia/Shanghai）
- branch：`main`
- HEAD：`1d937d5ba44ac06af7c68b57f76cc3388714ea90`
- prerequisite work commit：`89245be8`，并已由 `d79f74d` 归档、`1d937d5` 记录 journal；`89245be8` 是启动 HEAD 的祖先。
- `git status --porcelain=v1`：546 项，等于 545 项受保护既有脏状态加本 Task 未跟踪目录。
- 过滤本 Task 目录后，受保护 porcelain SHA-256 仍为 `c7329edd1e977e7006ca577e38239254bbe388e6204e0f281a6c8e543312ef79`。
- 543 个既有 artifacts 删除仍处于 staged 状态，除此之外无 staged path；`.gitignore` 与 `backend/app/schemas/configuration.py` 仍为既有 unstaged 修改。
- 四个 Wave 3 候选产品/测试文件相对启动 HEAD 均无 diff；`backend/app/schemas/geo_files.py` 的 prerequisite 修复已提交且本 Task 不再触碰。
- 无 filter 全局 report 为 194 条/退出 1：155 `missing_status`、39 个 422 `schema_drift`、0 个 success drift；涉及全部 43 个 operation（30/12/1）。

## Existing Out-of-scope Dirty Set

545 项精确构成为：

- `.gitignore`：已存在修改，numstat `+2/-0`；
- `backend/app/schemas/configuration.py`：已存在格式变化，numstat `+7/-2`；
- 543 个既有删除项，主要位于 artifacts 范围。

创建 Task 后 status 为 547 项，新增的两类授权 bookkeeping 是：

- `.trellis/tasks/08-31-non-2xx-contract-check/task.json` 的 parent-child link；
- 新目录 `.trellis/tasks/09-02-runtime-response-metadata-wave-3/`。

过滤这两类 bookkeeping 后，当前剩余 porcelain hash 仍精确等于上述 baseline SHA-256，证明创建 Task 没有改变既有脏集合。

以下四个预期产品/测试文件在 Task 创建前无 diff：

- `backend/app/routers/publication.py`
- `backend/app/routers/observation.py`
- `backend/app/routers/workbench.py`
- `backend/tests/unit/test_runtime_response_metadata.py`

并行 `.trellis/tasks/08-30-v2-live-readonly-acceptance` 在基线中无本 Task diff，本 Task 不结束、归档或修改它。

## Authorized Task Touch Set

规划阶段：

- 本 Task 目录；
- parent `task.json` 中由 `task.py create` 维护的 child link。

获批实施后：

- 上述三个 router；
- `backend/tests/unit/test_runtime_response_metadata.py`；
- 本 Task artifacts / parent-child bookkeeping。

不授权 `backend/app/schemas/geo_files.py`；该文件只在独立 schema identity prerequisite 获批后由另一个 Task 处理。

## Preservation Gate

实施前后均以完整 status 过滤授权 Task paths 后计算 hash；out-of-scope 部分必须保持 `c7329edd1e977e7006ca577e38239254bbe388e6204e0f281a6c8e543312ef79`。如果 hash 改变，先定位外部并行变化；不得自动恢复、删除、格式化或吸收差异。

提交时只使用精确文件参数的 `git add --`，并以 `git diff --cached --name-only` 验证 index。禁止 `git add .`、`git add -A`、目录级 broad add，禁止将 `.gitignore`、543 个删除项、`configuration.py` 或未识别 dirty file 纳入 commit。

## Candidate Preservation Result

- Wave 3 产品/测试 diff 精确为三个 router 与 `backend/tests/unit/test_runtime_response_metadata.py`；Task 目录仍只有计划内 8 个 artifacts。
- 过滤四个候选文件与本 Task 目录后，受保护 porcelain SHA-256 仍为 `c7329edd1e977e7006ca577e38239254bbe388e6204e0f281a6c8e543312ef79`。
- 543 个 artifacts 删除仍保持 staged，除此之外没有预先 staged path；`.gitignore`、`backend/app/schemas/configuration.py` 与并行 Task 保持原样。
- `contracts/openapi.yaml`、generated client、schema/service/comparator、parent 与 archived prerequisite 均无本 Task diff。
- 当前无 filter response report 为零差异/退出 0；独立 Review 无 MEDIUM 及以上问题。

## Resumed Final Validation Baseline

- 恢复 HEAD：`08cec203e8fcbbe44367e4cce3b0f36f120068d6`；包含 GEO identity 工作提交 `89245be8`、publication event-time 工作提交 `562d2bce` 及各自归档/journal 提交。
- 四个 Wave 3 候选文件相对当前 HEAD 的 binary diff SHA-256 仍为 `0f3b6a7f7aa4d5e850731afb0dd9d28b91ab9f2b25cd4c0f6c2707185c940ddc`，与 publication 前置任务创建时记录的受保护候选完全相同；该修复没有改变既有独立 Review 的代码前提。
- 当前 porcelain 共 550 项：543 个 staged `artifacts/**` 删除、2 个既有 unstaged 文件、4 个 Wave 3 产品/测试文件与 1 个未跟踪 Wave 3 Task 目录。过滤后者后仍为 545 项，SHA-256 精确等于原始受保护基线 `c7329edd1e977e7006ca577e38239254bbe388e6204e0f281a6c8e543312ef79`。
- 恢复后的 PostgreSQL sentinels 为 `4 passed`；required metadata/contract/ruff/mypy/diff/Trellis gates 全部通过；唯一无 filter response report 退出码为 0、零差异。
