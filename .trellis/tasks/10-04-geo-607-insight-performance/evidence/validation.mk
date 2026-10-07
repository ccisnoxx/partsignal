# 仅补齐未执行E2E/部署检查的专用本地连接，不改变已通过目标的环境。
e2e test-deploy-scripts: export DATABASE_URL := postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55477/partsignal
e2e test-deploy-scripts: export REDIS_URL := redis://127.0.0.1:56417/14
