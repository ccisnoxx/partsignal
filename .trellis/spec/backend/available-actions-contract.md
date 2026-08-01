# 资源动作投影合同

## 1. 适用范围 / 触发条件

当资源响应需要表达当前操作者可尝试的编辑、状态、危险删除、凭据、保存或子资源命令时，使用本合同。它防止前端按角色或状态重建业务资格，也防止列表、详情和命令响应产生不同动作。

集合级创建、导航、查看、复制、筛选、导出、打印、认证自服务和文件传输内部动作不属于资源动作投影。

## 2. 签名

每个响应 Schema 使用自身的 typed token，并把字段设为必填；不得建立跨领域通用 enum，也不得给字段设置默认值。

```python
class GenerationJobOut(ContractModel):
    available_actions: list[Literal["RETRY"]]

def users_out(db: Session, users: list[User], *, actor: User) -> list[UserOut]: ...
def content_versions_out(db: Session, contents: list[ContentVersion]) -> list[ContentVersionOut]: ...
```

需要操作者或数据库事实的投影器必须显式接收这些输入。列表投影器负责批量读取资格事实；单项投影器可以复用列表投影器。

## 3. 合同

- PostgreSQL 当前资源、引用关系和当前操作者是动作资格的权威输入。
- `available_actions` 表示响应生成时可尝试的命令，不是授权凭证；命令入口必须重新执行服务端校验并保留既有错误合同。
- 同一资源的列表、详情和返回资源的 mutation 响应使用同一领域资格规则。
- OpenAPI 中 `available_actions` 必须为 required；`frontend/src/shared/api/schema.d.ts` 只能从合同生成。
- 前端只按资源自己的 `available_actions.includes("TOKEN")` 渲染或启用命令，不得再用 `status`、`is_active`、账号类型或权限 Hook 推断单个资源的命令资格。
- 认证自服务复用 `UserOut` 时显式返回 `available_actions: []`；管理接口使用 actor-aware 投影，不另建平行 DTO。
- mutation 成功后使用响应或失效既有 query 取得重新投影的动作；竞态拒绝后刷新资源，不加兼容分支。
- presenter 和 Pydantic serializer 内不得逐行查询数据库。涉及引用门禁的集合先批量取得 id 集合，再在内存投影。

## 4. 校验与错误矩阵

| 条件 | 预期结果 |
| --- | --- |
| 当前业务事实不满足动作资格 | 响应不包含该 token，前端不呈现或禁用入口 |
| 客户端持有过期 token 后提交 | 服务端重新校验并返回既有 `403`/`409`/领域错误；不得按旧投影放行 |
| 响应构造遗漏 `available_actions` | Pydantic、OpenAPI 合同检查或前端类型检查失败；不得静默补 `[]` |
| 调用方没有资源动作上下文 | 调用方必须显式给出合法投影；仅已定义的认证自服务边界可显式给 `[]` |
| 列表动作依赖历史引用 | 使用固定次数批量查询；禁止随行数增长逐行查询 |
| token 不属于该资源的 typed union | 后端类型/Schema 或生成前端类型检查失败；不得增加字符串别名 |

## 5. Good / Base / Bad

- Good：失败且父任务仍为开放态的生成作业包含 `RETRY`；前端据此显示重试，命令到达后再次校验作业与父任务。
- Base：终态或旧快照生成作业返回空数组；页面不显示重试，也不从 `status === "FAILED"` 自行补回。
- Bad：前端使用 `isAdmin && row.status === "DISABLED"` 显示删除，或后端在逐行 presenter 中查询引用关系。

## 6. 必需测试

- 后端单元测试：对领域资格规则覆盖一个允许和一个拒绝场景，并断言精确 token。
- 后端集成测试：断言列表、详情或 mutation 返回的 required 字段，并对相同事实调用命令验证最终守卫。
- 引用型列表：用查询计数证明增加资源行数不会线性增加动作资格查询。
- 前端测试：使用相同角色/状态、不同 `available_actions` 的 fixture，断言命令入口只随投影变化。
- 合同验证：运行 `make contract-check`、后端 mypy 和前端 typecheck。

## 7. Wrong vs Correct

### Wrong

```tsx
const canDelete = isAdmin && !row.is_active;
```

这在前端复制了服务端的角色、状态和历史引用规则。

### Correct

```tsx
const canDelete = row.available_actions.includes('DELETE');
```

服务端投影决定入口，命令处理器仍在写入时校验真实状态。
