# 精简初始账号与管理员改密入口实施计划

## 1. Contract And Migration

- [ ] 更新 `contracts/database.md`，记录两个初始账号、独立密码来源和一次性旧账号清理边界。
- [ ] 新增不可逆迁移 `0010_user_cleanup.py`，冻结四个目标用户名。
- [ ] 在迁移中预检全部当前用户外键引用，输出用户名和引用位置；任一引用使整个迁移回滚。
- [ ] 无引用时删除目标会话和用户，并将既有 `content_editor.must_change_password` 设置为 `true`。
- [ ] 更新迁移集成测试，覆盖空库、六账号清理、引用阻断和无部分删除。

## 2. Initialization And Deployment

- [ ] 扩展 `seed_demo` 和 CLI，要求管理员与工程师两个独立初始密码。
- [ ] 新建 `content_editor` 时使用 `ENGINEER` 和 `must_change_password=true`；既有账号不覆盖密码或状态。
- [ ] 更新 `.env.example`、开发 Compose、E2E 脚本和初始化测试。
- [ ] 更新部署 Runbook 与运维文档，生成、保存和读取 `PARTSIGNAL_SEED_ENGINEER_PASSWORD`，说明重复部署不重置密码。

## 3. Frontend

- [ ] 在 `AppLayout` 顶部账号区增加对所有登录用户可见的“修改密码”入口。
- [ ] 用户管理默认过滤停用账号，增加显式“显示停用账号”开关。
- [ ] 补充前端测试，验证改密入口、路由跳转和停用账号展示切换。

## 4. Validation

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make build
DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
REDIS_URL=redis://127.0.0.1:56379/0 make e2e
docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet
git diff --check
```

## 5. Review Gates

- [ ] 不存在通用 `DELETE /users/{id}` API 或长期删除按钮。
- [ ] 清理集合之外的管理员新增用户不受迁移影响。
- [ ] 迁移失败不会重写归属、删除业务记录或留下部分用户删除。
- [ ] 初始化和部署不会在重复运行时覆盖密码。
- [ ] 密码、密码哈希和初始密码不进入响应、日志、审计、任务资料或 Git。
- [ ] 新增和实质修改的 Python Docstring、异常信息及运维输出完成中文文档检查。

## 6. Rollback

- `0010` 不提供重建用户的降级逻辑；执行前备份 PostgreSQL。
- 迁移因引用失败时保持旧数据库不变，先决定清空开发数据或保留旧账号为停用状态，再重新规划。
- 若仅前端入口有问题，可回退应用镜像，不影响密码和用户数据。
