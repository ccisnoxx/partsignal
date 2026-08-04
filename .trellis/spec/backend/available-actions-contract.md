# 资源流程与动作投影合同

## 1. 适用范围 / 触发条件

当资源响应需要表达当前业务阶段、唯一主任务，或当前操作者可尝试的编辑、状态、危险删除、凭据、保存或子资源命令时，使用本合同。它防止前端按角色、状态或分页集合重建业务流程，也防止列表、详情和命令响应产生不同投影。

集合级创建、导航、查看、复制、筛选、导出、打印、认证自服务和文件传输内部动作不属于资源动作投影。

## 2. 签名

每个响应 Schema 使用自身的 typed token，并把 `workflow_stage`、`primary_task` 和 `available_actions` 中适用的字段设为必填；不得建立跨领域通用 enum，也不得给业务投影设置隐式默认值。

```python
class GenerationJobOut(ContractModel):
    workflow_stage: Literal["IN_PROGRESS", "SUCCEEDED", "RETRYABLE_FAILURE", "HISTORICAL_FAILURE"]
    primary_task: Literal["VIEW_EXECUTION_PROGRESS", "VIEW_GENERATED_CONTENT", "HANDLE_FAILURE", "VIEW_FAILURE"]
    available_actions: list[Literal["RETRY"]]

def users_out(db: Session, users: list[User], *, actor: User) -> list[UserOut]: ...
def content_versions_out(db: Session, contents: list[ContentVersion]) -> list[ContentVersionOut]: ...
```

需要操作者或数据库事实的投影器必须显式接收这些输入。列表投影器负责批量读取资格事实；单项投影器可以复用列表投影器。

## 3. 合同

- PostgreSQL 当前资源、引用关系和当前操作者是动作资格的权威输入。
- `workflow_stage` 是领域内可解释的当前阶段；`primary_task` 是该资源当前唯一高频主入口。两者都是读模型投影，不是写入授权凭证。
- `available_actions` 表示响应生成时可尝试的命令，不是授权凭证；命令入口必须重新执行服务端校验并保留既有错误合同。
- 同一资源的列表、详情和返回资源的 mutation 响应使用同一领域资格规则。
- OpenAPI 中上述适用字段必须为 required；`frontend/src/shared/api/schema.d.ts` 只能从合同生成。
- 前端主入口只按资源自己的 `primary_task` 穷尽映射，低频命令只按 `available_actions.includes("TOKEN")` 渲染或启用；不得用 `status`、`is_active`、账号类型、权限 Hook 或关联集合推断单个资源的流程。
- 认证自服务复用 `UserOut` 时显式返回 `available_actions: []`；管理接口使用 actor-aware 投影，不另建平行 DTO。
- mutation 成功后使用响应或失效既有 query 取得重新投影的动作；竞态拒绝后刷新资源，不加兼容分支。
- presenter 和 Pydantic serializer 内不得逐行查询数据库。涉及引用门禁的集合先批量取得 id 集合，再在内存投影。

## 4. 校验与错误矩阵

| 条件 | 预期结果 |
| --- | --- |
| 当前业务事实不满足动作资格 | 响应不包含该 token，前端不呈现或禁用入口 |
| 当前业务阶段改变 | 服务端返回该 Schema 内新的精确 `workflow_stage` 和 `primary_task`；前端不补旧主入口 |
| 客户端持有过期 token 后提交 | 服务端重新校验并返回既有 `403`/`409`/领域错误；不得按旧投影放行 |
| 响应构造遗漏 `available_actions` | Pydantic、OpenAPI 合同检查或前端类型检查失败；不得静默补 `[]` |
| 调用方没有资源动作上下文 | 调用方必须显式给出合法投影；仅已定义的认证自服务边界可显式给 `[]` |
| 列表动作依赖历史引用 | 使用固定次数批量查询；禁止随行数增长逐行查询 |
| token 不属于该资源的 typed union | 后端类型/Schema 或生成前端类型检查失败；不得增加字符串别名 |

## 5. Good / Base / Bad

- Good：失败且父任务仍为开放态的生成作业返回 `workflow_stage=RETRYABLE_FAILURE`、`primary_task=HANDLE_FAILURE` 和 `RETRY`；前端先打开失败处理，用户确认后才执行重试。
- Base：旧快照失败作业返回 `HISTORICAL_FAILURE`、`VIEW_FAILURE` 和空动作数组；页面只读展示，也不从 `status === "FAILED"` 自行补回重试。
- Bad：前端使用 `isAdmin && row.status === "DISABLED"` 推导主任务或删除，或后端在逐行 presenter 中查询引用关系。

## 6. 必需测试

- 后端单元测试：对同一表面状态、不同关联事实覆盖一个允许和一个拒绝场景，并断言精确 `workflow_stage`、`primary_task` 和命令 token。
- 后端集成测试：断言列表、详情或 mutation 返回的 required 字段，并对相同事实调用命令验证最终守卫。
- 引用型列表：用查询计数证明增加资源行数不会线性增加动作资格查询。
- 前端测试：使用相同角色/状态、不同 `primary_task` 或 `available_actions` 的 fixture，分别断言主入口和具体命令只随各自投影变化。
- 合同验证：运行 `make contract-check`、后端 mypy 和前端 typecheck。

## 7. Wrong vs Correct

### Wrong

```tsx
const primaryTask = row.status === 'FAILED' ? 'HANDLE_FAILURE' : 'VIEW_EXECUTION_PROGRESS';
```

这在前端复制了服务端的角色、状态和历史引用规则。

### Correct

```tsx
const primaryTask = row.primary_task;
const canRetry = row.available_actions.includes('RETRY');
```

服务端投影决定主入口与可尝试命令，命令处理器仍在写入时校验真实状态。
