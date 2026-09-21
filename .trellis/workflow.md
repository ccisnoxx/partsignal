# Development Workflow

这是本项目的 Trellis 工作流维护源。全局 AGENTS.md 管理授权、证据、验证与委派原则；项目 AGENTS.md 和 spec 管理领域差异。本文件保留任务恢复与生命周期合同。下列相对路径命令从项目根目录执行。

## Phase Index

- 小修、问题解答、只读审计可直接处理，无需先建 Trellis 任务。需要跨会话恢复、多阶段交付或复杂验收时，在已有工作授权内创建任务；用户拒绝任务记录时仍可完成已授权的工作。
- `planning`：明确目标、必要设计与验收；实现授权已明确且没有实质未决事项时进入执行。用户只要求规划时停在规划成果。
- `in_progress`：完成当前验收所需的实现与验证，复用未失效的上下文和检查结果。
- 完成后按需更新稳定规范；提交、归档和发布分别遵守用户授权与项目规则。暂停会话不等于完成任务。

需要步骤细节时运行 `python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y> --platform codex`。编号保留兼容既有调用；无需按编号把所有技能串成固定流水线。

<!-- 保留配对标签供仍消费文本提示的平台使用。Codex Hooks 只输出真实状态，不注入这些流程正文。 -->
[workflow-state:no_task]
当前没有活动 Trellis 任务。按请求处理；需持久恢复时可在授权范围内建任务。
[/workflow-state:no_task]

[workflow-state:planning]
当前任务处于 planning。补齐阻塞决策与必要验收；已有实现授权且准备就绪时开始执行。
[/workflow-state:planning]

[workflow-state:planning-inline]
当前任务处于 planning。主会话按需读取资料，准备就绪且已有实现授权时开始执行。
[/workflow-state:planning-inline]

[workflow-state:in_progress]
当前任务处于 in_progress。依据验收继续实现与验证；只为独立支线或必要复核委派。
[/workflow-state:in_progress]

[workflow-state:in_progress-inline]
当前任务处于 in_progress。主会话继续实现与验证，遵守显式 inline 配置。
[/workflow-state:in_progress-inline]

[workflow-state:completed]
任务标记 completed。核对验收与归档状态，不据状态字段推断已经提交或发布。
[/workflow-state:completed]

## Phase 1: Plan

#### 1.0 Create task

先复用本会话已明确的任务；不根据其他会话指针猜测活动任务。需要新记录时：

```bash
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/task.py create "<title>" --slug <name>
```

`--slug` 不含日期前缀；`create` 负责生成目录、`task.json` 和初始 `prd.md`，状态为 `planning`。有有效会话身份时关联该会话；缺失身份时按 CLI 提示处理，不借用别的会话。

#### 1.1 Requirement exploration

需求确有歧义时使用 `trellis-brainstorm`；能由仓库与现有上下文回答的事实直接检查。记录可观察验收、实质约束与未决事项，技术方案写在它的权威位置。

轻量任务可只有 `prd.md`。边界、迁移、回滚或执行依赖复杂时补 `design.md`、`implement.md`，已有等价且可恢复的资料用链接复用。文档数量和用户回复次数都不是实施授权的替代条件。

多个独立验收的交付可用 parent/child：父任务记录共同目标和集成验收，子任务负责实际交付。父子关系不表达执行依赖；在子任务资料中明确前置条件，不因存在子任务而启动父任务实现。

#### 1.2 Research

围绕尚未解决的具体问题调查；独立且较大支线可委派研究代理。跨会话仍需要的结论写入任务 `research/`，保留来源、版本与证据限制；一次性事实不必另建文档。

#### 1.3 Configure context

委派时传递准确 `Active task: <repo-relative task path>`、目标、范围、资料路径与验收；没有 Trellis 任务时明确说明，不虚构路径。角色和工具参数以实际宿主为准。

`implement.jsonl` / `check.jsonl` 是可选资料索引，每行 `{"file":"<repo-relative path>","reason":"<why needed>"}`；仅放实际所需 spec/research，`_example` 不是证据。按需读取条目，不因索引存在就全文注入；不要为了凑行数制造资料。

#### 1.4 Activate task

预期结果、授权和必要设计已明确时执行：

```bash
python3 ./.trellis/scripts/task.py start <task-dir>
```

`start` 将任务变为 `in_progress` 并关联本会话。只有用户明确要求评审后再实现或存在实质未决授权/结果/风险时等待；既有明确实现请求无需下一轮再次批准。

#### 1.5 Completion criteria

规划就绪意味着当前目标和验收可执行、阻塞决策已解决、必要资料可以恢复。对于只规划的请求交付规划；对于实施请求继续执行，不能用文档存在冒充实现完成。

## Phase 2: Execute

#### 2.1 Implement

首次进入未知模块或资料缺失时使用 `trellis-before-dev`，读取相关项目索引和合同。后续仅补读变化或缺失的部分。

独立支线有收益时委派；小型紧耦合工作直接实现。遵守显式 inline 配置，默认 auto 不意味着强制 implement/check 轮转。子代理在分配范围内直接工作，不递归派发同一任务。Hooks 只提供状态或路径时，子代理自行读取所需资料，不声称已获全文注入。

#### 2.2 Quality check

按影响选择项目真实的检查与验收证据；`trellis-check` 是按需检查入口。完整门禁仅在项目要求或风险需要时运行，相关修复后允许重新证明受影响的门禁。已成功且未受影响的检查复用；同因无进展或环境阻塞时报告，禁止无变化重跑。

公开合同、持久化数据、权限、并发、迁移或发布的高风险变更须独立只读复核；实现者自行修复后自查不能替代它。审查者报告问题，由文件所有者修复。

#### 2.3 Rollback

发现需求或设计错误时更新权威资料，修正受影响实现。只撤销本任务可识别的改动；涉及数据、他人工作或不可逆操作时先核对授权。缺少证据时调查具体缺口，不反复清空重做。

## Phase 3: Finish

#### 3.1 Quality verification

兼容旧入口：对应 2.2。复用仍有效的检查，不额外添加第二轮完整门禁。

#### 3.2 Debug retrospective

同一问题反复出现、修复假设失败或用户要求复盘时使用 `trellis-break-loop`，解释能够区分根因的证据。普通 bug 修好后不自动启动全面复盘。

#### 3.3 Spec update

仅当任务改变稳定契约、团队约定或现有规范已失效时使用 `trellis-update-spec`。选择现有权威文档，保留真正影响未来实现的内容；没有新知识时直接继续。

#### 3.4 Commit changes

用户请求或明确项目授权需要提交时，检查实际 diff 和 staged 状态，只提交已确认归属的文件/片段，遵循项目分支及提交约定。不能用 `git add .` 包含未知工作，也不默认 amend 或 push。未获提交授权不以工作树未清空阻止交付代码修改。

#### 3.5 Wrap up

按请求使用 `trellis-finish-work` 区分暂停、完成、归档和会话记录。只归档验收已完成且获准归档的任务；不得清理别的会话。报告实际变更、验证与剩余问题。

## Runtime and maintenance

- `.trellis/.runtime/sessions/` 保存会话指针；task 路径须解析在仓库内，不能以仓库外路径恢复资料。
- `task.py finish` 清除当前会话指针，任务状态不变；`archive` 标记完成、移入归档并清理指向该任务的指针。归档不可替代验收。
- 生命周期事件支持 `after_create`、`after_start`、`after_finish`、`after_archive`；调用前注意现有 hooks 和自动提交等副作用，参数以本项目 `--help` 为准。
- 使用 workspace journal 时只记录必要的恢复信息；`add_session.py`、`task.py archive` 可能自动提交，未获提交授权时核对并使用本地提供的禁用提交选项。
- 本项目 `.trellis/workflow.md`、`.agents/skills/` 和 `.codex/hooks/` 是本地定制源。Trellis 更新后比较并合并本地差异，不能把安装目录 `dist/` 当维护源，也不要为了同步本项目去修改并不存在的上游 `src/templates/`。
- `## Phase Index`、`## Phase 1: Plan` 和 `#### X.Y` 是 `common/workflow_phase.py` 的解析接口；修改时保持提取可用。Hook 的注册、状态输出与信任以当前宿主实际行为为准。
