# Backend Agent Boundary

- 只修改 `backend/`。
- 读取但不得修改根 `AGENTS.md`、`contracts/`、`deploy/`、`docs/` 和根配置。
- 使用 FastAPI、Pydantic、SQLAlchemy、Alembic、Celery、Redis 和 pytest 实现既定契约。
- 不得执行 Git 命令；公共契约存在缺口时停止相关实现并通知主 Agent。
- 集成测试使用 PostgreSQL，不得用 SQLite 掩盖 PostgreSQL 特有约束。
