# G08 验收设计

- 使用既有 `frontend/tests/e2e/geo-real-stack.spec.ts` 与 `deploy/scripts/e2e-local.sh`；测试的业务写入沿 V2 页面执行，仅以 API 建立未迁移前置与读取最终投影。
- 隔离脚本创建临时数据库、迁移、seed、启动服务与 production preview；退出 trap 清理数据库、对象存储、服务进程和独占 Redis binding。保留脚本输出作为本轮证据。
- 先确认测试脚本与当前路由/合同的覆盖范围，再运行单一 spec。失败时区分生产缺陷、测试期望漂移与环境问题，仅在得到新证据后复验。
- 若需行为修改，以 GEO domain 的实际状态 owner 为界；服务端持久化与公开合同问题须独立复核。所有结果在任务 PRD 中标明 fixture 与真实栈证据的不同用途。
