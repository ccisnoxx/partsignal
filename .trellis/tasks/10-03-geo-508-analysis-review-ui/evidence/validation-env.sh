# 仅本任务隔离服务；全部凭据为现有公开测试值。
export DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55468/partsignal
export REDIS_URL=redis://127.0.0.1:56408/14
export APP_ENV=test
export SESSION_SECRET=test-session-secret-at-least-32-bytes
export PARTSIGNAL_SEED_ADMIN_PASSWORD=partsignal-admin-dev
export PARTSIGNAL_SEED_ENGINEER_PASSWORD=partsignal-engineer-dev

# R4 浏览器验证按允许的最小恢复间隔执行；integration 仍在 Compose 的 DB 15。
export GEO_RECOVERY_SCAN_SECONDS=5
