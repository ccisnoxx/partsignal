# DEF-002 内容任务列表投影修复证据

## 实现结论

- `content_task_out` 与 `content_tasks_out` 复用 `_content_task_payload`。
- 共享基础投影显式排除仅供服务端创建幂等使用的 `idempotency_key`。
- Pydantic `ContractModel(extra="forbid")` 保持不变，未知响应字段仍显式失败。
- OpenAPI、数据库模型、迁移、路由、幂等创建服务和部署配置均未修改。
- 后端数据库规范已补充该内部字段的共享投影边界。

## 回归数据与断言

PostgreSQL 集成用例同时包含：

- `seed_graph` 创建的历史任务，`idempotency_key=NULL`；
- API 创建的新任务，`idempotency_key` 为非空请求键；
- 无筛选列表、`platform_profile_id` 筛选列表和单条详情；
- 同键同载荷重放、同键异载荷冲突；
- 取消任务的列表/详情动作投影。

所有列表和详情响应均断言不包含 `idempotency_key`，平台筛选结果均直接绑定请求平台。

## 验证结果

```text
Ruff（投影与相关集成测试）                         PASS
mypy（投影模块）                                  PASS
PostgreSQL 定向集成测试（3 项，未 skip）           PASS
OpenAPI 运行时/冻结合同/生成类型检查                PASS
git diff --check                                  PASS
```

PostgreSQL 命令：

```sh
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_publication_review_closure.py \
  -k "content_task_creation_idempotency or content_task_list_uses_current_platform_and_latest_generate_only or cancelled_content_task_deletion_requires_no_production_history" -q
```

结果：`3 passed`。直接在宿主机运行同一集成测试会因未设置
`PARTSIGNAL_TEST_DATABASE_URL` 跳过，该结果未计为通过；最终证据来自真实 PostgreSQL
测试容器。

## 剩余步骤

代码已达到可提交状态。按项目 Git 规则，提交前需用户确认提交计划；推送需另行授权。
修复推送后，父任务应基于新 `origin/main` 重新执行完整发布与浏览器回归。
